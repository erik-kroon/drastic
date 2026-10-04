import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, chmod, copyFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createRequire } from "node:module";

const run = promisify(execFile);

const { Client } = createRequire(new URL("../../apps/api/package.json", import.meta.url))("pg");

async function privateCluster(file) {
  if (
    !file ||
    basename(file) !== "session.json" ||
    !basename(dirname(file)).startsWith("openerp-paper-")
  )
    throw new Error("Use an isolated private session.");

  const scratch = dirname(file),
    session = JSON.parse(await readFile(file, "utf8"));

  for (const value of [session.url, session.apiUrl]) {
    const origin = new URL(value);

    if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:")
      throw new Error("Only disposable local clusters are allowed.");
  }

  const database = session.databaseName ?? "postgres";

  if (!/^(postgres|openerp_ops_source_[a-z0-9_]{1,40})$/.test(database))
    throw new Error("Only a dedicated synthetic database is allowed.");
  const pid = (await readFile(join(scratch, "pgdata/postmaster.pid"), "utf8")).split("\n");
  const password = (await readFile(join(scratch, "pg-password"), "utf8")).trim();

  return { file, scratch, session, database, port: pid[3], password };
}

const source = await privateCluster(process.argv[2]),
  target = await privateCluster(process.argv[3]);

if (source.scratch === target.scratch)
  throw new Error("Source and target must be distinct clusters.");

for (const [cluster, fresh] of [
  [source, false],
  [target, true],
]) {
  const client = new Client({
    host: cluster.scratch,
    port: Number(cluster.port),
    user: "postgres",
    database: cluster.database,
  });

  await client.connect();

  try {
    const books = await client.query("select id,profile from openerp.books");

    if (
      books.rows.length !== 1 ||
      books.rows[0].id !== "book_synthetic" ||
      books.rows[0].profile !== "synthetic-core-v1"
    )
      throw new Error("Only the synthetic disposable book is permitted.");

    if (fresh) {
      const activity = await client.query(
        "select (select count(*) from openerp.onboarding_cases)+(select count(*) from openerp.vouchers)+(select count(*) from openerp.intake_occurrences) as count",
      );

      if (activity.rows[0].count !== "0") throw new Error("The target must be untouched.");
    }
  } finally {
    await client.end();
  }
}

const bin = (await run("pg_config", ["--bindir"])).stdout.trim();

const backup = join(source.scratch, "onboarding-phase.dump");

await run(
  join(bin, "pg_dump"),
  [
    "--host",
    source.scratch,
    "--port",
    source.port,
    "--username",
    "postgres",
    "--dbname",
    source.database,
    "--format=custom",
    "--no-owner",
    "--file",
    backup,
  ],
  { env: { ...process.env, PGPASSWORD: source.password } },
);

await chmod(backup, 0o600);

await run(
  join(bin, "pg_restore"),
  [
    "--host",
    target.scratch,
    "--port",
    target.port,
    "--username",
    "postgres",
    "--dbname",
    target.database,
    "--clean",
    "--if-exists",
    "--no-owner",
    "--exit-on-error",
    backup,
  ],
  { env: { ...process.env, PGPASSWORD: target.password } },
);

await writeFile(
  target.file,
  JSON.stringify({
    ...target.session,
    email: source.session.email,
    password: source.session.password,
    accessToken: source.session.accessToken,
  }),
  { mode: 0o600 },
);

await copyFile(
  join(source.scratch, "onboarding-owner-fixture.json"),
  join(target.scratch, "onboarding-owner-fixture.json"),
);

await chmod(join(target.scratch, "onboarding-owner-fixture.json"), 0o600);

console.info(
  JSON.stringify({
    synthetic: true,
    restoredActualRetainedPhase: true,
    sourceUrl: source.session.url,
    targetUrl: target.session.url,
  }),
);
