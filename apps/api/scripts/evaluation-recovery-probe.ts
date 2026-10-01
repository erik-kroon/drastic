import { readFile } from "node:fs/promises";
import { Client } from "pg";
import * as Schema from "effect/Schema";
import { ReleaseManifest } from "@open-erp/contracts/operations";
import { tableFingerprints } from "./operations/snapshot";
import { databaseInventory } from "./operations/inventory";
import { recoveryControls } from "./operations/controls";

const path = process.argv[2];

const url = process.env.DATABASE_ADMIN_URL;

if (path === undefined || url === undefined || new URL(url).hostname !== "127.0.0.1") {
  throw Error("An isolated loopback database and retained migration release are required.");
}

const release = Schema.decodeSync(Schema.fromJsonString(ReleaseManifest))(
  await readFile(path, "utf8"),
);

const client = new Client({ connectionString: url });

await client.connect();

try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

  const tables = await tableFingerprints(client, true);

  await databaseInventory(client, release);
  await recoveryControls(client, tables, true);

  const evaluation = tables.find(
    (row) => row.schema === "openerp" && row.table === "evaluation_contracts",
  );

  if (evaluation?.rows !== "1") throw Error("Expected exactly one retained evaluation fixture.");

  console.log(
    JSON.stringify({
      evaluationRows: evaluation.rows,
      schemaInventory: "matched",
      jsonClosure: "matched",
    }),
  );
} finally {
  await client.query("ROLLBACK");
  await client.end();
}
