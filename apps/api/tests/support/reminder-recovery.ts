import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { createTestHarness } from "wrangler";
import * as Schema from "effect/Schema";
import * as Operations from "@open-erp/contracts/operations";
import { captureRelease } from "../../scripts/operations/artifacts";
import { tableFingerprints } from "../../scripts/operations/snapshot";
import { inspectBundleResult } from "../../scripts/operations/workflows";
import { apiDirectory, database, environment, run } from "./fixtures";

const root = resolve(apiDirectory, "../..");

const hash = (body: string | Uint8Array) => createHash("sha256").update(body).digest("hex");

async function json<S extends Schema.Top & { readonly DecodingServices: never }>(
  path: string,
  schema: S,
) {
  return Schema.decodeSync(Schema.fromJsonString(schema))(await readFile(path, "utf8"));
}

async function save(path: string, body: unknown) {
  await writeFile(path, JSON.stringify(body, null, 2), { mode: 0o600, flag: "wx" });
}

async function retainedHashes(client: Client, bookId: string, version: 4 | 6 | 8) {
  const tables = [
    "reminder_messages",
    "reminder_approvals",
    "reminder_attempts",
    "reminder_observations",
    ...(version >= 6 ? ["reminder_refusals", "reminder_resolutions"] : []),
    ...(version >= 8
      ? [
          "payroll_paid_recovery_assessments",
          "payroll_paid_recovery_drafts",
          "payroll_paid_recovery_legs",
          "payroll_paid_recovery_attachments",
          "payroll_paid_recovery_qualifications",
          "payroll_paid_recovery_claim_reviews",
          "payroll_paid_recovery_cancellations",
          "payroll_recovery_claims",
          "payroll_recovery_allocations",
          "payroll_adjustment_instructions",
          "payroll_adjustment_consumptions",
          "payroll_paid_events",
          "payroll_settlement_reviews",
          "payroll_settlement_approvals",
          "payroll_settlement_executions",
          "payroll_reporting_corrections",
          "payroll_runs",
          "payroll_payslip_documents",
          "payroll_payslip_artifacts",
        ]
      : []),
  ];

  const bodies: Array<{ table: string; identity: string; bodySha256: string }> = [];

  for (const table of tables) {
    const rows = await client.query<{ identity: string; body: string }>(
      `SELECT coalesce(to_jsonb(r)->>'id',to_jsonb(r)->>'message_id',to_jsonb(r)->>'instruction_id',
        (to_jsonb(r)->>'attempt_id')||'/'||(to_jsonb(r)->>'observation_id')) AS identity,
        to_jsonb(r)::text AS body FROM openerp.${client.escapeIdentifier(table)} r
        WHERE book_id=$1 ORDER BY coalesce(to_jsonb(r)->>'id',to_jsonb(r)->>'message_id',to_jsonb(r)->>'instruction_id',
          (to_jsonb(r)->>'attempt_id')||'/'||(to_jsonb(r)->>'observation_id')) COLLATE "C"`,
      [bookId],
    );

    for (const row of rows.rows)
      bodies.push({ table, identity: row.identity, bodySha256: hash(row.body) });
  }

  return bodies;
}

type HistoricalColumn = {
  name: string;
  type: string;
  identity: string;
  generated: string;
  nullable: boolean;
  expression: string | null;
};

const historicalGeneratedColumns = new Map([
  [
    "openerp.payroll_adjustment_instructions",
    {
      column: "net_claim_id",
      bodyKey: "netRecovery",
      expression: "((body -> 'netRecovery'::text) ->> 'claimId'::text)",
    },
  ],
  [
    "openerp.payroll_recovery_allocations",
    {
      column: "payroll_run_id",
      bodyKey: "payrollRunId",
      expression: "(body ->> 'payrollRunId'::text)",
    },
  ],
]);

