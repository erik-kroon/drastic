/// <reference types="bun" />
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { expect, test } from "vitest";
import { databaseInventory, roleInventory } from "../scripts/operations/inventory";
import { tableFingerprints } from "../scripts/operations/snapshot";
import { OperationsFailure } from "../scripts/operations/safety";
import { apiDirectory, database, environment, run } from "./support/fixtures";

const targetConstraint = "vat_assessment_receipts_match_fkey";

const historical = "0048-cash-invoice-recognition-period.sql";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function release() {
  const names = (await readdir(join(apiDirectory, "migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const files = await Promise.all(
    names.map(async (name) => {
      const source = await readFile(join(apiDirectory, "migrations", name), "utf8");

      return {
        path: `apps/api/migrations/${name}`,
        bytes: String(Buffer.byteLength(source)),
        sha256: hash(source),
      };
    }),
  );

  return {
    version: 1 as const,
    kind: "openerp-source-release" as const,
    capturedAt: new Date().toISOString(),
    files,
    databaseAdapter: "drizzle-effect-postgres" as const,
    browserAuthentication: "better-auth" as const,
    runtimeVerification: "not-run" as const,
  };
}

async function constraints(client: Client) {
  return (
    await client.query<{ name: string; relation: string; validated: boolean; definition: string }>(`
    SELECT k.conname AS name, k.conrelid::regclass::text AS relation,
      k.convalidated AS validated, pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
    ORDER BY k.conrelid::regclass::text COLLATE "C", k.conname COLLATE "C"`)
  ).rows;
}

async function refusal(action: () => Promise<unknown>) {
  try {
    await action();
    throw new Error("Expected strict recovery refusal");
  } catch (error) {
    if (!(error instanceof OperationsFailure)) throw error;

    return { tag: error._tag, message: error.message };
  }
}

async function matchValidation(client: Client, match: string | null, parent: boolean) {
  await client.query("BEGIN");

  try {
    await client.query("SET LOCAL session_replication_role=replica");

    if (parent)
      await client.query(`INSERT INTO openerp.tax_account_matches
      (book_id,id,event_id,voucher_id,line_id,evidence_id,body)
      VALUES('fault_book','fault_match','fault_event','fault_voucher','fault_line','fault_evidence','{}')`);
    const body = { id: "fault_receipt", scope: { bookId: "fault_book" } };
    await client.query(
      `INSERT INTO openerp.vat_assessment_receipts
      (book_id,id,assessment_id,approval_id,voucher_id,match_ref,body,digest,recorded_at,event_id,assessment_identity)
      VALUES('fault_book','fault_receipt','fault_assessment','fault_approval',NULL,$1,$2,
        openerp.digest($2::jsonb),now(),'fault_event','fault_identity')`,
      [match, JSON.stringify(body)],
    );
    await client.query("SET LOCAL session_replication_role=origin");
    await client.query(
      `ALTER TABLE openerp.vat_assessment_receipts VALIDATE CONSTRAINT ${targetConstraint}`,
    );

    return { code: "accepted", constraint: null };
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || !("constraint" in error)) throw error;

    return { code: error.code, constraint: error.constraint };
  } finally {
    await client.query("ROLLBACK");
  }
}

test("strict recovery qualifies the validated VAT match constraint without changing retained state", async () => {
  const env = environment();
  const admin = await database();
  const suffix = randomBytes(8).toString("hex");
  const sourceName = `recovery_constraint_${suffix}`;
  const restoredName = `recovery_restored_${suffix}`;
  const created: string[] = [];
  const clients: Client[] = [];

  const observed: {
    historicalMigration?: string;
    catalog?: object;
    beforeRefusal?: object;
    integrityVectors?: object;
    upgrade?: string;
    upgradePreservation?: object;
    migrationReplay?: string;
    unrelatedRefusal?: object;
    migrationMismatch?: object;
    restore?: object;
  } = {};

  const manifest = await release();
  const pgBin = process.env.PG_BINDIR ?? (await run("pg_config", ["--bindir"])).stdout.trim();
  const sourceURL = new URL(env.adminUrl);
  sourceURL.pathname = `/${sourceName}`;

  const pgEnv = {
    PATH: process.env.PATH ?? "",
    PGHOST: "127.0.0.1",
    PGPORT: sourceURL.port,
    PGUSER: decodeURIComponent(sourceURL.username),
    PGPASSWORD: decodeURIComponent(sourceURL.password),
    PGDATABASE: sourceName,
    PGCONNECT_TIMEOUT: "5",
  };

  const migrate = async (through?: string) =>
    run("bun", ["scripts/migrate.ts", ...(through ? [through] : [])], {
      cwd: apiDirectory,
      env: { ...process.env, DATABASE_ADMIN_URL: sourceURL.toString() },
      timeout: 30000,
    });

  const connect = async (name: string) => {
    const url = new URL(env.adminUrl);
    url.pathname = `/${name}`;
    const client = new Client({ connectionString: url.toString(), statement_timeout: 15000 });
    await client.connect();
    clients.push(client);

    return client;
  };

  try {
    await admin.query(`CREATE DATABASE ${sourceName} TEMPLATE template0`);
    created.push(sourceName);
    observed.historicalMigration = (await migrate(historical)).stdout;
    const source = await connect(sourceName);

    const extensions = (
      await source.query<{ name: string }>(
        "SELECT extname AS name FROM pg_extension ORDER BY extname",
      )
    ).rows;

    expect(extensions).toEqual([{ name: "plpgsql" }]);
    const beforeConstraints = await constraints(source);
    const unvalidated = beforeConstraints.filter((row) => !row.validated);
    expect(unvalidated).toEqual([
      {
        name: targetConstraint,
        relation: "openerp.vat_assessment_receipts",
        validated: false,
        definition:
          "FOREIGN KEY (book_id, match_ref) REFERENCES openerp.tax_account_matches(book_id, id) NOT VALID",
      },
    ]);

    const nullable = (
      await source.query<{
        column: string;
        nullable: boolean;
      }>(`SELECT attname AS column, NOT attnotnull AS nullable
      FROM pg_attribute WHERE attrelid='openerp.vat_assessment_receipts'::regclass AND attname IN ('match_ref','voucher_id') ORDER BY attname`)
    ).rows;

    expect(nullable).toEqual([
      { column: "match_ref", nullable: true },
      { column: "voucher_id", nullable: true },
    ]);
    observed.catalog = {
      extensions,
      unvalidated,
      nullable,
      wider: beforeConstraints.find(
        (row) => row.name === "vat_assessment_receipts_matched_event_fkey",
      ),
    };

    const historicalRelease = {
      ...manifest,
      files: manifest.files.filter((file) => file.path.split("/").at(-1)! <= historical),
    };

    observed.beforeRefusal = await refusal(() => databaseInventory(source, historicalRelease));
    expect(observed.beforeRefusal).toEqual({
      tag: "OperationsFailure",
      message:
        "Unsupported extension, replication, role/database setting, ownership, relation or disabled constraint/trigger requires reviewed recovery support.",
    });

    const vectors = {
      nullMatch: await matchValidation(source, null, false),
      presentMatchNullVoucher: await matchValidation(source, "fault_match", true),
      orphanMatchNullVoucher: await matchValidation(source, "fault_match", false),
    };

    observed.integrityVectors = vectors;
    expect(vectors).toEqual({
      nullMatch: { code: "accepted", constraint: null },
      presentMatchNullVoucher: { code: "accepted", constraint: null },
      orphanMatchNullVoucher: { code: "23503", constraint: targetConstraint },
    });
    await source.query(
      "INSERT INTO openerp.entities(id,name) VALUES('recovery_entity','Synthetic recovery entity')",
    );
    await source.query(`INSERT INTO openerp.books(id,entity_id,name,currency,currency_scale,profile)
      VALUES('recovery_book','recovery_entity','Synthetic recovery book','SEK',2,'synthetic-core-v1')`);
    await source.query(
      "INSERT INTO openerp.actors(id,name) VALUES('recovery_actor','Synthetic recorder')",
    );
    await source.query(`INSERT INTO openerp.evidence(book_id,id,title,content,media_type,origin,sha256,created_by)
      VALUES('recovery_book','recovery_evidence','Synthetic recovery evidence','SYNTHETIC RECOVERY VALIDATION','text/plain','operator',
        encode(sha256(convert_to('SYNTHETIC RECOVERY VALIDATION','UTF8')),'hex'),'recovery_actor')`);
    const beforeTables = await tableFingerprints(source);
    const beforeRoles = await roleInventory(source);

    const schema = async () =>
      (
        await run(join(pgBin, "pg_dump"), ["--schema-only", "--no-owner", "--dbname", sourceName], {
          env: pgEnv,
          timeout: 30000,
          maxBuffer: 8 * 1024 * 1024,
        })
      ).stdout.replace(/^\\(?:un)?restrict .+$/gm, "");

    const beforeSchema = await schema();
    observed.upgrade = (await migrate()).stdout;
    const afterInventory = await databaseInventory(source, manifest);
    const afterConstraints = await constraints(source);
    expect(afterConstraints).toEqual(
      beforeConstraints.map((row) =>
        row.name === targetConstraint && row.relation === "openerp.vat_assessment_receipts"
          ? { ...row, validated: true, definition: row.definition.replace(/ NOT VALID$/, "") }
          : row,
      ),
    );
    const afterSchema = await schema();
    expect(afterSchema).toBe(
      beforeSchema.replace(
        "REFERENCES openerp.tax_account_matches(book_id, id) NOT VALID;",
        "REFERENCES openerp.tax_account_matches(book_id, id);",
      ),
    );
    expect(await roleInventory(source)).toEqual(beforeRoles);
    const afterTables = await tableFingerprints(source);
    expect(afterTables.filter((table) => table.table !== "openerp_migrations")).toEqual(
      beforeTables.filter((table) => table.table !== "openerp_migrations"),
    );
    expect(afterInventory.migrations).toEqual(
      manifest.files.map((file) => ({ name: file.path.split("/").at(-1), sha256: file.sha256 })),
    );
    observed.upgradePreservation = {
      beforeConstraints,
      afterConstraints,
      beforeRoles,
      beforeSchemaSha256: hash(beforeSchema),
      afterSchemaSha256: hash(afterSchema),
      beforeTables,
      afterTables,
      inventory: afterInventory,
    };
    observed.migrationReplay = (await migrate()).stdout;
    expect(await databaseInventory(source, manifest)).toEqual(afterInventory);
    expect(await tableFingerprints(source)).toEqual(afterTables);
    await source.query(
      "ALTER TABLE openerp.evidence ADD CONSTRAINT recovery_unrelated_fault CHECK (true) NOT VALID",
    );
    observed.unrelatedRefusal = await refusal(() => databaseInventory(source, manifest));
    expect(observed.unrelatedRefusal).toEqual(observed.beforeRefusal);
    await source.query("ALTER TABLE openerp.evidence DROP CONSTRAINT recovery_unrelated_fault");
    expect(await databaseInventory(source, manifest)).toEqual(afterInventory);
    observed.migrationMismatch = await refusal(() =>
      databaseInventory(source, {
        ...manifest,
        files: manifest.files.map((file, index) =>
          index === 0 ? { ...file, sha256: "0".repeat(64) } : file,
        ),
      }),
    );
    expect(observed.migrationMismatch).toEqual({
      tag: "OperationsFailure",
      message:
        "Applied migration receipts differ from the captured release. A partial or changed schema cannot be marked complete.",
    });
    const dump = join(env.scratch, "recovery-constraint.dump");
    await run(join(pgBin, "pg_dump"), ["--format=custom", "--no-owner", "--file", dump], {
      env: pgEnv,
      timeout: 30000,
    });
    await admin.query(`CREATE DATABASE ${restoredName} TEMPLATE template0`);
    created.push(restoredName);
    await run(
      join(pgBin, "pg_restore"),
      ["--exit-on-error", "--single-transaction", "--no-owner", "--dbname", restoredName, dump],
      { env: pgEnv, timeout: 30000 },
    );
    const restored = await connect(restoredName);
    const restoredInventory = await databaseInventory(restored, manifest);
    const restoredTables = await tableFingerprints(restored);
    expect(restoredInventory).toEqual(afterInventory);
    expect(restoredTables).toEqual(afterTables);

    const evidence = (
      await restored.query<{ content: string }>(
        "SELECT content FROM openerp.evidence WHERE book_id='recovery_book' AND id='recovery_evidence'",
      )
    ).rows;

    expect(evidence).toEqual([{ content: "SYNTHETIC RECOVERY VALIDATION" }]);
    observed.restore = { inventory: restoredInventory, tables: restoredTables, evidence };
  } finally {
    await writeFile(
      join(env.artifacts, "recovery-constraint-validation.json"),
      JSON.stringify(
        {
          release: manifest,
          evaluation0049Present: manifest.files.some((file) => file.path.includes("/0049-")),
          observed,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    for (const client of clients) await client.end();

    for (const name of created.reverse()) await admin.query(`DROP DATABASE ${name}`);
    await admin.end();
  }
}, 120000);
