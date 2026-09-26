import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Database, databaseLayer } from "../src/db/connection";

class RuntimeRoleSetupFailed extends Schema.TaggedError<RuntimeRoleSetupFailed>()(
  "RuntimeRoleSetupFailed",
  {
    message: Schema.String,
  },
) {}

const connectionString = process.env.DATABASE_ADMIN_URL;

const password = process.env.OPENERP_RUNTIME_PASSWORD;

if (!connectionString || !password || password.length < 32) {
  throw new Error("Set DATABASE_ADMIN_URL and OPENERP_RUNTIME_PASSWORD (at least 32 characters).");
}

await Effect.runPromise(
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.execute(sql`DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'openerp_app') THEN
          CREATE ROLE openerp_app LOGIN;
        END IF;
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'openerp_app'
          AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
          RAISE EXCEPTION 'The existing openerp_app role has elevated privileges';
        END IF;
      END $$`);
        yield* tx.execute(sql`SELECT set_config('openerp.runtime_password', ${password}, true)`);
        yield* tx.execute(sql`DO $$ BEGIN
        EXECUTE format('ALTER ROLE openerp_app LOGIN PASSWORD %L', current_setting('openerp.runtime_password'));
      END $$`);
        yield* tx.execute(sql`GRANT openerp_runtime TO openerp_app`);
      }),
    );
  }).pipe(
    Effect.provide(
      databaseLayer({
        connectionString: Redacted.make(connectionString),
        applicationName: "openerp-self-host-role",
        connectTimeoutMs: 10_000,
        statementTimeoutMs: 15_000,
      }),
    ),
    // Database failures can contain bound passwords; keep this CLI boundary redacted.
    Effect.mapError(
      () =>
        new RuntimeRoleSetupFailed({
          message:
            "Runtime role setup failed. Verify migration completion and maintenance privileges.",
        }),
    ),
  ),
);

console.info("Configured the restricted openerp_app login.");
