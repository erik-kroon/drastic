import * as PgClient from "@effect/sql-pg/PgClient";
import * as PgTypes from "@effect/sql-pg/PgTypes";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import { ConnectionError, SqlError } from "effect/sql/SqlError";
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

// Raw projections share the same string contract as Drizzle's date/time columns.
export const nativePostgresTypes = PgTypes.makeRegistry();

for (const oid of [PgTypes.OID.timestamp, PgTypes.OID.timestamptz]) {
  nativePostgresTypes.register(oid, {
    encode: (value: unknown) => PgTypes.encode(value, oid),
    decode: (bytes) =>
      Result.flatMap(PgTypes.decode(bytes, oid, 1), (value) => {
        if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
          return Result.fail(new PgTypes.CodecError({ message: "Expected a finite timestamp" }));
        }

        const micros = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(
          0,
        );

        const fraction = ((micros % 1_000_000n) + 1_000_000n) % 1_000_000n;
        const wholeSecond = new Date(Number((micros - fraction) / 1000n) + 946_684_800_000);

        return Result.succeed(
          `${wholeSecond.toISOString().slice(0, -5)}.${fraction.toString().padStart(6, "0")}Z`,
        );
      }),
  });
}

nativePostgresTypes.register(PgTypes.OID.int8, {
  encode: (value: unknown) => PgTypes.encode(value, PgTypes.OID.int8),
  decode: (bytes) => Result.map(PgTypes.decode(bytes, PgTypes.OID.int8, 1), String),
});

interface PostgresConfig {
  readonly connectionString: Redacted.Redacted<string>;
  readonly applicationName: string;
  readonly connectTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly maximumConnections?: number;
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
  const options = {
    url: config.connectionString,
    types: nativePostgresTypes,
    applicationName: config.applicationName,
    connectTimeout: config.connectTimeoutMs,
    startupParameters: {
      statement_timeout: String(config.statementTimeoutMs),
    },
  };

  const clientLayer = PgClient.layerFrom(
    config.maximumConnections !== undefined && config.maximumConnections > 1
      ? PgClient.make({ ...options, maxConnections: config.maximumConnections, minConnections: 0 })
      : PgClient.makeClient({ ...options, acquireForStream: false }),
  );

  // Construct per request/CLI invocation: Workers cannot share sockets across requests.
  // The default Drizzle services disable query logging and caching.
  return Layer.effect(Database, makeDatabase).pipe(Layer.provide(clientLayer));
}
