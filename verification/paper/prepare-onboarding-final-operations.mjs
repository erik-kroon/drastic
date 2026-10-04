import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, basename, join } from "node:path";
import { createRequire } from "node:module";

const { Client } = createRequire(new URL("../../apps/api/package.json", import.meta.url))("pg");

process.umask(0o077);

const file = process.argv[2];

if (
  !file ||
  basename(file) !== "session.json" ||
  !basename(dirname(file)).startsWith("openerp-paper-")
)
  throw new Error("Use a private disposable session.");

const scratch = await realpath(dirname(file)),
  session = JSON.parse(await readFile(file, "utf8"));

if (
  !["openerp_ops_source_paper", "openerp_ops_source_cutover"].includes(session.databaseName) ||
  new URL(session.url).hostname !== "127.0.0.1"
)
  throw new Error("Only the dedicated synthetic operations fixture.");

const password = await readFile(join(scratch, "pg-password"), "utf8"),
  port = Number((await readFile(join(scratch, "pgdata/postmaster.pid"), "utf8")).split("\n")[3]),
  pgBin = await realpath("/opt/homebrew/opt/postgresql@17/bin"),
  priorDatabase = "openerp_ops_prior_paper2",
  writer = "onboarding_prior_paper2",
  writerPassword = randomBytes(24).toString("hex");

const admin = new Client({
  host: "127.0.0.1",
  port,
  user: "postgres",
  password,
  database: session.databaseName,
});

await admin.connect();

const scope = "/api/v1/entities/entity_synthetic/books/book_synthetic";

const response = await fetch(session.apiUrl + scope + "/onboarding/lifecycle", {
    headers: { authorization: "Bearer " + session.accessToken },
  }),
  lifecycle = await response.json();

if (
  !response.ok ||
  lifecycle.activation ||
  lifecycle.projection.counts.importedVouchers !== 434 ||
  lifecycle.projection.counts.assets !== 4
)
  throw new Error("Require completed synthetic native handoffs.");

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        PGHOST: "127.0.0.1",
        PGPORT: String(port),
        PGUSER: "postgres",
        PGPASSWORD: password,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });

    let diagnostic = "";
    child.stderr.on("data", (chunk) => (diagnostic += chunk));
    child.on("error", reject);
    child.on("close", async (code) => {
      if (code === 0) resolve();
      else {
        await writeFile(join(scratch, "operations-setup-diagnostic.log"), diagnostic, {
          mode: 0o600,
        });
        reject(new Error("Private operations setup command failed."));
      }
    });
  });
}

try {
  const identity = (
    await admin.query("select system_identifier::text as id from pg_control_system()")
  ).rows[0].id;

  await admin.query("create database " + priorDatabase);
  await run(join(pgBin, "pg_dump"), [
    "--format=custom",
    "--file",
    join(scratch, "onboarding-prior2.dump"),
    session.databaseName,
  ]);
  await run(join(pgBin, "pg_restore"), [
    "--exit-on-error",
    "--dbname",
    priorDatabase,
    join(scratch, "onboarding-prior2.dump"),
  ]);
  await admin.query(
    `create role ${writer} login password ${admin.escapeLiteral(writerPassword)} in role openerp_runtime`,
  );

  const prior = new Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password,
    database: priorDatabase,
  });

  await prior.connect();

  try {
    await prior.query(
      "revoke all privileges on all tables in schema openerp,openerp_auth,public from openerp_runtime",
    );
    await prior.query(
      "revoke all privileges on all sequences in schema openerp,openerp_auth,public from openerp_runtime",
    );
    await prior.query(
      `grant select,insert,update,delete on all tables in schema openerp,openerp_auth,public to ${writer}`,
    );
    await prior.query(
      `grant usage,select on all sequences in schema openerp,openerp_auth,public to ${writer}`,
    );
  } finally {
    await prior.end();
  }

  await admin.query(`revoke connect on database ${session.databaseName} from ${writer}`);
  const supplementary = join(scratch, "operations-supplementary2");
  await mkdir(supplementary, { mode: 0o700 });

  const save = async (name, value) => {
    const path = join(scratch, name);
    await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });

    return path;
  };

  const targetPath = await save("operations-target2.json", {
    version: 1,
    dataClass: "synthetic-local-only",
    host: "127.0.0.1",
    port,
    database: session.databaseName,
    user: "postgres",
    password,
    expectedSystemIdentifier: identity,
    pgBinDirectory: pgBin,
  });

  const credentialPath = await save("operations-prior-writer2.json", {
    role: writer,
    password: writerPassword,
  });

  await writeFile(
    join(supplementary, "synthetic-configuration.json"),
    JSON.stringify({
      kind: "synthetic-onboarding-configuration-v1",
      secret: randomBytes(32).toString("hex"),
      origin: "http://127.0.0.1:3000",
    }),
    { mode: 0o600 },
  );
  await save("operations-configuration2.json", {
    version: 1,
    targetPath,
    priorDatabase,
    writerCredentialPaths: [credentialPath],
    targetWriterRoles: ["paper_runtime"],
    operationId:
      session.databaseName === "openerp_ops_source_cutover"
        ? "paper-onboarding-434-pre-final"
        : "paper-onboarding-434-final",
    bookId: "book_synthetic",
    snapshotId: JSON.parse(
      await readFile(join(scratch, "onboarding-activation-snapshot.json"), "utf8"),
    ).snapshotId,
    outputDirectory: join(scratch, "operations-observation2"),
    releaseRoot: await realpath("."),
    supplementaryDirectory: supplementary,
    configurationPath: "synthetic-configuration.json",
    restoreDatabase: "openerp_restore_paper_onboarding",
  });
  console.info(
    JSON.stringify({
      synthetic: true,
      operationsPrepared: true,
      priorDatabase,
      productionAction: "disabled",
    }),
  );
} finally {
  await admin.end();
}
