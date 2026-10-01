import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { tableFingerprints } from "./operations/snapshot";
import { recoveryControls } from "./operations/controls";
import { objectReferences } from "./operations/objects";

const store = process.argv[2];

const url = process.env.DATABASE_ADMIN_URL;

if (
  store === undefined ||
  url === undefined ||
  new URL(url).hostname !== "127.0.0.1" ||
  !/^\/exc_restore_[a-f0-9]+$/.test(new URL(url).pathname)
) {
  throw Error("An owned disposable restored database and original directory are required.");
}

const client = new Client({ connectionString: url });

await client.connect();

try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

  const tables = await tableFingerprints(client, true);
  const objects = await objectReferences(client, tables);

  for (const reference of objects.references) {
    const bytes = await readFile(join(store, reference.objectKey));

    if (
      bytes.length !== reference.byteLength ||
      `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== reference.sha256
    )
      throw Error("Restored original bytes differ from their owned manifest.");
  }

  const closure = await recoveryControls(client, tables, true);

  const extensions = await client.query<{ name: string }>(
    "SELECT extname AS name FROM pg_extension ORDER BY extname",
  );

  const unvalidated = await client.query<{ name: string; table: string }>(
    "SELECT conname AS name, conrelid::regclass::text AS table FROM pg_constraint WHERE NOT convalidated ORDER BY conname",
  );

  console.log(
    JSON.stringify({
      tables,
      objects,
      closure,
      extensions: extensions.rows,
      unvalidatedConstraints: unvalidated.rows,
      schemaQualification: "not-established",
    }),
  );
} finally {
  await client.query("ROLLBACK");
  await client.end();
}
