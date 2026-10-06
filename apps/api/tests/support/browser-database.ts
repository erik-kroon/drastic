import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Client } from "pg";
import * as Schema from "effect/Schema";

const Session = Schema.Struct({
  url: Schema.String,
  workspace: Schema.String,
  databaseName: Schema.Literal("postgres"),
});

export async function withDisposableBrowserDatabase<T>(
  sessionFile: string,
  origin: string,
  use: (client: Client) => Promise<T>,
) {
  const scratch = dirname(sessionFile);

  if (
    basename(sessionFile) !== "session.json" ||
    !basename(scratch).startsWith("openerp-paper-") ||
    new URL(origin).protocol !== "http:" ||
    new URL(origin).hostname !== "127.0.0.1"
  )
    throw new Error("Browser fixture requires the disposable synthetic cluster");

  const session = Schema.decodeSync(Schema.fromJsonString(Session))(
    await readFile(sessionFile, "utf8"),
  );

  if (
    session.url !== origin ||
    session.workspace !== `${origin}/entities/entity_synthetic/books/book_synthetic`
  )
    throw new Error("Browser fixture session does not match the browser target");

  const postmaster = (await readFile(join(scratch, "pgdata/postmaster.pid"), "utf8")).split("\n");
  const port = Number(postmaster[3]);

  if (
    postmaster[1] !== join(scratch, "pgdata") ||
    postmaster[4] !== scratch ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error("Browser fixture cluster does not match its exact scratch socket");

  const client = new Client({
    host: scratch,
    port,
    database: session.databaseName,
    user: "postgres",
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();

    return await use(client);
  } finally {
    await client.end();
  }
}
