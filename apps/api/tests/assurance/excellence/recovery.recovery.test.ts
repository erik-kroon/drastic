import { ReleaseManifest } from "@open-erp/contracts/operations";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile, readdir, cp, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { createTestHarness } from "wrangler";
import { expect, test } from "vitest";
import * as Evaluations from "@open-erp/contracts/evaluations";
import * as A from "@open-erp/contracts/accounting";
import * as I from "@open-erp/contracts/source-intake";
import * as Schema from "effect/Schema";
import {
  apiDirectory,
  createSession,
  database,
  decoded,
  environment,
  execution,
  fixture,
  prepare,
  approve,
  key,
} from "../../support/fixtures";

const run = promisify(execFile),
  hash = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

const HostResult = Schema.Struct({
  ok: Schema.Boolean,
  code: Schema.optional(Schema.String),
  value: Schema.optional(Schema.Json),
});

async function connect(url: string) {
  const db = new Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });

  await db.connect();

  return db;
}

function authorized(book: { token: string }, origin: string, bookPath: string) {
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${book.token}`);
    headers.set("content-type", "application/json");

    return fetch(`${origin}${bookPath}${path}`, { ...init, headers });
  };
}

async function image(db: Client, bookId: string) {
  const names = await db.query<{
    table_name: string;
  }>(
    `SELECT table_name FROM information_schema.columns WHERE table_schema='openerp' AND column_name='book_id' ORDER BY table_name`,
  );

  const result: Record<
    string,
    {
      count: number;
      hash: string;
    }
  > = {};

  for (const { table_name } of names.rows) {
    if (!/^[a-z0-9_]+$/.test(table_name)) throw Error("Unexpected table identity");

    const table = await db.query<{
      value: string;
    }>(
      `SELECT to_jsonb(t)::text AS value FROM openerp."${table_name}" t WHERE book_id=$1 ORDER BY to_jsonb(t)::text`,
      [bookId],
    );

    result[table_name] = {
      count: table.rows.length,
      hash: hash(JSON.stringify(table.rows.map((r) => r.value))),
    };
  }

  // The book writer/counters themselves do not all have book_id columns.
  const b = await db.query<{
    value: string;
  }>("SELECT to_jsonb(b)::text AS value FROM openerp.books b WHERE id=$1", [bookId]);

  result.books = { count: b.rows.length, hash: hash(JSON.stringify(b.rows.map((r) => r.value))) };

  return result;
}

test("[EXC-RECOVERY-COMPLETE] database, external original, recorded approval and successful receipt recover in a second real runtime", async () => {
  const env = environment(),
    scratch = await realpath(env.scratch);

  const admin = await database();

  const reported = (
    await admin.query<{
      data_directory: string;
    }>("SHOW data_directory")
  ).rows[0]?.data_directory;

  // Compare resolved paths on both sides: the harness reports a /var path that
  // macOS resolves through /private/var, and an unresolved prefix check would
  // reject the disposable cluster this test actually owns.
  const actual = reported ? await realpath(reported).catch(() => reported) : null;

  if (!actual || !actual.startsWith(scratch + "/"))
    throw Error("Refuse database not owned by this disposable E2E harness");

  for (const value of [env.adminUrl, env.runtimeUrl, env.baseUrl])
    if (new URL(value).hostname !== "127.0.0.1") throw Error("Non-loopback fixture refused");

  const ident = randomBytes(8).toString("hex"),
    dbName = `exc_restore_${ident}`,
    oldRole = `exc_old_${ident}`,
    newRole = `exc_new_${ident}`,
    password = randomBytes(32).toString("hex");

  const work = join(scratch, `restore-${ident}`),
    originalStore = join(work, "source-objects"),
    restoredStore = join(work, "restored-objects");

  await mkdir(work, { recursive: true, mode: 0o700 });
  await mkdir(originalStore);

  const pgBin =
    process.env.PG_BINDIR ??
    (await run("pg_config", ["--bindir"], { timeout: 15000 })).stdout.trim();

  const pgURL = new URL(env.adminUrl);

  const privatePgEnv = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    PGHOST: "127.0.0.1",
    PGPORT: pgURL.port,
    PGUSER: decodeURIComponent(pgURL.username),
    PGPASSWORD: decodeURIComponent(pgURL.password),
    PGDATABASE: "postgres",
    PGCONNECT_TIMEOUT: "5",
  };

  const base = await fixture();
  const book = { ...base, token: (await createSession(base)).token };

  let sourceWorker: ReturnType<typeof createTestHarness> | undefined,
    destinationWorker: ReturnType<typeof createTestHarness> | undefined;

  let parkedOld: Client | undefined, target: Client | undefined;
  let createdDatabase = false;
  const createdRoles: string[] = [];

  const runHost = async (
    dbURL: string,
    store: string,
    mode: "read" | "retain",
    occurrenceId = "",
    source?: typeof I.RetainSource.Type,
  ) => {
    const path = join(work, `host-${key()}.json`);
    await writeFile(
      path,
      JSON.stringify({
        mode,
        scope: { entityId: book.entityId, bookId: book.bookId },
        store,
        requestKey: key(),
        occurrenceId,
        source,
      }),
      { mode: 0o600 },
    );

    const out = await run("bun", ["tests/assurance/excellence/restore-host.ts", path], {
      cwd: apiDirectory,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        DATABASE_URL: dbURL,
        EXCELLENCE_TOKEN: book.token,
      },
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    });

    return Schema.decodeSync(Schema.fromJsonString(HostResult))(out.stdout.trim());
  };

  let primaryFailure: unknown,
    hasPrimaryFailure = false;

  const cleanupFailures: unknown[] = [];

  try {
    for (const role of [oldRole, newRole]) {
      await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' IN ROLE openerp_runtime`);
      createdRoles.push(role);
    }

    const oldURL = new URL(env.runtimeUrl);
    oldURL.username = oldRole;
    oldURL.password = password;
    const targetURL = new URL(env.runtimeUrl);
    targetURL.username = newRole;
    targetURL.password = password;
    targetURL.pathname = "/" + dbName;
    sourceWorker = createTestHarness({
      root: apiDirectory,
      workers: [
        { configPath: "wrangler.jsonc", env: "e2e", secrets: { DATABASE_URL: oldURL.toString() } },
      ],
    });
    const sourceListen = await sourceWorker.listen();
    const sourceCall = authorized(book, sourceListen.url.origin, book.path);

    const plan = await prepare(book, "12500"),
      approval = await approve(book, plan),
      commandKey = key(),
      body = JSON.stringify(execution(plan, approval));

    const receipt = await decoded(
      await sourceCall(`/change-sets/${plan.id}/execute`, {
        method: "POST",
        headers: { "idempotency-key": commandKey },
        body,
      }),
      A.ExecutionReceipt,
    );

    const original = new Uint8Array(
      Buffer.from("Synthetic retained accounting source.\n".repeat(3000), "utf8"),
    );

    const retained = await runHost(oldURL.toString(), originalStore, "retain", "", {
      sourceSystem: "excellence",
      sourceAccountId: book.bookId,
      occurrenceKey: key(),
      sourceRevision: "1",
      filename: "original.txt",
      mediaType: "text/plain",
      contentBase64: Buffer.from(original).toString("base64"),
    });

    expect(retained.ok).toBe(true);
    const occurrence = Schema.decodeUnknownSync(I.SourceOccurrence)(retained.value);

    const evaluation = await decoded(
      await sourceCall("/evaluations/contracts", {
        method: "POST",
        headers: { "idempotency-key": key() },
        body: JSON.stringify({
          recordClass: "synthetic",
          interval: { startsOn: "2026-01-01", endsOn: "2026-12-31" },
          originalIds: [occurrence.id],
          openingBasis: { status: "unknown", reason: "Unreviewed synthetic opening." },
          familyPopulation: { status: "unknown", reason: "Incomplete synthetic population." },
          permittedAssistance: [],
          allowedCapabilities: ["source_get_occurrence"],
          predecessor: null,
        }),
      }),
      Evaluations.EvaluationContract,
    );

    const objects = await admin.query<{
      object_key: string;
      sha256: string;
      byte_length: number;
    }>(
      "SELECT object_key,sha256,byte_length FROM openerp.intake_contents WHERE book_id=$1 AND object_key IS NOT NULL",
      [book.bookId],
    );

    expect(objects.rows).toHaveLength(1);
    const object = objects.rows[0]!;
    expect(object.sha256).toBe("sha256:" + hash(original));
    expect(object.byte_length).toBe(original.length);
    const closureOriginal = await readFile(join(originalStore, object.object_key));

    expect("sha256:" + hash(closureOriginal)).toBe(object.sha256);

    const migrationFiles = await Promise.all(
      (await readdir(join(apiDirectory, "migrations")))
        .filter((name) => name.endsWith(".sql"))
        .sort()
        .map(async (name) => {
          const bytes = await readFile(join(apiDirectory, "migrations", name));

          return {
            path: `apps/api/migrations/${name}`,
            bytes: String(bytes.length),
            sha256: hash(bytes),
          };
        }),
    );

    const migrationRelease = Schema.decodeUnknownSync(ReleaseManifest)({
      version: 1,
      kind: "openerp-source-release",
      capturedAt: new Date().toISOString(),
      files: migrationFiles,
      databaseAdapter: "drizzle-effect-postgres",
      browserAuthentication: "better-auth",
      runtimeVerification: "not-run",
    });

    await admin.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    let before: Awaited<ReturnType<typeof image>>;

    try {
      const exported = (
        await admin.query<{
          snapshot: string;
        }>("SELECT pg_export_snapshot() AS snapshot")
      ).rows[0]?.snapshot;

      if (!exported) throw Error("Missing snapshot");
      before = await image(admin, book.bookId);
      await run(
        join(pgBin, "pg_dump"),
        [
          "--format=custom",
          "--no-owner",
          `--snapshot=${exported}`,
          `--file=${join(work, "database.dump")}`,
        ],
        { env: privatePgEnv, timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
      );
    } finally {
      await admin.query("ROLLBACK");
    }

    // Copy only the known immutable referenced object roots; verify exact DB hashes.
    await cp(originalStore, restoredStore, { recursive: true, errorOnExist: true, force: false });

    for (const row of objects.rows) {
      if (!/^v1\/book_[a-f0-9]+\/[a-f0-9]{64}$/.test(row.object_key))
        throw Error("Unsafe retained key");
      const b = await readFile(join(restoredStore, row.object_key));
      expect("sha256:" + hash(b)).toBe(row.sha256);
      expect(b.length).toBe(row.byte_length);
    }

    await admin.query(`CREATE DATABASE ${dbName} TEMPLATE template0`);
    createdDatabase = true;
    await run(
      join(pgBin, "pg_restore"),
      [
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        `--dbname=${dbName}`,
        join(work, "database.dump"),
      ],
      { env: privatePgEnv, timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
    );
    const targetAdmin = new URL(env.adminUrl);
    targetAdmin.pathname = "/" + dbName;
    target = await connect(targetAdmin.toString());
    expect(await image(target, book.bookId)).toEqual(before!);
    await admin.query(`REVOKE CONNECT ON DATABASE ${dbName} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${newRole}`);
    // Stop the actual old deployment's login and terminate its already-open pooled connections.
    parkedOld = await connect(oldURL.toString());
    parkedOld.on("error", () => undefined);
    await admin.query(`ALTER ROLE ${oldRole} NOLOGIN`);
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename=$1 AND pid<>pg_backend_pid()",
      [oldRole],
    );

    const oldProbe = new Client({
      connectionString: oldURL.toString(),
      connectionTimeoutMillis: 3000,
    });

    await expect(oldProbe.connect()).rejects.toMatchObject({ code: "28000" });
    await oldProbe.end();
    destinationWorker = createTestHarness({
      root: apiDirectory,
      workers: [
        {
          configPath: "wrangler.jsonc",
          env: "e2e",
          secrets: { DATABASE_URL: targetURL.toString() },
        },
      ],
    });
    const listening = await destinationWorker.listen();
    const targetCall = authorized(book, listening.url.origin, book.path);

    const recovered = await decoded(
      await targetCall(`/change-sets/${plan.id}/execute`, {
        method: "POST",
        headers: { "idempotency-key": commandKey },
        body,
      }),
      A.ExecutionReceipt,
    );

    expect(recovered).toEqual(receipt);
    expect(
      await decoded(
        await targetCall(`/evaluations/contracts/${evaluation.id}`),
        Evaluations.EvaluationContract,
      ),
    ).toEqual(evaluation);
    expect(before.evaluation_contracts?.count).toBe(1);

    expect(await image(target, book.bookId)).toEqual(before!);
    const afterSource = await runHost(targetURL.toString(), restoredStore, "read", occurrence.id);
    expect(afterSource.ok).toBe(true);
    const restoredOriginal = Schema.decodeUnknownSync(I.SourceOccurrenceView)(afterSource.value);
    expect(restoredOriginal.contentBase64).toBe(Buffer.from(original).toString("base64"));

    const objectPath = join(restoredStore, object.object_key),
      saved = await readFile(objectPath);

    await rm(objectPath);
    const absent = await runHost(targetURL.toString(), restoredStore, "read", occurrence.id);
    expect(absent).toMatchObject({ ok: false, code: "MissingEvidence" });
    await writeFile(objectPath, Buffer.alloc(saved.length, 120));
    const corrupt = await runHost(targetURL.toString(), restoredStore, "read", occurrence.id);
    expect(corrupt).toMatchObject({ ok: false, code: "MissingEvidence" });
    await writeFile(objectPath, saved);
    expect((await runHost(targetURL.toString(), restoredStore, "read", occurrence.id)).ok).toBe(
      true,
    );
    expect(await image(target, book.bookId)).toEqual(before!);

    const closureProbe = () =>
      run("bun", ["scripts/evaluation-recovery-closure.ts", restoredStore], {
        cwd: apiDirectory,
        env: { ...process.env, DATABASE_ADMIN_URL: targetAdmin.toString() },
        timeout: 60000,
      });

    const beforeQualification = Schema.decodeSync(Schema.fromJsonString(Schema.JsonObject))(
      (await closureProbe()).stdout,
    );

    await target.query("DROP EXTENSION pg_stat_statements");

    const afterQualification = Schema.decodeSync(Schema.fromJsonString(Schema.JsonObject))(
      (await closureProbe()).stdout,
    );

    expect(afterQualification.tables).toEqual(beforeQualification.tables);
    expect(beforeQualification.extensions).toEqual([
      { name: "pg_stat_statements" },
      { name: "plpgsql" },
    ]);
    expect(afterQualification.extensions).toEqual([{ name: "plpgsql" }]);
    expect(afterQualification.unvalidatedConstraints).toEqual([
      { name: "vat_assessment_receipts_match_fkey", table: "openerp.vat_assessment_receipts" },
    ]);
    expect(afterQualification.schemaQualification).toBe("not-established");

    await writeFile(
      join(env.artifacts, "evaluation-recovery-closure.json"),
      JSON.stringify({ beforeQualification, afterQualification }, null, 2),
    );
    await writeFile(
      join(env.artifacts, "evaluation-migration-release.json"),
      JSON.stringify(migrationRelease, null, 2),
    );

    await writeFile(
      join(env.artifacts, "excellence-recovery.json"),
      JSON.stringify(
        {
          schema: "excellence-evidence/v1",
          caseId: "EXC-RECOVERY-COMPLETE",
          outcome: "passed",
          restore: {
            database: true,
            bookTableDigests: before,
            referencedObjects: objects.rows,
            originalCommandRecovered: true,
            originalSourceRecovered: true,
            evaluationContractRecovered: evaluation.id,
            restoredTableFingerprintsAndJsonClosure: true,
            strictSchemaQualification: "pending-separate-vat-constraint-unit",
            restoredDiagnosticExtensionRemovedBeforeQualification: true,
            missingSourceRefused: true,
            corruptSourceRefused: true,
            oldSelectedDeploymentLoginRevoked: true,
          },
          limitations: [
            "Same PG cluster, not independent infrastructure disaster recovery",
            "Only the test-owned old deployment role is fenced; this is not proof that all production writers are retired",
            "No live signing/provider secret restored",
            "Strict schema qualification remains blocked by preexisting unvalidated VAT constraint; separate failing probe evidence is retained",
          ],
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } catch (e) {
    primaryFailure = e;
    hasPrimaryFailure = true;
  } finally {
    for (const cleanup of [
      () => destinationWorker?.close(),
      () => sourceWorker?.close(),
      () => parkedOld?.end(),
      () => target?.end(),
      async () => {
        if (createdDatabase) await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
      },
      ...createdRoles.map((role) => async () => {
        await admin.query(`DROP ROLE ${role}`);
      }),
      () => admin.end(),
    ]) {
      try {
        await cleanup();
      } catch (e) {
        cleanupFailures.push(e);
      }
    }

    await rm(work, { recursive: true, force: true });
  }

  if (hasPrimaryFailure) throw primaryFailure;

  if (cleanupFailures.length)
    throw new AggregateError(cleanupFailures, "Recovery cleanup incomplete");
}, 300000);