async function requireHistoricalColumns(
  client: Client,
  name: string,
  historical: ReadonlyArray<HistoricalColumn>,
  current: ReadonlyArray<HistoricalColumn> | undefined,
) {
  if (JSON.stringify(current) === JSON.stringify(historical)) return null;
  const rule = historicalGeneratedColumns.get(name);
  const extra = current?.filter((column) => !historical.some((old) => old.name === column.name));
  const column = extra?.[0];

  if (
    !rule ||
    extra?.length !== 1 ||
    !column ||
    column.name !== rule.column ||
    column.type !== "text" ||
    column.identity !== "" ||
    column.generated !== "s" ||
    column.nullable !== true ||
    column.expression !== rule.expression ||
    JSON.stringify(current?.filter((entry) => entry.name !== rule.column)) !==
      JSON.stringify(historical)
  )
    throw new Error(`Historical data columns differ for ${name}; a reviewed fixture is required`);

  const identifier = name
    .split(".")
    .map((part) => client.escapeIdentifier(part))
    .join(".");

  const present = (
    await client.query<{ present: boolean }>(
      `SELECT EXISTS(SELECT FROM ${identifier} WHERE ${client.escapeIdentifier(rule.column)} IS NOT NULL OR body ? $1) AS present`,
      [rule.bodyKey],
    )
  ).rows[0]?.present;

  if (present !== false)
    throw new Error(`Historical projection would discard retained ${rule.bodyKey} work`);

  return {
    table: name,
    column: rule.column,
    columnMetadata: column,
    retainedColumns: historical,
    expression: rule.expression,
    bodyKey: rule.bodyKey,
    allValuesNull: true,
    allBodyKeysAbsent: true,
  };
}

async function projectedFingerprint(
  client: Client,
  name: string,
  columns: ReadonlyArray<HistoricalColumn>,
) {
  const identifier = name
    .split(".")
    .map((part) => client.escapeIdentifier(part))
    .join(".");

  const selected = columns.map((column) => client.escapeIdentifier(column.name)).join(",");

  const result = (
    await client.query<{ rows: string; sha256: string }>(`
    SELECT count(*)::text AS rows,
      encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex') AS sha256
    FROM (SELECT encode(sha256(convert_to(row_to_json(r)::text,'UTF8')),'hex') AS h
      FROM (SELECT ${selected} FROM ONLY ${identifier}) r) hashes`)
  ).rows[0];

  const [schema, table] = name.split(".");

  if (!result || BigInt(result.rows) > 100000n)
    throw new Error("Historical projected fingerprint exceeds its retained bound");

  return Schema.decodeUnknownSync(Operations.TableFingerprint)({ schema, table, ...result });
}

async function historicalProducer(work: string, version: 4 | 6) {
  const producerRoot = join(work, `historical-source-v${version}`);
  await mkdir(producerRoot, { mode: 0o700 });
  const archive = join(work, `historical-source-v${version}.tar`);

  const revision = (
    await run("git", ["rev-parse", version === 4 ? "6be48263" : "3a3b2093"], { cwd: root })
  ).stdout.trim();

  await run("git", ["archive", "--format=tar", `--output=${archive}`, revision], { cwd: root });
  await chmod(archive, 0o600);
  await run("tar", ["-xf", archive, "-C", producerRoot]);
  await symlink(join(root, "node_modules"), join(producerRoot, "node_modules"), "dir");
  await symlink(
    join(apiDirectory, "node_modules"),
    join(producerRoot, "apps/api/node_modules"),
    "dir",
  );

  const owner = await readFile(
    join(producerRoot, "apps/api/scripts/operations/durable-work.ts"),
    "utf8",
  );

  if (!owner.includes(`workInventoryPath = "durable-work-v${version}.json"`))
    throw new Error(`Pinned historical source does not provide the authentic V${version} producer`);

  return { root: producerRoot, revision };
}

