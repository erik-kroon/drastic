import * as Vat from "@open-erp/contracts/vat-returns";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { digestJson } from "../../db/commerce/access";
import * as VatDb from "../../db/vat/returns";
import * as VatDrafts from "../../db/vat-return-drafts";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { decode, unsupported, type JsonObject } from "../commerce/support";

export const maximumFacts = 200;

export function digestValue(transaction: Transaction, value: Schema.Json) {
  return VatDb.readJsonDigest(transaction, value).pipe(
    Effect.flatMap((rows) => {
      const digest = rows[0]?.digest;
      return digest === undefined ? failure("InternalError") : Effect.succeed(digest);
    }),
  );
}

export function digestBody(transaction: Transaction, body: JsonObject) {
  return digestJson(transaction, body).pipe(
    Effect.flatMap((rows) => {
      const digest = rows[0]?.digest;
      return digest === undefined ? failure("InternalError") : Effect.succeed(digest);
    }),
    Effect.map((digest): JsonObject => Object.assign({}, body, { digest })),
  );
}

// The live basis is the single projection the jurisdiction calculation and every saved
// draft already consume; fact recording and retrieval read the same inventory.
export function readBasis(transaction: Transaction, bookId: string) {
  return Effect.gen(function* () {
    const state = (yield* VatDrafts.readBookState(transaction, bookId))[0];
    if (!state) return yield* failure("Forbidden");
    const counted = yield* VatDrafts.countFactComponents(transaction, bookId);
    if ((counted[0]?.total ?? 0) > maximumFacts) return yield* unsupported();
    const facts = (yield* VatDrafts.readBasisFacts(transaction, bookId))[0]?.facts ?? [];
    return yield* decode(
      Vat.VatBasis,
      yield* digestBody(transaction, {
        bookSequence: state.committedSequence,
        bookProfile: state.profile,
        bookProfileVersion: state.profileVersion,
        currency: state.currency,
        currencyScale: state.currencyScale,
        facts,
      }),
    );
  });
}

export function readCurrentFactObservations(transaction: Transaction, bookId: string) {
  return readBasis(transaction, bookId).pipe(Effect.map((basis) => basis.facts));
}

export function toJsonList(value: unknown) {
  return Schema.decodeUnknownEffect(Schema.Array(Schema.Json))(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

export function toJsonObjectList(value: unknown) {
  return Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject))(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}
