import * as Contracts from "@open-erp/contracts/processor-clearing";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Db from "../../db/banking/processor-clearing";
import * as CreditDb from "../../db/commerce/customer-receipts";
import * as PostingDb from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import {
  decode,
  requireTableAccess,
  toJsonObject,
  withBook,
  type Scope,
} from "../commerce/support";
import { digest, newId, replay, saveCommand } from "../posting";
import { failure } from "../failures";
import { readProcessorAccount } from "./processor-fetches";

export function readProcessorNativeCredit(tx: Transaction, scope: Scope, originId: string) {
  return Effect.gen(function* () {
    const basis = (yield* Db.readNativeCreditBasis(tx, scope.bookId, originId))[0];
    const origin = (yield* CreditDb.readOrigin(tx, scope.bookId, originId))[0];

    if (!basis || !origin || origin.sourceKind !== "native_processor_credit")
      return yield* failure("UnsupportedProfile");
    const effects = yield* CreditDb.readEffectsForOrigin(tx, scope.bookId, originId);
    const witness = yield* decode(Contracts.NativeCreditOrigin, basis.body);
    const voucher = (yield* PostingDb.readVoucher(tx, scope.bookId, basis.sourceVoucherId))[0];

    if (
      !voucher ||
      (yield* PostingDb.readVoucherByReversal(tx, scope.bookId, voucher.id)).length > 0
    )
      return yield* failure("StaleDependency");
    const action = yield* decode(Accounting.VoucherPostingAction, voucher.action);
    const line = action.lines.find((row) => row.lineId === basis.sourceLineId);

    if (
      !line ||
      line.accountId !== witness.liabilityAccountId ||
      line.creditMinor !== witness.originalCarryingMinor ||
      line.debitMinor !== "0"
    )
      return yield* failure("StaleDependency");

    const consumed = effects.reduce(
      (total, effect) => total + BigInt(effect.signedConsumedMinor),
      0n,
    );

    const native = BigInt(witness.originalNativeMinor);

    if (consumed < 0n || consumed > native) return yield* failure("StaleDependency");

    const released =
      (BigInt(witness.originalCarryingMinor) * consumed * 2n + native) / (native * 2n);

    return {
      witness,
      origin,
      effects,
      remainingNativeMinor: (native - consumed).toString(),
      remainingCarryingMinor: (BigInt(witness.originalCarryingMinor) - released).toString(),
      version: yield* digest({ origin, effects, basis }),
    };
  });
}

export const registerProcessorNativeCredit = Effect.fn("processor.registerNativeCredit")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Contracts.RegisterNativeCredit.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (tx, principal) {
    const request = yield* replay(
      tx,
      command.scope,
      command.idempotencyKey,
      "processor_register_native_credit",
      principal.actorId,
      yield* toJsonObject(command),
      Contracts.NativeCreditOrigin,
    );

    if (request.previous) return request.previous;
    yield* PostingDb.lockBookForUpdate(tx, command.scope);
    yield* requireTableAccess(tx, [...Db.tables, ...CreditDb.receiptTables], true);
    const account = yield* readProcessorAccount(tx, command.scope, command.input.accountId);
    const book = (yield* PostingDb.readBook(tx, command.scope))[0];

    const evidence = (yield* PostingDb.readEvidence(
      tx,
      command.scope.bookId,
      command.input.evidenceId,
    ))[0];

    if (
      !book ||
      book.currency === account.currency ||
      !evidence ||
      evidence.mediaType !== "application/json"
    )
      return yield* failure("UnsupportedProfile");

    const source = yield* Schema.decodeEffect(
      Schema.fromJsonString(Contracts.NativeCreditEvidence),
    )(evidence.content, { onExcessProperty: "error" }).pipe(
      Effect.mapError(() => failure("MissingEvidence")),
    );

    if (
      source.currency !== account.currency ||
      source.currencyScale !== account.currencyScale ||
      (yield* Db.readCustomer(tx, command.scope.bookId, source.customerId)).length === 0
    )
      return yield* failure("InvalidJournal");

    if (
      (yield* Db.readNativeCreditLine(tx, command.scope.bookId, source.voucherId, source.lineId))
        .length > 0 ||
      (yield* CreditDb.readOriginByReceipt(tx, command.scope.bookId, source.voucherId)).length > 0
    )
      return yield* failure("IdempotencyConflict");
    const voucher = (yield* PostingDb.readVoucher(tx, command.scope.bookId, source.voucherId))[0];

    if (
      !voucher ||
      voucher.correctsVoucherId !== null ||
      (yield* PostingDb.readVoucherByReversal(tx, command.scope.bookId, source.voucherId)).length >
        0
    )
      return yield* failure("StaleDependency");
    const action = yield* decode(Accounting.VoucherPostingAction, voucher.action);
    const line = action.lines.find((candidate) => candidate.lineId === source.lineId);

    const accounts = yield* PostingDb.readAccounts(tx, command.scope.bookId, [
      source.liabilityAccountId,
      source.receivableAccountId,
    ]);

    if (
      !line ||
      action.currency !== book.currency ||
      line.accountId !== source.liabilityAccountId ||
      line.debitMinor !== "0" ||
      BigInt(line.creditMinor) <= 0n ||
      accounts.length !== 2 ||
      accounts.some((candidate) => !candidate.active)
    )
      return yield* failure("InvalidJournal");

    const body = {
      id: newId("customer_credit_origin"),
      accountId: account.id,
      customerId: source.customerId,
      currency: source.currency,
      currencyScale: source.currencyScale,
      originalNativeMinor: source.nativeMinor,
      originalCarryingMinor: line.creditMinor,
      liabilityAccountId: source.liabilityAccountId,
      receivableAccountId: source.receivableAccountId,
      sourceVoucherId: voucher.id,
      sourceLineId: source.lineId,
      evidenceId: evidence.id,
      evidenceDigest: `sha256:${evidence.sha256}`,
    };

    const origin = yield* decode(Contracts.NativeCreditOrigin, {
      ...body,
      digest: yield* digest(body),
    });

    yield* CreditDb.insertOrigin(tx, {
      bookId: command.scope.bookId,
      id: origin.id,
      customerId: origin.customerId,
      currency: origin.currency,
      originalMinor: origin.originalNativeMinor,
      sourceKind: "native_processor_credit",
      sourceRef: evidence.id,
      creditLiabilityAccountId: origin.liabilityAccountId,
      receivableControlAccountId: origin.receivableAccountId,
      receiptId: voucher.id,
      digest: origin.digest,
    });
    yield* Db.insertNativeCreditBasis(tx, {
      bookId: command.scope.bookId,
      originId: origin.id,
      ...origin,
      body: yield* toJsonObject(origin),
    });
    yield* saveCommand(
      tx,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "processor_register_native_credit",
      principal.actorId,
      yield* toJsonObject(origin),
    );

    return origin;
  });
});
