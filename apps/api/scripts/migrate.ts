import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { acquirePostgres } from "../src/db/connection";

class MigrationChanged extends Schema.TaggedError<MigrationChanged>()("MigrationChanged", {
  message: Schema.String,
}) {}

class IncompatibleInstallation extends Schema.TaggedError<IncompatibleInstallation>()(
  "IncompatibleInstallation",
  { message: Schema.String },
) {}

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
    const client = yield* acquirePostgres({
      connectionString: Redacted.make(connectionString),
      applicationName: "openerp-migrate",
      connectTimeoutMs: 10_000,
      statementTimeoutMs: 0,
    });

    const query = (text: string, values: unknown[] = []) =>
      Effect.tryPromise(() =>
        client.query<{ name: string; database: string; sha256: string }>(text, values),
      );

    // Keep migration receipts in their existing public-schema ledger.
    yield* query("SET search_path TO public");
    yield* query(`CREATE TABLE IF NOT EXISTS public.openerp_migrations (
      name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    // The ledger is this runner's own bookkeeping, so the guard reads it and applies nothing
    // else: a receipt naming a file this directory no longer contains is a pre-baseline
    // installation, which is replaced rather than migrated.
    const recorded = yield* query(
      "SELECT name, current_database() AS database FROM public.openerp_migrations ORDER BY name",
    );

    const absent = recorded.rows.find((row) => !migrations.includes(row.name));

    if (absent !== undefined)
      return yield* new IncompatibleInstallation({
        message: `Database ${absent.database} recorded migration ${absent.name}, which apps/api/migrations no longer contains. It predates the baseline: replace it with a fresh database instead of migrating it.`,
      });

    for (const name of migrations) {
      if (through !== undefined && name > through) break;
      const source = yield* Effect.tryPromise(() => readFile(new URL(name, directory), "utf8"));
      const checksum = createHash("sha256").update(source).digest("hex");

      yield* query("BEGIN");

      const applied = yield* Effect.gen(function* () {
        yield* query("LOCK TABLE public.openerp_migrations IN EXCLUSIVE MODE");

        const existing = yield* query(
          "SELECT sha256 FROM public.openerp_migrations WHERE name = $1",
          [name],
        );

        const receipt = existing.rows[0];

        if (receipt && receipt.sha256 !== checksum) {
          return yield* new MigrationChanged({
            message: `Applied migration ${name} has changed. Add a forward migration instead.`,
          });
        }

        if (!receipt) {
          // The simple-query protocol accepts complete reviewed migration files.
          yield* query(source);
          yield* query("INSERT INTO public.openerp_migrations (name, sha256) VALUES ($1, $2)", [
            name,
            checksum,
          ]);
        }

        yield* query("COMMIT");

        return Boolean(receipt);
      }).pipe(Effect.onError(() => query("ROLLBACK").pipe(Effect.ignore)));

      console.info(`${name}: ${applied ? "already applied" : "applied"}`);
    }
  }).pipe(Effect.scoped),
);
