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

async function selectorOutcomes(client: Client) {
  const outcomes = [];

  for (const selectors of [
    [],
    ["one"],
    Array.from({ length: 20 }, () => "one"),
    Array.from({ length: 21 }, () => "one"),
    [null],
    null,
  ]) {
    await client.query("BEGIN");

    try {
      await client.query("SET LOCAL session_replication_role=replica");

      const body = {
        id: "selector_notice",
        scope: { bookId: "fault_book" },
        oldReleaseId: "old_release",
        newReleaseId: "new_release",
        changeKind: "applicability",
      };

      await client.query(
        `INSERT INTO openerp.rule_change_notices
        (book_id,id,old_release_id,new_release_id,change_kind,effective_from,reason,
          qualification_evidence,changed_selectors,captured_by,captured_at,digest,body)
        VALUES('fault_book','selector_notice','old_release','new_release','applicability','2026-01-01',
          'Synthetic selector boundary','{}',$1,'fault_actor',now(),openerp.digest($2::jsonb),$2)`,
        [selectors, JSON.stringify(body)],
      );
      outcomes.push({ code: "accepted", constraint: null, column: null });
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error)) throw error;

      outcomes.push({
        code: error.code,
        constraint: "constraint" in error ? error.constraint : null,
        column: "column" in error ? error.column : null,
      });
    } finally {
      await client.query("ROLLBACK");
    }
  }

  expect(outcomes).toEqual([
    { code: "23514", constraint: "rule_change_notices_selectors_check", column: null },
    { code: "accepted", constraint: null, column: null },
    { code: "accepted", constraint: null, column: null },
    { code: "23514", constraint: "rule_change_notices_selectors_check", column: null },
    { code: "23514", constraint: "rule_change_notices_selectors_check", column: null },
    { code: "23502", constraint: null, column: "changed_selectors" },
  ]);

  return outcomes;
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
    restoreCatalogDifferences?: object;
    selectorsBefore?: object;
    selectorUpgrade?: object;
  } = {};

  const manifest = await release();

  const vatRelease = {
    ...manifest,
    files: manifest.files.filter(
      (file) => file.path.split("/").at(-1)! <= "0050-validate-vat-receipt-match.sql",
    ),
  };

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
    observed.selectorsBefore = await selectorOutcomes(source);

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
    observed.upgrade = (await migrate("0050-validate-vat-receipt-match.sql")).stdout;
    const afterInventory = await databaseInventory(source, vatRelease);
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
      vatRelease.files.map((file) => ({ name: file.path.split("/").at(-1), sha256: file.sha256 })),
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
    observed.migrationReplay = (await migrate("0050-validate-vat-receipt-match.sql")).stdout;
    expect(await databaseInventory(source, vatRelease)).toEqual(afterInventory);
    expect(await tableFingerprints(source)).toEqual(afterTables);
    await source.query(
      "ALTER TABLE openerp.evidence ADD CONSTRAINT recovery_unrelated_fault CHECK (true) NOT VALID",
    );
    observed.unrelatedRefusal = await refusal(() => databaseInventory(source, vatRelease));
    expect(observed.unrelatedRefusal).toEqual(observed.beforeRefusal);
    await source.query("ALTER TABLE openerp.evidence DROP CONSTRAINT recovery_unrelated_fault");
    expect(await databaseInventory(source, vatRelease)).toEqual(afterInventory);
    observed.migrationMismatch = await refusal(() =>
      databaseInventory(source, {
        ...vatRelease,
        files: vatRelease.files.map((file, index) =>
          index === 0 ? { ...file, sha256: "0".repeat(64) } : file,
        ),
      }),
    );
    expect(observed.migrationMismatch).toEqual({
      tag: "OperationsFailure",
      message:
        "Applied migration receipts differ from the captured release. A partial or changed schema cannot be marked complete.",
    });

    const oldSelector = afterConstraints.find(
      (row) => row.name === "rule_change_notices_selectors_check",
    );

    expect(oldSelector?.definition).toBe(
      "CHECK ((((cardinality(changed_selectors) >= 1) AND (cardinality(changed_selectors) <= 20)) AND (array_position(changed_selectors, NULL::text) IS NULL)))",
    );

    const selectorMigration = (await migrate()).stdout;
    const qualifiedConstraints = await constraints(source);
    const selectorsAfter = await selectorOutcomes(source);

    const stableCheck =
      "CHECK (((cardinality(changed_selectors) >= 1) AND (cardinality(changed_selectors) <= 20) AND (array_position(changed_selectors, NULL::text) IS NULL)))";

    const qualifiedTables = await tableFingerprints(source);
    const qualifiedInventory = await databaseInventory(source, manifest);
    const qualifiedSchema = await schema();

    observed.selectorUpgrade = {
      migration: selectorMigration,
      constraints: qualifiedConstraints,
      selectorsAfter,
      tables: qualifiedTables,
      inventory: qualifiedInventory,
      schemaSha256: hash(qualifiedSchema),
    };

    expect(qualifiedConstraints).toEqual(
      afterConstraints.map((row) =>
        row.name === "rule_change_notices_selectors_check" &&
        row.relation === "openerp.rule_change_notices"
          ? { ...row, definition: stableCheck }
          : row,
      ),
    );
    expect(selectorsAfter).toEqual(observed.selectorsBefore);
    expect(qualifiedSchema).toBe(afterSchema.replace(oldSelector!.definition, stableCheck));
    expect(await roleInventory(source)).toEqual(beforeRoles);
    expect(qualifiedTables.filter((table) => table.table !== "openerp_migrations")).toEqual(
      afterTables.filter((table) => table.table !== "openerp_migrations"),
    );
    expect(qualifiedInventory.migrations).toEqual(
      manifest.files.map((file) => ({ name: file.path.split("/").at(-1), sha256: file.sha256 })),
    );

    await migrate();
    expect(await databaseInventory(source, manifest)).toEqual(qualifiedInventory);
    expect(await tableFingerprints(source)).toEqual(qualifiedTables);

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

    observed.restore = { inventory: restoredInventory, tables: restoredTables };

    const inventorySource = await readFile(
      join(apiDirectory, "scripts/operations/inventory.ts"),
      "utf8",
    );

    const objectQuery = inventorySource.match(
      /WITH objects\(kind, name, body\) AS \(([\s\S]*?)\n    \) SELECT encode/,
    );

    if (!objectQuery) throw new Error("Recovery inventory catalog query unavailable");

    const catalogQuery = `WITH objects(kind, name, body) AS (${objectQuery[1]})
      SELECT kind, name, body FROM objects ORDER BY kind COLLATE "C", name COLLATE "C", body::text COLLATE "C"`;

    const sourceCatalog = (
      await source.query<{ kind: string; name: string; body: unknown }>(catalogQuery)
    ).rows;

    const restoredCatalog = (
      await restored.query<{ kind: string; name: string; body: unknown }>(catalogQuery)
    ).rows;

    const sourceObjects = new Set(sourceCatalog.map((row) => JSON.stringify(row)));
    const restoredObjects = new Set(restoredCatalog.map((row) => JSON.stringify(row)));

    observed.restoreCatalogDifferences = {
      source: sourceCatalog.filter((row) => !restoredObjects.has(JSON.stringify(row))),
      restored: restoredCatalog.filter((row) => !sourceObjects.has(JSON.stringify(row))),
    };

    expect(restoredInventory).toEqual(qualifiedInventory);
    expect(restoredTables).toEqual(qualifiedTables);

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
