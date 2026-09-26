import * as PgClient from "@effect/sql-pg/PgClient";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ConnectionError, SqlError } from "effect/unstable/sql/SqlError";
import { Client, types, type CustomTypesConfig } from "pg";

const makeDatabase = PgDrizzle.makeWithDefaults();

export type DatabaseClient = Effect.Success<typeof makeDatabase>;

export class Database extends Context.Service<Database, DatabaseClient>()("open-erp/Database") {}

// Drizzle owns date/time decoding; numeric and int8 retain pg's exact parsers.
export const applicationPostgresTypes: CustomTypesConfig = {
  getTypeParser: (oid, format) => {
    if ([1184, 1114, 1082, 1186, 1231, 1115, 1185, 1187, 1182].includes(oid)) {
      return (value: string) => value;
    }
    return types.getTypeParser(oid, format);
  },
};

interface PostgresConfig {
  readonly connectionString: Redacted.Redacted<string>;
  readonly applicationName: string;
  readonly connectTimeoutMs: number;
  readonly statementTimeoutMs: number;
}

export function acquirePostgres(config: PostgresConfig) {
  const connectionFailure = (cause: unknown) =>
    new SqlError({ reason: new ConnectionError({ cause, operation: "connect" }) });
  return Effect.gen(function* () {
    // Register cleanup before connecting, including failed or interrupted connections.
    const client = yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          new Client({
            connectionString: Redacted.value(config.connectionString),
            application_name: config.applicationName,
            connectionTimeoutMillis: config.connectTimeoutMs,
            statement_timeout: config.statementTimeoutMs,
            query_timeout: config.statementTimeoutMs,
            types: applicationPostgresTypes,
          }),
        catch: connectionFailure,
      }),
      (client) => Effect.tryPromise(() => client.end()).pipe(Effect.ignore),
    );
    // Idle socket errors are emitted separately; query errors still reach the Effect channel.
    client.on("error", () => undefined);
    yield* Effect.tryPromise({ try: () => client.connect(), catch: connectionFailure });
    return client;
  });
}

export function databaseLayer(config: PostgresConfig) {
  const clientLayer = PgClient.layerFrom(
    PgClient.fromClient({
      acquire: acquirePostgres(config),
      acquireForStream: false,
      applicationName: config.applicationName,
    }),
  );
  // Construct per request/CLI invocation: Workers cannot share sockets across requests.
  // The default Drizzle services disable query logging and caching.
  return Layer.effect(Database, makeDatabase).pipe(Layer.provide(clientLayer));
}
