import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Database, databaseLayer } from "../src/db/connection";
import { migrations as migrationReceipts } from "../src/db/schema";

class MigrationChanged extends Schema.TaggedError<MigrationChanged>()("MigrationChanged", {
  message: Schema.String,
}) {}

const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString)
  throw new Error("Set DATABASE_ADMIN_URL to a direct PostgreSQL maintenance connection.");
const directory = new URL("../migrations/", import.meta.url);
const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
const through = process.argv[2];
if (process.argv.length > 3 || (through !== undefined && !migrations.includes(through))) {
  throw new Error("Usage: bun scripts/migrate.ts [last-reviewed-migration.sql]");
}

await Effect.runPromise(
  Effect.gen(function* () {
    const db = yield* Database;
    // Drizzle's default-schema tables are unqualified; keep the receipt ledger in public.
    yield* db.execute(sql`SET search_path TO public`);
    yield* db.execute(sql`CREATE TABLE IF NOT EXISTS ${migrationReceipts} (
      name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const name of migrations) {
      if (through !== undefined && name > through) break;
      const source = yield* Effect.tryPromise(() => readFile(new URL(name, directory), "utf8"));
      const checksum = createHash("sha256").update(source).digest("hex");
      const applied = yield* db.transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.execute(sql`LOCK TABLE ${migrationReceipts} IN EXCLUSIVE MODE`);
          const [existing] = yield* tx
            .select({ sha256: migrationReceipts.sha256 })
            .from(migrationReceipts)
            .where(eq(migrationReceipts.name, name));
          if (existing && existing.sha256 !== checksum) {
            return yield* new MigrationChanged({
              message: `Applied migration ${name} has changed. Add a forward migration instead.`,
            });
          }
          if (!existing) {
            // Raw SQL is restricted to checked-in migration source, never request input.
            yield* tx.execute(sql.raw(source));
            yield* tx.insert(migrationReceipts).values({ name, sha256: checksum });
          }
          return Boolean(existing);
        }),
      );
      console.info(`${name}: ${applied ? "already applied" : "applied"}`);
    }
  }).pipe(
    Effect.provide(
      databaseLayer({
        connectionString: Redacted.make(connectionString),
        applicationName: "openerp-migrate",
        connectTimeoutMs: 10_000,
        statementTimeoutMs: 0,
      }),
    ),
  ),
);