async function restoreHistoricalData(
  historical: Client,
  donor: Client,
  dump: string,
  pgBin: string,
  pgEnvironment: NodeJS.ProcessEnv,
  listPath: string,
) {
  const columns = `SELECT n.nspname||'.'||c.relname AS name,
    jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'identity',a.attidentity,'generated',a.attgenerated,'nullable',NOT a.attnotnull,
      'expression',CASE WHEN a.attgenerated<>'' THEN pg_get_expr(d.adbin,d.adrelid) ELSE NULL END) ORDER BY a.attnum) AS columns
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE c.relkind='r' AND n.nspname IN ('openerp','openerp_auth','public')
      AND NOT(n.nspname='public' AND c.relname='openerp_migrations')
    GROUP BY n.nspname,c.relname ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"`;

  const tables = (await historical.query<{ name: string; columns: HistoricalColumn[] }>(columns))
    .rows;

  const donorTables = new Map(
    (await donor.query<{ name: string; columns: HistoricalColumn[] }>(columns)).rows.map((row) => [
      row.name,
      row.columns,
    ]),
  );

  const representedNames = new Set(tables.map((table) => table.name));
  const donorOnlyEmptyTables = [];

  for (const name of donorTables.keys()) {
    if (!name.startsWith("openerp.") || representedNames.has(name)) continue;

    const identifier = name
      .split(".")
      .map((part) => donor.escapeIdentifier(part))
      .join(".");

    const rows = (
      await donor.query<{ rows: string }>(`SELECT count(*)::text AS rows FROM ${identifier}`)
    ).rows[0]?.rows;

    if (rows !== "0")
      throw new Error(`Historical donor-only financial work cannot be discarded: ${name}`);
    donorOnlyEmptyTables.push({ table: name, rows });
  }

  const nonempty = new Set<string>();
  const projections = [];
  const emptyRecurringColumnChanges: Array<{ table: string; columns: HistoricalColumn[] }> = [];

  for (const table of tables) {
    const identifier = table.name
      .split(".")
      .map((name) => donor.escapeIdentifier(name))
      .join(".");

    const count = (
      await donor.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${identifier}`)
    ).rows[0]?.count;

    if (count === undefined) throw new Error("Historical table count missing");

    const current = donorTables.get(table.name);

    const added = current?.filter(
      (column) => !table.columns.some((old) => old.name === column.name),
    );

    const recurringColumns = [
      "invoice_issue_owner",
      "internal_invoice_issue_id",
      "legal_invoice_issue_id",
    ];

    if (
      table.name === "openerp.recurring_invoice_occurrence_issues" &&
      count === "0" &&
      added?.length === 3 &&
      added.every(
        (column) =>
          recurringColumns.includes(column.name) &&
          column.type === "text" &&
          column.identity === "" &&
          (column.name === "invoice_issue_owner"
            ? column.generated === "" && !column.nullable && column.expression === null
            : column.generated === "s" && column.nullable && column.expression !== null),
      ) &&
      JSON.stringify(current?.filter((column) => !recurringColumns.includes(column.name))) ===
        JSON.stringify(table.columns)
    ) {
      emptyRecurringColumnChanges.push({ table: table.name, columns: added });
    } else {
      const projection = await requireHistoricalColumns(donor, table.name, table.columns, current);

      if (projection) projections.push(projection);
    }

    if (count !== "0") nonempty.add(table.name);
  }

  const parents = (
    await historical.query<{ child: string; parent: string }>(`
    SELECT cn.nspname||'.'||c.relname AS child,pn.nspname||'.'||p.relname AS parent
    FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace cn ON cn.oid=c.relnamespace
    JOIN pg_class p ON p.oid=f.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace
    WHERE f.contype='f' AND NOT f.condeferrable AND f.conrelid<>f.confrelid`)
  ).rows;

  const ordered: string[] = [];
  const remaining = new Set(tables.map((table) => table.name));

  while (remaining.size > 0) {
    const ready = [...remaining].filter(
      (name) =>
        !nonempty.has(name) ||
        !parents.some(
          (edge) => edge.child === name && nonempty.has(edge.parent) && remaining.has(edge.parent),
        ),
    );

    if (ready.length === 0) throw new Error("Historical data has a nondeferrable dependency cycle");

    for (const name of ready) {
      ordered.push(name);
      remaining.delete(name);
    }
  }

  const sequences = new Set(
    (
      await historical.query<{ name: string }>(`
    SELECT n.nspname||'.'||c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='S' AND n.nspname IN ('openerp','public')`)
    ).rows.map((row) => row.name),
  );

  const entries = (
    await run(join(pgBin, "pg_restore"), ["--list", dump], { env: pgEnvironment })
  ).stdout.split("\n");

  const tableEntries = new Map<string, string>();
  const sequenceEntries: string[] = [];

  for (const entry of entries) {
    const table = /^\d+; \d+ \d+ TABLE DATA (\w+) (\w+) \w+$/.exec(entry);

    if (table) tableEntries.set(`${table[1]}.${table[2]}`, entry);
    const sequence = /^\d+; \d+ \d+ SEQUENCE SET (\w+) (\w+) \w+$/.exec(entry);

    if (sequence && sequences.has(`${sequence[1]}.${sequence[2]}`)) sequenceEntries.push(entry);
  }

  const selected = ordered
    .filter((name) => !emptyRecurringColumnChanges.some((entry) => entry.table === name))
    .map((name) => {
      const entry = tableEntries.get(name);

      if (!entry) throw new Error(`Captured API state omits historical table ${name}`);

      return entry;
    });

  if (sequenceEntries.length !== sequences.size)
    throw new Error("Historical sequence state is incomplete");

  await writeFile(listPath, [...selected, ...sequenceEntries].join("\n") + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  await historical.query(
    `TRUNCATE ${tables
      .map((table) =>
        table.name
          .split(".")
          .map((name) => historical.escapeIdentifier(name))
          .join("."),
      )
      .join(", ")}`,
  );
  await run(
    join(pgBin, "pg_restore"),
    [
      "--data-only",
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      `--use-list=${listPath}`,
      `--dbname=${pgEnvironment.PGDATABASE}`,
      dump,
    ],
    { env: pgEnvironment, timeout: 120000 },
  );

  const represented = new Set(tables.map((table) => table.name));

  const donorRawTables = (await tableFingerprints(donor)).filter((table) =>
    represented.has(`${table.schema}.${table.table}`),
  );

  const donorProjectedTables = [];

  for (const table of tables)
    donorProjectedTables.push(await projectedFingerprint(donor, table.name, table.columns));

  const historicalData = (await tableFingerprints(historical)).filter((table) =>
    represented.has(`${table.schema}.${table.table}`),
  );

  if (JSON.stringify(donorProjectedTables) !== JSON.stringify(historicalData))
    throw new Error("Historical synthetic data differs from the captured API state");

  return {
    historicalDataTables: historicalData,
    donorRawTables,
    donorProjectedTables,
    projections,
    donorOnlyEmptyTables,
    emptyRecurringColumnChanges,
  };
}

export async function proveReminderRecovery(
  bookId: string,
  versions: ReadonlyArray<4 | 6 | 8> = [8, 6],
  verifyContinuation?: (baseUrl: string) => Promise<unknown>,
) {
  const env = environment();
  const scratch = await realpath(env.scratch);
  const admin = await database();
  const suffix = randomBytes(6).toString("hex");
  const work = join(scratch, `reminder-recovery-${suffix}`);
  const created: string[] = [];

  try {
    const reported = (
      await admin.query<{ directory: string }>(
        "SELECT current_setting('data_directory') AS directory",
      )
    ).rows[0]?.directory;

    if (!reported || !(await realpath(reported)).startsWith(scratch + "/"))
      throw new Error("Reminder recovery requires the owned disposable PostgreSQL cluster");

    const sourceUrl = new URL(env.adminUrl);

    if (sourceUrl.hostname !== "127.0.0.1") throw new Error("Non-loopback recovery refused");
    await mkdir(work, { mode: 0o700 });
    const objectDirectory = join(scratch, "original-objects");
    await mkdir(objectDirectory, { mode: 0o700, recursive: true });

    const pgBin = await realpath(
      process.env.PG_BINDIR ?? (await run("pg_config", ["--bindir"])).stdout.trim(),
    );

    const identity = (
      await admin.query<{ id: string }>(
        "SELECT system_identifier::text AS id FROM pg_control_system()",
      )
    ).rows[0]?.id;

    if (!identity) throw new Error("Disposable cluster identity missing");

    const target = Schema.decodeSync(Operations.LocalTarget)({
      version: 1,
      dataClass: "synthetic-local-only",
      host: "127.0.0.1",
      port: Number(sourceUrl.port),
      database: "postgres",
      user: decodeURIComponent(sourceUrl.username),
      password: decodeURIComponent(sourceUrl.password),
      expectedSystemIdentifier: identity,
      pgBinDirectory: pgBin,
    });

    const pgEnvironment = {
      PATH: process.env.PATH ?? "",
      PGHOST: target.host,
      PGPORT: String(target.port),
      PGUSER: target.user,
      PGPASSWORD: target.password,
      PGDATABASE: "postgres",
      PGCONNECT_TIMEOUT: "10",
    };

    const dump = join(work, "api-created-state.dump");
    await admin.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

    try {
      const snapshot = (await admin.query<{ id: string }>("SELECT pg_export_snapshot() AS id"))
        .rows[0]?.id;

      if (!snapshot) throw new Error("API-created reminder snapshot missing");
      await run(
        join(pgBin, "pg_dump"),
        ["--format=custom", "--no-owner", `--snapshot=${snapshot}`, `--file=${dump}`],
        { env: pgEnvironment, timeout: 120000 },
      );
      await chmod(dump, 0o600);
    } finally {
      await admin.query("ROLLBACK");
    }

    const adminPath = join(work, "admin.json");
    await save(adminPath, target);
    const supplementary = join(work, "supplementary");
    await mkdir(supplementary, { mode: 0o700 });
    const custody = "Synthetic configuration custody and suspended reminder recovery. No secrets.";
    await writeFile(join(supplementary, "custody.txt"), custody, { mode: 0o600, flag: "wx" });

    if (versions[0] !== 8 || new Set(versions).size !== versions.length)
      throw new Error(
        "Recovery proof requires one current donor before distinct historical versions",
      );

    const results = [];

    for (const version of versions) {
      const producer =
        version === 8 ? { root, revision: null } : await historicalProducer(work, version);

      const sourceName = `openerp_ops_source_reminder_v${version}_${suffix}`;
      const restoredName = `openerp_restore_reminder_v${version}_${suffix}`;
      await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(sourceName)} TEMPLATE template0`);
      created.push(sourceName);

      if (version === 8) {
        await run(
          join(pgBin, "pg_restore"),
          ["--exit-on-error", "--single-transaction", "--no-owner", `--dbname=${sourceName}`, dump],
          { env: pgEnvironment, timeout: 120000 },
        );
      } else {
        const legacyUrl = new URL(env.adminUrl);
        legacyUrl.pathname = `/${sourceName}`;
        await run("bun", [join(producer.root, "apps/api/scripts/migrate.ts")], {
          cwd: producer.root,
          env: { ...process.env, DATABASE_ADMIN_URL: legacyUrl.toString() },
          timeout: 120000,
        });
      }

      const source = new Client({
        host: target.host,
        port: target.port,
        user: target.user,
        password: target.password,
        database: sourceName,
      });

      await source.connect();
      let bodyHashes;
      let historicalTransfer: Awaited<ReturnType<typeof restoreHistoricalData>> | null = null;

      try {
        if (version === 8) {
          await source.query("DROP EXTENSION pg_stat_statements");
        } else {
          const donor = new Client({
            host: target.host,
            port: target.port,
            user: target.user,
            password: target.password,
            database: `openerp_ops_source_reminder_v8_${suffix}`,
          });

          await donor.connect();

          try {
            historicalTransfer = await restoreHistoricalData(
              source,
              donor,
              dump,
              pgBin,
              { ...pgEnvironment, PGDATABASE: sourceName },
              join(work, `historical-data-v${version}.list`),
            );
          } finally {
            await donor.end();
          }

          const absence = (
            await source.query<{ absent: boolean }>(
              version === 4
                ? "SELECT to_regclass('openerp.reminder_refusals') IS NULL AND to_regclass('openerp.reminder_resolutions') IS NULL AS absent"
                : "SELECT to_regclass('openerp.payroll_mileage_correction_proposals') IS NULL AND to_regclass('openerp.payroll_mileage_correction_successors') IS NULL AS absent",
            )
          ).rows[0]?.absent;

          if (!absence)
            throw new Error(`Legacy recovery fixture contains relations newer than V${version}`);
        }

        bodyHashes = await retainedHashes(source, bookId, version);
      } finally {
        await source.end();
      }

      const release = join(work, `release-v${version}`);
      await captureRelease(producer.root, release);
      const targetPath = join(work, `source-v${version}.json`);
      await save(targetPath, { ...target, database: sourceName });
      const planPath = join(work, `plan-v${version}.json`);
      await save(
        planPath,
        Schema.decodeSync(Operations.RecoveryPlan)({
          version: 1,
          operatorId: "synthetic-reminder-recovery",
          releaseDirectory: release,
          supplementaryDirectory: supplementary,
          artifacts: [
            {
              path: "custody.txt",
              bytes: String(Buffer.byteLength(custody)),
              sha256: hash(custody),
              kind: "configuration",
              referenceId: "synthetic-reminder-custody",
            },
          ],
          configuration: (["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"] as const).map(
            (name) => ({
              name,
              custodyReference: "synthetic-reminder-custody",
              procedurePath: "custody.txt",
            }),
          ),
          workRecoveryProcedurePath: "custody.txt",
        }),
      );
      const bundle = join(work, `bundle-v${version}`);
      await run(
        "bun",
        [
          join(producer.root, "apps/api/scripts/operations/cli.ts"),
          "backup",
          targetPath,
          bundle,
          planPath,
          "--confirm-local-backup",
        ],
        {
          cwd: root,
          timeout: 180000,
          env: { ...process.env, OPENERP_OBJECT_DIRECTORY: objectDirectory },
        },
      );
      const manifestDigest = (await readFile(join(bundle, "manifest.sha256"), "utf8")).trim();
      const manifest = await json(join(bundle, "manifest.json"), Operations.BackupManifest);

      const inventory = await json(
        join(bundle, `durable-work-v${version}.json`),
        Operations.RecoveryWorkInventory,
      );

      const inspection = await inspectBundleResult(bundle, manifestDigest);
      const output = join(work, `restored-v${version}`);
      created.push(restoredName);
      await run(
        "bun",
        [
          join(root, "apps/api/scripts/operations/cli.ts"),
          "restore",
          adminPath,
          bundle,
          manifestDigest,
          restoredName,
          output,
          "--confirm-fresh-local-restore",
        ],
        { cwd: root, timeout: 180000 },
      );
      const receipt = await json(join(output, "restore-receipt.json"), Operations.RestoreReceipt);

      const suspension = await json(
        join(output, "suspension-report.json"),
        Operations.RestoreSuspensionReport,
      );

      const restoredInventory = await json(
        join(output, `durable-work-v${version}.json`),
        Operations.RecoveryWorkInventory,
      );

      const fence = (
        await admin.query<{ allowConnections: boolean; connectionLimit: number }>(
          'SELECT datallowconn AS "allowConnections",datconnlimit AS "connectionLimit" FROM pg_database WHERE datname=$1',
          [restoredName],
        )
      ).rows[0];

      let continuation: unknown = null;

      if (version === 8 && verifyContinuation) {
        const restoredUrl = new URL(env.runtimeUrl);
        restoredUrl.pathname = `/${restoredName}`;

        const server = createTestHarness({
          root: apiDirectory,
          workers: [
            {
              configPath: "wrangler.jsonc",
              env: "e2e",
              secrets: { DATABASE_URL: restoredUrl.toString() },
            },
          ],
        });

        try {
          await admin.query(
            `ALTER DATABASE ${admin.escapeIdentifier(restoredName)} ALLOW_CONNECTIONS true CONNECTION LIMIT -1`,
          );
          await admin.query(
            `GRANT CONNECT ON DATABASE ${admin.escapeIdentifier(restoredName)} TO openerp_runtime`,
          );
          await admin.query(
            `ALTER DATABASE ${admin.escapeIdentifier(restoredName)} SET default_transaction_read_only = off`,
          );
          const restoredAdminUrl = new URL(env.adminUrl);
          restoredAdminUrl.pathname = `/${restoredName}`;
          const restoredObserver = new Client({ connectionString: restoredAdminUrl.toString() });

          await restoredObserver.connect();

          try {
            const hashes = await retainedHashes(restoredObserver, bookId, version);

            if (JSON.stringify(hashes) !== JSON.stringify(bodyHashes))
              throw new Error(
                "Populated restore changed retained payroll or recovery record bytes",
              );
          } finally {
            await restoredObserver.end();
          }

          const listening = await server.listen();
          continuation = await verifyContinuation(listening.url.origin);
        } finally {
          await writeFile(
            join(env.artifacts, `restored-v${version}-worker.json`),
            JSON.stringify(server.getLogs(), null, 2),
          );
          await server.close();
          await admin.query(
            `ALTER DATABASE ${admin.escapeIdentifier(restoredName)} SET default_transaction_read_only = on`,
          );
          await admin.query(
            `ALTER DATABASE ${admin.escapeIdentifier(restoredName)} ALLOW_CONNECTIONS false CONNECTION LIMIT 0`,
          );
          await admin.query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1",
            [restoredName],
          );
        }
      }

      results.push({
        version,
        historicalRevision: producer.revision,
        historicalTransfer,
        manifestDigest,
        sourceMigrationNames: manifest.inventory.migrations.map((migration) => migration.name),
        sourceTables: manifest.tables.filter(
          (table) => table.schema === "openerp" && table.table.startsWith("reminder_"),
        ),
        inventory,
        restoredInventory,
        bodyHashes,
        inspection,
        receipt,
        suspension,
        fence,
        continuation,
      });
    }

    return results;
  } finally {
    try {
      for (const name of created.toReversed()) {
        await admin.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1",
          [name],
        );
        await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(name)}`);
      }
    } finally {
      await admin.end();
    }
  }
}
