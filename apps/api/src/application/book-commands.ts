import { replay, saveCommand } from "./command-receipts";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { lockBookForUpdate } from "../db/posting";
import { databaseFailure, type Transaction } from "../db/transaction";
import { withAdmittedPrincipal, type AuthorityLockMode, type VerifiedPrincipal } from "./identity";

type Scope = typeof Accounting.Scope.Type;

type Principal = VerifiedPrincipal;

// Admission owns the transaction and authority locks. The mutation and its receipt
// use that same transaction, so an error rolls both back.
export function runBookCommandWithReceipt<A, E, R>(
  transaction: Transaction,
  command: {
    readonly scope: typeof Accounting.Scope.Type;
    readonly idempotencyKey: string;
    readonly operation: string;
    readonly actorId: string;
    readonly input: Schema.JsonObject;
  },
  schema: Schema.Decoder<A>,
  operation: Effect.Effect<{ readonly result: A; readonly receipt: Schema.JsonObject }, E, R>,
) {
  return Effect.gen(function* () {
    yield* lockBookForUpdate(transaction, command.scope);

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      command.operation,
      command.actorId,
      command.input,
      schema,
    );

    if (request.previous !== undefined) return request.previous;

    const { result, receipt } = yield* operation;

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      command.operation,
      command.actorId,
      receipt,
    );

    return result;
  });
}

export function runBookCommand<A extends Schema.JsonObject, E, R>(
  transaction: Transaction,
  command: Parameters<typeof runBookCommandWithReceipt>[1],
  schema: Schema.Decoder<A>,
  operation: Effect.Effect<A, E, R>,
) {
  return runBookCommandWithReceipt(
    transaction,
    command,
    schema,
    operation.pipe(Effect.map((result) => ({ result, receipt: result }))),
  );
}

export function withBook<Eff extends Effect.Effect<unknown, unknown, unknown>, A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  operation: (transaction: Transaction, principal: Principal) => Generator<Eff, A, never>,
  lockMode: AuthorityLockMode = "share",
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    { operatorOnly },
    (transaction, principal) =>
      Effect.gen(() => operation(transaction, principal)).pipe(Effect.mapError(databaseFailure)),
    lockMode,
  );
}
