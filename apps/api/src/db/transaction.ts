import * as Accounting from "@open-erp/contracts/accounting";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlError from "effect/unstable/sql/SqlError";
import { failure } from "../application/failures";
import { Database, type DatabaseClient } from "./connection";

const PostgresFailure = Schema.Struct({
  code: Schema.String,
  detail: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});

export type Transaction = Parameters<DatabaseClient["transaction"]>[0] extends (
  transaction: infer T,
) => unknown
  ? T
  : never;

export function databaseFailure(error: unknown): Accounting.AccountingError {
  if (error instanceof Accounting.AccountingError) return error;
  if (SqlError.isSqlError(error)) return failure("Unavailable");
  if (!(error instanceof EffectDrizzleQueryError)) return failure("InternalError");

  const nested = Cause.isCause(error.cause) ? Cause.findErrorOption(error.cause) : Option.none();
  if (Option.isNone(nested) || !SqlError.isSqlError(nested.value)) {
    return failure("InternalError");
  }
  const cause = nested.value.reason.cause;
  if (Schema.is(PostgresFailure)(cause)) {
    if (cause.code === "P0001" && Schema.is(Accounting.FailureCode)(cause.detail)) {
      return failure(cause.detail);
    }
    if (
      ["ECONNRESET", "EPIPE", "ETIMEDOUT", "40P01", "40001", "55P03"].includes(cause.code) ||
      cause.code.startsWith("08") ||
      cause.code.startsWith("53") ||
      ["57014", "57P01", "57P02", "57P03"].includes(cause.code) ||
      [
        "ConnectionError",
        "DeadlockError",
        "SerializationError",
        "LockTimeoutError",
        "StatementTimeoutError",
      ].includes(nested.value.reason._tag)
    ) {
      return failure("Unavailable");
    }
    return failure("InternalError");
  }
  return failure("Unavailable");
}

export function withTransaction<A, R>(
  use: (transaction: Transaction) => Effect.Effect<A, unknown, R>,
): Effect.Effect<A, Accounting.AccountingError, R | Database> {
  return Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .transaction((transaction) => use(transaction))
      .pipe(
        Effect.mapError(databaseFailure),
        Effect.catchCause((cause) => {
          if (Cause.hasInterrupts(cause)) {
            return Effect.failCause(
              Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)),
            );
          }
          return Effect.fail(databaseFailure(Cause.squash(cause)));
        }),
      );
  });
}
