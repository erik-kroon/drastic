import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import * as Schema from "effect/Schema";
import { Client } from "pg";
import { LocalTarget } from "../../../../packages/contracts/src/operations";

export class OperationsFailure extends Schema.TaggedError<OperationsFailure>()(
  "OperationsFailure",
  {
    message: Schema.String,
  },
) {}

export function refuse(message: string): never {
  throw new OperationsFailure({ message });
}

export async function privatePath(path: string, directory: boolean) {
  if (!isAbsolute(path) || (await realpath(path)) !== path)
    refuse("Use an absolute path without symlinks.");
  const info = await lstat(path);

  if (
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0 ||
    (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)
  ) {
    refuse(
      "Operational paths must be owned by this user and private (0700 directories, 0600 files).",
    );
  }

  return info;
}

export async function newDirectory(path: string) {
  await privatePath(dirname(path), true);
  await mkdir(path, { mode: 0o700 });
  await privatePath(path, true);
}

export async function writePrivate(path: string, value: string) {
  await writeFile(path, value, { mode: 0o600, flag: "wx" });
  const file = await open(path, "r");

  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function readTarget(path: string) {
  await privatePath(path, false);
  const target = Schema.decodeUnknownSync(LocalTarget)(JSON.parse(await readFile(path, "utf8")));

  if ([15439, 55472].includes(target.port))
    refuse("This port is reserved for an existing environment.");

  if (
    !isAbsolute(target.pgBinDirectory) ||
    (await realpath(target.pgBinDirectory)) !== target.pgBinDirectory
  ) {
    refuse("Set an absolute PostgreSQL binary directory without symlinks.");
  }

  return target;
}

export async function connect(target: typeof LocalTarget.Type, database = target.database) {
  const client = new Client({
    host: target.host,
    port: target.port,
    database,
    user: target.user,
    password: target.password,
    application_name: "openerp-local-operations",
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000,
    query_timeout: 125000,
    options:
      "-c search_path=pg_catalog -c timezone=UTC -c datestyle=ISO,YMD -c extra_float_digits=3",
  });

  client.on("error", () => undefined);

  try {
    await client.connect();

    const identity = await client.query<{
      system_identifier: string;
      superuser: boolean;
      version: string;
    }>(`
      SELECT system_identifier::text, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
      current_setting('server_version_num') AS version FROM pg_control_system()`);

    const row = identity.rows[0];

    if (
      !row ||
      row.system_identifier !== target.expectedSystemIdentifier ||
      !row.superuser ||
      !row.version.startsWith("17")
    )
      refuse("Expected an explicitly identified, isolated PostgreSQL 17 superuser target.");

    return client;
  } catch (error) {
    await client.end();
    throw error;
  }
}

export async function runPostgres(
  target: typeof LocalTarget.Type,
  tool: "pg_dump" | "pg_restore",
  args: string[],
  database: string,
) {
  const child = Bun.spawn([join(target.pgBinDirectory, tool), ...args], {
    env: {
      PGHOST: target.host,
      PGPORT: String(target.port),
      PGDATABASE: database,
      PGUSER: target.user,
      PGPASSWORD: target.password,
      PGCONNECT_TIMEOUT: "10",
      PGOPTIONS:
        "-c search_path=pg_catalog -c timezone=UTC -c datestyle=ISO,YMD -c extra_float_digits=3" +
        (tool === "pg_restore"
          ? " -c default_transaction_read_only=off"
          : " -c default_transaction_read_only=on"),
      LANG: "C",
      LC_ALL: "C",
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    timeout: 300000,
  });

  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const exitCode = await child.exited;

    if (exitCode !== 0)
      refuse(`${tool} exited with status ${exitCode}. No successful operation receipt was issued.`);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

export async function fingerprint(path: string, privateFile = true) {
  if (!isAbsolute(path) || (await realpath(path)) !== path)
    refuse("Use an absolute file path without symlinks.");
  const info = privateFile ? await privatePath(path, false) : await lstat(path);

  if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.())
    refuse("Release files must be owned regular files without hardlinks.");
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const after = await lstat(path);

  if (
    info.size !== after.size ||
    info.mtimeMs !== after.mtimeMs ||
    info.ino !== after.ino ||
    after.nlink !== 1 ||
    info.mode !== after.mode
  ) {
    refuse("An artifact changed during checksum calculation.");
  }

  return { bytes: String(info.size), sha256: hash.digest("hex") };
}

export function artifactPath(root: string, name: string) {
  if (
    !name ||
    isAbsolute(name) ||
    name.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    refuse("Invalid artifact path.");
  }

  const path = join(root, name);

  if (relative(root, path).startsWith("..")) refuse("Artifact path leaves its directory.");

  return path;
}
