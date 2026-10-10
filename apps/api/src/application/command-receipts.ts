import type * as Accounting from "@open-erp/contracts/accounting";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Db from "../db/posting";
import { readReservedCommand } from "../db/posting-admission";
import type { Transaction } from "../db/transaction";
import { failure } from "./failures";
import { digest } from "./json";

type Scope = typeof Accounting.Scope.Type;

type JsonObject = Schema.JsonObject;

function decode<A>(schema: Schema.Decoder<A>, value: JsonObject) {
  return Schema.decodeEffect(schema)(value).pipe(
    Effect.mapError((cause) => failure("InternalError", cause)),
  );
}

function requestDigest(operation: string, actorId: string, input: JsonObject) {
  return digest({ operation, actor: actorId, input }, "InternalError");
}

export function replay<A>(
  transaction: Transaction,
  scope: Scope,
  key: string,
  operation: string,
  actorId: string,
  input: JsonObject,
  schema: Schema.Decoder<A>,
) {
  return Effect.gen(function* () {
    const expected = yield* requestDigest(operation, actorId, input);
    const reserved = (yield* readReservedCommand(transaction, scope.bookId, key))[0];

    if (reserved) {
      const savedOperation =
        reserved.command.operation === "revoke_approval"
          ? "revoke_posting_approval"
          : reserved.command.operation;

      const payload =
        reserved.command.operation === "create_evidence" ||
        reserved.command.operation === "prepare_journal"
          ? reserved.command.input
          : { id: reserved.command.id ?? null, input: reserved.command.input ?? null };

      if (
        savedOperation !== operation ||
        reserved.actorId !== actorId ||
        !equalJson(payload, input)
      )
        return yield* failure("IdempotencyConflict");
    }

    const rows = yield* Db.readCommandReceipt(transaction, scope.bookId, key, "update");
    const row = rows[0];

    if (!row) return { expected, previous: undefined } as const;

    if (row.requestDigest !== expected || row.operation !== operation) {
      return yield* failure("IdempotencyConflict");
    }

    return { expected, previous: yield* decode(schema, row.result) } as const;
  });
}

export function saveCommand(
  transaction: Transaction,
  scope: Scope,
  key: string,
  request: string,
  operation: string,
  actorId: string,
  result: JsonObject,
) {
  return Db.insertCommandReceipt(transaction, {
    bookId: scope.bookId,
    key,
    requestDigest: request,
    operation,
    actorId,
    result,
  });
}

export function isoNow(transaction: Transaction) {
  return Db.readDatabaseTime(transaction).pipe(
    Effect.map((row) => new Date(row.now).toISOString()),
  );
}
