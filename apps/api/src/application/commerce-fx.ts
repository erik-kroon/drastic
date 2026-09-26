import { admitPosting } from "./posting-admission";
import * as Accounting from "@open-erp/contracts/accounting";
import * as CommerceFx from "@open-erp/contracts/commerce-fx";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Rates from "@open-erp/contracts/exchange-rates";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { failure } from "./failures";
import { withAdmittedPrincipal, type VerifiedPrincipal } from "./identity";
import {
  digest,
  isoNow,
  newId,
  readBook,
  readPeriod,
  readVoucher,
  replay,
  saveCommand,
} from "./posting";
import * as Db from "../db/posting";
import * as FxDb from "../db/commerce-fx";
import { databaseFailure, type Transaction } from "../db/transaction";

type Scope = typeof Accounting.Scope.Type;

type Principal = VerifiedPrincipal;

type JsonObject = Schema.JsonObject;

type RecognitionInput = typeof CommerceFx.PrepareRecognition.Type;

type SettlementInput = typeof CommerceFx.PrepareSettlement.Type;

type PartialSettlementInput = typeof CommerceFx.PreparePartialSettlement.Type;

type CorrectionInput = typeof CommerceFx.PrepareSettlementCorrection.Type;

type Review = typeof CommerceFx.RecognitionReview.Type;

type SettlementReview = typeof CommerceFx.SettlementReview.Type;

type PartialSettlementReview = typeof CommerceFx.PartialSettlementReview.Type;

type CorrectionReview = typeof CommerceFx.SettlementCorrectionReview.Type;

type AnyReview = Review | SettlementReview | PartialSettlementReview | CorrectionReview;

const RecognitionSchema = CommerceFx.RecognitionReview;

const SettlementSchema = CommerceFx.SettlementReview;

const PartialSettlementSchema = CommerceFx.PartialSettlementReview;

const CorrectionSchema = CommerceFx.SettlementCorrectionReview;

const ItemSchema = CommerceFx.MonetaryItem;

const FullSettlementReceiptSchema = CommerceFx.SettlementReceipt;

const PartialSettlementReceiptSchema = CommerceFx.PartialSettlementReceipt;

const CorrectionReceiptSchema = CommerceFx.CorrectionReceipt;

function decode<A>(schema: Schema.Decoder<A>, value: JsonObject) {
  return Schema.decodeEffect(schema)(value).pipe(Effect.mapError(() => failure("InternalError")));
}

function toJsonObject(value: unknown) {
  return Schema.decodeUnknownEffect(Schema.JsonObject)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

function withBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown, never>,
  lockMode: "share" | "update" = "update",
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    { operatorOnly },
    (transaction, principal) =>
      operation(transaction, principal).pipe(Effect.mapError(databaseFailure)),
    lockMode,
  );
}

function unsupported() {
  return failure("UnsupportedProfile");
}

function requireDirectAccess(transaction: Transaction, write: boolean) {
  return FxDb.readDirectTableAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      if (rows.some((row) => !row.canSelect || (write && !row.canInsert))) {
        return unsupported();
      }

      return Effect.void;
    }),
  );
}

function dateValue(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value
    ? failure("InvalidJournal")
    : Effect.succeed(value);
}

function assertNative(book: { profile: string; authority: string }) {
  return book.profile === "synthetic-core-v1" && book.authority === "native"
    ? Effect.void
    : unsupported();
}

function evidenceReference(row: { id: string; sha256: string }) {
  return { evidenceId: row.id, sha256: row.sha256 };
}

function commandReceipt(key: string, operation: string, actorId: string) {
  return { key, operation, actorId };
}

function pow10(value: number) {
  return 10n ** BigInt(value);
}

function exactHalfUp(numerator: bigint, denominator: bigint) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);

  return {
    numerator,
    denominator,
    quotient,
    remainder,
    rounded,
    residual: numerator - rounded * denominator,
  };
}

function exactMinor(value: string) {
  return /^[1-9][0-9]{0,37}$/.test(value) ? BigInt(value) : undefined;
}

function isJsonObject(value: Schema.Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: Schema.Json | undefined) {
  if (typeof value !== "string") throw new Error("Expected text");

  return value;
}

function optionalText(value: Schema.Json | undefined) {
  return value === null || value === undefined ? null : requiredText(value);
}

function signedMinor(value: bigint) {
  return value < 0n ? `-${(-value).toString()}` : value.toString();
}

function absoluteMinor(value: bigint) {
  return (value < 0n ? -value : value).toString();
}

function readEvidence(transaction: Transaction, bookId: string, evidenceId: string) {
  return Db.readEvidence(transaction, bookId, evidenceId);
}

function readEvidenceOrFail(transaction: Transaction, bookId: string, evidenceId: string) {
  return readEvidence(transaction, bookId, evidenceId).pipe(
    Effect.flatMap((rows) => (rows[0] ? Effect.succeed(rows[0]) : failure("MissingEvidence"))),
  );
}

function accountBindings(
  input: RecognitionInput,
  accounts: Array<{ id: string; version: bigint }>,
) {
  const values = new Map(accounts.map((account) => [account.id, account]));

  const roles = [
    ["control", input.controlAccountId],
    ["revenue", input.revenueAccountId],
    ["cash", input.cashAccountId],
    ["realized_gain", input.realizedGainAccountId],
    ["realized_loss", input.realizedLossAccountId],
  ] as const;

  return roles.map(([role, accountId]) => {
    const account = values.get(accountId);

    if (!account) throw new Error("Missing account binding");

    return { role, accountId, version: account.version.toString() };
  });
}

function requireAccountRoles(
  transaction: Transaction,
  scope: Scope,
  input: RecognitionInput,
  roleEvidence: { evidenceId: string; sha256: string },
) {
  return Effect.gen(function* () {
    const accountIds = [
      input.controlAccountId,
      input.revenueAccountId,
      input.cashAccountId,
      input.realizedGainAccountId,
      input.realizedLossAccountId,
    ];

    if (new Set(accountIds).size !== 5) return yield* failure("InvalidJournal");
    const accounts = yield* Db.readAccounts(transaction, scope.bookId, accountIds);

    if (accounts.length !== 5 || accounts.some((account) => !account.active)) {
      return yield* failure("InvalidJournal");
    }

    const evidence = yield* readEvidenceOrFail(transaction, scope.bookId, roleEvidence.evidenceId);

    if (evidence.sha256 !== roleEvidence.sha256) return yield* failure("StaleDependency");

    if (
      (yield* FxDb.readBankAccount(transaction, scope.bookId, input.cashAccountId)).length === 0
    ) {
      return yield* failure("InvalidJournal");
    }

    for (const accountId of accountIds.filter((_, index) => index !== 2)) {
      if ((yield* FxDb.readBankAccount(transaction, scope.bookId, accountId)).length > 0) {
        return yield* failure("InvalidJournal");
      }

      for (const table of [
        "commerce_control_accounts",
        "owner_control_accounts",
        "vat_control_account_roles",
      ] as const) {
        if (
          (yield* FxDb.readControlAccount(transaction, scope.bookId, table, accountId)).length > 0
        ) {
          return yield* failure("InvalidJournal");
        }
      }
    }

    return { evidence, bindings: accountBindings(input, accounts) };
  });
}

function bookBasis(book: {
  currency: string;
  currencyScale: number;
  profile: string;
  profileVersion: bigint;
  authority: string;
  writerEpoch: bigint;
}) {
  return {
    currency: book.currency,
    currencyScale: book.currencyScale,
    profile: book.profile,
    profileVersion: book.profileVersion.toString(),
    writerAuthority: book.authority,
    writerEpoch: book.writerEpoch.toString(),
  };
}

function settlementItemSnapshot(item: typeof ItemSchema.Type) {
  return {
    id: item.id,
    digest: item.digest,
    source: item.source,
    rate: item.rate,
    accountBindings: item.accountBindings,
    remainingOriginalMinor: item.remainingOriginalMinor,
    remainingCarryingMinor: item.remainingCarryingMinor,
  };
}

function readItemState(transaction: Transaction, scope: Scope, itemId: string) {
  return Effect.gen(function* () {
    const itemRows = yield* FxDb.readItem(transaction, scope.bookId, itemId);
    const itemRow = itemRows[0];

    if (!itemRow) return yield* failure("NotFound");
    const settlementRows = yield* FxDb.readSettlements(transaction, scope.bookId, itemId);
    const correctionRows = yield* FxDb.readCorrections(transaction, scope.bookId, itemId);
    const correctionsBySettlement = new Map(correctionRows.map((row) => [row.settlementId, row]));

    const full = settlementRows.find(
      (row) => row.profile === "synthetic_full_book_currency_settlement_v1",
    );

    const partials = settlementRows.filter(
      (row) => row.profile === "synthetic_partial_book_currency_settlement_v1",
    );

    const fullCorrection = full ? correctionsBySettlement.get(full.id) : undefined;

    const activeOriginal = settlementRows.reduce(
      (total, row) =>
        total + (correctionsBySettlement.has(row.id) ? 0n : BigInt(row.originalReleasedMinor)),
      0n,
    );

    const activeCarrying = settlementRows.reduce(
      (total, row) =>
        total + (correctionsBySettlement.has(row.id) ? 0n : BigInt(row.carryingReleasedMinor)),
      0n,
    );

    const initialOriginalValue = itemRow.body.initialOriginalMinor;
    const initialCarryingValue = itemRow.body.initialCarryingMinor;

    if (typeof initialOriginalValue !== "string" || typeof initialCarryingValue !== "string") {
      return yield* failure("StaleDependency");
    }

    const initialOriginal = BigInt(initialOriginalValue);
    const initialCarrying = BigInt(initialCarryingValue);

    if (activeOriginal > initialOriginal || activeCarrying > initialCarrying) {
      return yield* failure("StaleDependency");
    }

    const status =
      activeOriginal === 0n && activeCarrying === 0n && settlementRows.length > 0
        ? settlementRows.every((row) => correctionsBySettlement.has(row.id))
          ? "corrected"
          : "settled"
        : activeOriginal === initialOriginal && activeCarrying === initialCarrying
          ? "settled"
          : settlementRows.length === 0
            ? "open"
            : "partially_settled";

    const itemValue = Object.assign({}, itemRow.body, {
      status,
      remainingOriginalMinor: (initialOriginal - activeOriginal).toString(),
      remainingCarryingMinor: (initialCarrying - activeCarrying).toString(),
      settlement: full?.body ?? null,
      correction: fullCorrection?.body ?? null,
    });

    if (partials.length > 0) {
      Object.assign(itemValue, {
        partialSettlements: partials.map((row) => row.body),
        partialCorrections: partials
          .filter((row) => correctionsBySettlement.has(row.id))
          .map((row) => correctionsBySettlement.get(row.id)?.body)
          .filter((body): body is JsonObject => body !== undefined),
      });
    }

    const item = yield* decode(ItemSchema, itemValue);

    return { itemRow, item, settlementRows, correctionRows, full, fullCorrection };
  });
}

function readReview(
  transaction: Transaction,
  kind: "recognition" | "settlement" | "correction",
  scope: Scope,
  id: string,
  lock: "share" | "update" = "share",
) {
  if (kind === "recognition") {
    return FxDb.readRecognitionReview(transaction, scope.bookId, id, lock);
  }

  if (kind === "settlement") {
    return FxDb.readSettlementReview(transaction, scope.bookId, id, lock);
  }

  return FxDb.readCorrectionReview(transaction, scope.bookId, id, lock);
}

function readApproval(
  transaction: Transaction,
  kind: "recognition" | "settlement" | "correction",
  scope: Scope,
  reviewId: string,
  approvalId: string,
  lock: "share" | "update" = "share",
) {
  if (kind === "recognition") {
    return FxDb.readRecognitionApproval(transaction, scope.bookId, reviewId, approvalId, lock);
  }

  if (kind === "settlement") {
    return FxDb.readSettlementApproval(transaction, scope.bookId, reviewId, approvalId, lock);
  }

  return FxDb.readCorrectionApproval(transaction, scope.bookId, reviewId, approvalId, lock);
}

function insertApproval(
  transaction: Transaction,
  kind: "recognition" | "settlement" | "correction",
  row: {
    bookId: string;
    id: string;
    reviewId: string;
    actorId: string;
    digest: string;
    expiresAt: string;
    body: JsonObject;
  },
) {
  if (kind === "recognition") return FxDb.insertRecognitionApproval(transaction, row);

  if (kind === "settlement") return FxDb.insertSettlementApproval(transaction, row);

  return FxDb.insertCorrectionApproval(transaction, row);
}

function currentApproval(
  transaction: Transaction,
  kind: "recognition" | "settlement" | "correction",
  scope: Scope,
  reviewId: string,
  approvalId: string,
  reviewDigest: string,
) {
  return Effect.gen(function* () {
    const rows = yield* readApproval(transaction, kind, scope, reviewId, approvalId, "update");
    const approval = rows[0];

    if (!approval || approval.digest !== reviewDigest) return yield* failure("ApprovalRequired");
    const now = yield* isoNow(transaction);

    if (Date.parse(approval.expiresAt) <= Date.parse(now))
      return yield* failure("ApprovalRequired");

    if (
      (yield* Db.readOperatorMembership(transaction, scope.bookId, approval.actorId)).length === 0
    ) {
      return yield* failure("ApprovalRequired");
    }

    if ((yield* Db.readActorAdmission(transaction, approval.actorId))[0]?.enabled === false) {
      return yield* failure("ApprovalRequired");
    }

    return approval;
  });
}

function periodSelection(transaction: Transaction, scope: Scope, periodId: string, date: string) {
  return Effect.gen(function* () {
    const period = yield* readPeriod(transaction, scope, periodId);

    if (period.locked || date < period.startsOn || date > period.endsOn) {
      return yield* failure("PeriodLocked");
    }

    if (date < period.fiscalYear.startsOn || date > period.fiscalYear.endsOn) {
      return yield* failure("InvalidJournal");
    }

    return period;
  });
}

function currentRate(
  transaction: Transaction,
  scope: Scope,
  input: RecognitionInput,
  book: { currency: string },
) {
  return Effect.gen(function* () {
    const rateRows = yield* FxDb.readCurrentRate(
      transaction,
      scope.bookId,
      input.rateObservationId,
    );

    const rateRow = rateRows[0];

    if (!rateRow) return yield* failure("NotFound");
    const rate = yield* decode(Rates.ExchangeRateRevision, rateRow.body);

    if (
      (yield* FxDb.readRateWithdrawal(transaction, scope.bookId, input.rateObservationId)).length >
      0
    ) {
      return yield* failure("StaleDependency");
    }

    if (
      input.rateDigest !== rate.digest ||
      rate.terms.fromCurrency !== input.originalCurrency ||
      rate.terms.toCurrency !== book.currency ||
      rate.terms.effectiveOn !== input.recognitionDate
    ) {
      return yield* failure("StaleDependency");
    }

    return rate;
  });
}

function currentCounterparty(transaction: Transaction, scope: Scope, input: RecognitionInput) {
  return FxDb.readCounterparty(transaction, scope.bookId, input.counterpartyId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];

      if (!row) return Effect.fail(failure("NotFound"));

      if (row.role !== "customer" && row.role !== "both")
        return Effect.fail(failure("StaleDependency"));

      if (row.currentRevision !== input.counterpartyRevision)
        return Effect.fail(failure("StaleDependency"));

      return decode(Commerce.CounterpartyRevision, row.body);
    }),
  );
}

function recognitionSnapshot(
  transaction: Transaction,
  scope: Scope,
  input: RecognitionInput,
): Effect.Effect<JsonObject, Accounting.AccountingError> {
  return Effect.gen(function* () {
    const date = yield* dateValue(input.recognitionDate);

    if (date !== input.recognitionDate) return yield* failure("InvalidJournal");
    const book = yield* readBook(transaction, scope);
    yield* assertNative(book);

    if (input.originalCurrency === book.currency) return yield* unsupported();
    const period = yield* periodSelection(transaction, scope, input.accountingPeriodId, date);
    const counterparty = yield* currentCounterparty(transaction, scope, input);
    const rate = yield* currentRate(transaction, scope, input, book);
    const sourceEvidence = yield* readEvidenceOrFail(transaction, scope.bookId, input.evidenceId);
    const role = yield* requireAccountRoles(transaction, scope, input, input.accountRoleEvidence);

    if ((yield* FxDb.readItemBySourceKey(transaction, scope.bookId, input.sourceKey)).length > 0) {
      return yield* failure("IdempotencyConflict");
    }

    if (
      (yield* Db.readEvent(transaction, scope.bookId, input.evidenceId, input.eventKey)).length > 0
    ) {
      return yield* failure("IdempotencyConflict");
    }

    const amount = exactMinor(input.originalMinor);

    if (amount === undefined) return yield* failure("InvalidJournal");
    const numerator = amount * BigInt(rate.terms.rateNumerator) * pow10(book.currencyScale);
    const denominator = BigInt(rate.terms.rateDenominator) * pow10(input.originalScale);
    const exact = exactHalfUp(numerator, denominator);

    if (exact.rounded <= 0n || exact.rounded >= 10n ** 38n) return yield* failure("InvalidJournal");

    const calculation = {
      originalCurrency: input.originalCurrency,
      originalScale: input.originalScale,
      originalMinor: amount.toString(),
      bookCurrency: book.currency,
      bookScale: book.currencyScale,
      carryingMinor: exact.rounded.toString(),
      exactNumerator: exact.numerator.toString(),
      exactDenominator: exact.denominator.toString(),
      quotientMinor: exact.quotient.toString(),
      remainderNumerator: exact.remainder.toString(),
      residualNumerator: signedMinor(exact.residual),
      residualDenominator: exact.denominator.toString(),
      roundingPolicy: "synthetic_half_up_nonnegative_v1" as const,
      formula:
        "N = originalMinor * rateNumerator * 10^bookScale; D = rateDenominator * 10^originalScale; rounded = div(N,D) + (2*mod(N,D) >= D ? 1 : 0); residualNumerator = N - rounded*D",
    } satisfies JsonObject;

    return yield* toJsonObject({
      bookBasis: bookBasis(book),
      rate,
      counterpart: counterparty,
      sourceEvidence: evidenceReference(sourceEvidence),
      accountRoleEvidence: input.accountRoleEvidence,
      accountBindings: role.bindings,
      calculation,
      fiscalYearId: period.fiscalYearId,
      profileVersion: book.profileVersion.toString(),
      writerEpoch: book.writerEpoch.toString(),
      periodVersion: period.version.toString(),
    });
  }).pipe(Effect.mapError(databaseFailure));
}

function settlementSnapshot(
  transaction: Transaction,
  scope: Scope,
  input: SettlementInput | PartialSettlementInput,
): Effect.Effect<JsonObject, Accounting.AccountingError> {
  return Effect.gen(function* () {
    const isPartial = "originalReleasedMinor" in input;
    const date = yield* dateValue(input.settlementDate);
    const itemState = yield* readItemState(transaction, scope, input.itemId);
    const item = itemState.item;
    const remainingOriginal = BigInt(String(item.remainingOriginalMinor));
    const remainingCarrying = BigInt(String(item.remainingCarryingMinor));

    if (remainingOriginal <= 0n || remainingCarrying < 0n) return yield* failure("StaleDependency");

    if (
      !isPartial &&
      (item.status !== "open" ||
        remainingOriginal !== BigInt(String(item.initialOriginalMinor)) ||
        remainingCarrying !== BigInt(String(item.initialCarryingMinor)))
    ) {
      return yield* failure("StaleDependency");
    }

    if (isPartial && !["open", "partially_settled", "corrected"].includes(String(item.status))) {
      return yield* failure("StaleDependency");
    }

    if (isPartial && BigInt(input.originalReleasedMinor) > remainingOriginal) {
      return yield* failure("InvalidJournal");
    }

    if (date < String(item.source.recognitionDate)) return yield* failure("InvalidJournal");
    const book = yield* readBook(transaction, scope);
    yield* assertNative(book);
    const period = yield* periodSelection(transaction, scope, input.accountingPeriodId, date);
    const sourceEvidence = yield* readEvidenceOrFail(transaction, scope.bookId, input.evidenceId);

    if (
      (yield* Db.readEvent(transaction, scope.bookId, input.evidenceId, input.eventKey)).length > 0
    ) {
      return yield* failure("IdempotencyConflict");
    }

    const accounts = yield* Db.readAccounts(
      transaction,
      scope.bookId,
      item.accountBindings.map((binding) => binding.accountId),
    );

    const accountsById = new Map(accounts.map((account) => [account.id, account]));

    if (
      item.accountBindings.some((binding) => {
        const account = accountsById.get(binding.accountId);

        return !account?.active || account.version.toString() !== binding.version;
      })
    ) {
      return yield* failure("StaleDependency");
    }

    const cash = item.accountBindings.find((binding) => binding.role === "cash");

    if (
      !cash ||
      (yield* FxDb.readBankAccount(transaction, scope.bookId, cash.accountId)).length === 0
    ) {
      return yield* failure("StaleDependency");
    }

    const consideration = exactMinor(input.considerationMinor);

    if (consideration === undefined) return yield* failure("InvalidJournal");

    if (!isPartial) {
      const gain = consideration - remainingCarrying;

      if (gain >= 10n ** 38n || gain <= -(10n ** 38n)) return yield* failure("InvalidJournal");

      return yield* toJsonObject({
        item: settlementItemSnapshot(item),
        sourceEvidence: evidenceReference(sourceEvidence),
        calculation: {
          originalReleasedMinor: remainingOriginal.toString(),
          carryingReleasedMinor: remainingCarrying.toString(),
          considerationMinor: consideration.toString(),
          realizedGainMinor: signedMinor(gain),
          formula:
            "realizedGainMinor = considerationMinor - carryingReleasedMinor; positive gain is credit and negative loss is debit",
        },
        fiscalYearId: period.fiscalYearId,
        profileVersion: book.profileVersion.toString(),
        writerEpoch: book.writerEpoch.toString(),
        periodVersion: period.version.toString(),
        accountBindings: item.accountBindings,
      });
    }

    const releasedOriginal = BigInt(input.originalReleasedMinor);
    const exact = exactHalfUp(remainingCarrying * releasedOriginal, remainingOriginal);
    const afterOriginal = remainingOriginal - releasedOriginal;
    const afterCarrying = remainingCarrying - exact.rounded;

    if (
      exact.rounded < 0n ||
      exact.rounded >= 10n ** 38n ||
      afterOriginal < 0n ||
      afterCarrying < 0n
    ) {
      return yield* failure("InvalidJournal");
    }

    const gain = consideration - exact.rounded;

    if (gain >= 10n ** 38n || gain <= -(10n ** 38n)) return yield* failure("InvalidJournal");
    const nextOrdinal = Math.max(0, ...itemState.settlementRows.map((row) => row.legOrdinal)) + 1;

    return yield* toJsonObject({
      item: settlementItemSnapshot(item),
      sourceEvidence: evidenceReference(sourceEvidence),
      calculation: {
        legOrdinal: nextOrdinal,
        originalRemainingBeforeMinor: remainingOriginal.toString(),
        originalReleasedMinor: releasedOriginal.toString(),
        originalRemainingAfterMinor: afterOriginal.toString(),
        carryingRemainingBeforeMinor: remainingCarrying.toString(),
        carryingReleasedMinor: exact.rounded.toString(),
        carryingRemainingAfterMinor: afterCarrying.toString(),
        exactNumerator: exact.numerator.toString(),
        exactDenominator: exact.denominator.toString(),
        quotientMinor: exact.quotient.toString(),
        remainderNumerator: exact.remainder.toString(),
        residualNumerator: signedMinor(exact.residual),
        residualDenominator: exact.denominator.toString(),
        roundingPolicy: "synthetic_half_up_nonnegative_v1" as const,
        finalLeg: afterOriginal === 0n,
        considerationMinor: consideration.toString(),
        realizedGainMinor: signedMinor(gain),
        formula:
          "N = carryingRemainingBeforeMinor * originalReleasedMinor; D = originalRemainingBeforeMinor; rounded = div(N,D) + (2*mod(N,D) >= D ? 1 : 0); final leg releases the exact remaining carrying amount; realizedGainMinor = considerationMinor - carryingReleasedMinor",
      },
      fiscalYearId: period.fiscalYearId,
      profileVersion: book.profileVersion.toString(),
      writerEpoch: book.writerEpoch.toString(),
      periodVersion: period.version.toString(),
      accountBindings: item.accountBindings,
    });
  }).pipe(Effect.mapError(databaseFailure));
}

function correctionSnapshot(
  transaction: Transaction,
  scope: Scope,
  input: CorrectionInput,
): Effect.Effect<JsonObject, Accounting.AccountingError> {
  return Effect.gen(function* () {
    const date = yield* dateValue(input.postingDate);

    const settlementRows = yield* FxDb.readSettlement(
      transaction,
      scope.bookId,
      input.settlementId,
    );

    const settlementRow = settlementRows[0];

    if (!settlementRow) return yield* failure("NotFound");

    if (
      (yield* FxDb.readCorrectionBySettlement(transaction, scope.bookId, settlementRow.id)).length >
      0
    ) {
      return yield* failure("AlreadyPosted");
    }

    const later = yield* FxDb.readUnconsumedSettlementsAfter(
      transaction,
      scope.bookId,
      settlementRow.itemId,
      settlementRow.legOrdinal,
    );

    if (later.length > 0) return yield* unsupported();
    const voucher = yield* readVoucher(transaction, scope, settlementRow.voucherId);

    if (
      voucher.action.correctsVoucherId !== null ||
      (yield* Db.readVoucherByReversal(transaction, scope.bookId, settlementRow.voucherId)).length >
        0
    ) {
      return yield* failure("StaleDependency");
    }

    if (voucher.action.postingDate > date) return yield* failure("InvalidJournal");
    const itemState = yield* readItemState(transaction, scope, settlementRow.itemId);

    if (
      settlementRow.profile === "synthetic_full_book_currency_settlement_v1" &&
      (itemState.item.status !== "settled" ||
        itemState.item.remainingOriginalMinor !== "0" ||
        itemState.item.remainingCarryingMinor !== "0")
    ) {
      return yield* failure("StaleDependency");
    }

    if (
      settlementRow.profile === "synthetic_partial_book_currency_settlement_v1" &&
      !["settled", "partially_settled"].includes(String(itemState.item.status))
    ) {
      return yield* failure("StaleDependency");
    }

    const book = yield* readBook(transaction, scope);
    yield* assertNative(book);
    const period = yield* periodSelection(transaction, scope, input.accountingPeriodId, date);
    const sourceEvidence = yield* readEvidenceOrFail(transaction, scope.bookId, input.evidenceId);

    const accounts = yield* Db.readAccounts(
      transaction,
      scope.bookId,
      itemState.item.accountBindings.map((binding) => binding.accountId),
    );

    const accountsById = new Map(accounts.map((account) => [account.id, account]));

    if (
      itemState.item.accountBindings.some((binding) => {
        const account = accountsById.get(binding.accountId);

        return !account?.active || account.version.toString() !== binding.version;
      })
    ) {
      return yield* failure("StaleDependency");
    }

    const settlement =
      settlementRow.profile === "synthetic_partial_book_currency_settlement_v1"
        ? yield* decode(PartialSettlementReceiptSchema, settlementRow.body)
        : yield* decode(FullSettlementReceiptSchema, settlementRow.body);

    return yield* toJsonObject({
      item: itemState.item,
      settlement,
      voucher,
      sourceEvidence: evidenceReference(sourceEvidence),
      reversalLines: voucher.action.lines.map((line) => ({
        ...line,
        lineId: newId("line"),
        debitMinor: line.creditMinor,
        creditMinor: line.debitMinor,
      })),
      fiscalYearId: period.fiscalYearId,
      profileVersion: book.profileVersion.toString(),
      writerEpoch: book.writerEpoch.toString(),
      periodVersion: period.version.toString(),
      accountBindings: itemState.item.accountBindings,
    });
  }).pipe(Effect.mapError(databaseFailure));
}

function isRecognitionInput(
  input: RecognitionInput | SettlementInput | PartialSettlementInput | CorrectionInput,
): input is RecognitionInput {
  return input.profile === "synthetic_customer_foreign_receivable_v1";
}

function isSettlementInput(
  input: RecognitionInput | SettlementInput | PartialSettlementInput | CorrectionInput,
): input is SettlementInput | PartialSettlementInput {
  return (
    input.profile === "synthetic_full_book_currency_settlement_v1" ||
    input.profile === "synthetic_partial_book_currency_settlement_v1"
  );
}

function isCorrectionInput(
  input: RecognitionInput | SettlementInput | PartialSettlementInput | CorrectionInput,
): input is CorrectionInput {
  return input.profile === "synthetic_latest_settlement_correction_v1";
}

function isRecognitionReview(review: AnyReview): review is Review {
  return review.input.profile === "synthetic_customer_foreign_receivable_v1";
}

function isSettlementReview(
  review: AnyReview,
): review is SettlementReview | PartialSettlementReview {
  return (
    review.input.profile === "synthetic_full_book_currency_settlement_v1" ||
    review.input.profile === "synthetic_partial_book_currency_settlement_v1"
  );
}

function isPartialSettlementReview(
  review: SettlementReview | PartialSettlementReview,
): review is PartialSettlementReview {
  return review.input.profile === "synthetic_partial_book_currency_settlement_v1";
}

function isCorrectionReview(review: AnyReview): review is CorrectionReview {
  return review.input.profile === "synthetic_latest_settlement_correction_v1";
}

function currentSnapshot(
  transaction: Transaction,
  kind: "recognition" | "settlement" | "partial_settlement" | "correction",
  scope: Scope,
  input: RecognitionInput | SettlementInput | PartialSettlementInput | CorrectionInput,
): Effect.Effect<JsonObject, Accounting.AccountingError> {
  if (kind === "recognition" && isRecognitionInput(input)) {
    return recognitionSnapshot(transaction, scope, input);
  }

  if (kind === "correction" && isCorrectionInput(input)) {
    return correctionSnapshot(transaction, scope, input);
  }

  if ((kind === "settlement" || kind === "partial_settlement") && isSettlementInput(input)) {
    return settlementSnapshot(transaction, scope, input);
  }

  return Effect.fail(failure("InternalError"));
}

function readSavedReview(
  transaction: Transaction,
  kind: "recognition" | "settlement" | "correction",
  scope: Scope,
  id: string,
): Effect.Effect<AnyReview, Accounting.AccountingError> {
  return Effect.gen(function* () {
    const rows = yield* readReview(transaction, kind, scope, id, "update").pipe(
      Effect.mapError(databaseFailure),
    );

    const row = rows[0];

    if (!row) return yield* failure("NotFound");

    if (kind === "recognition") return yield* decode(RecognitionSchema, row.body);

    if (kind === "correction") return yield* decode(CorrectionSchema, row.body);
    const input = row.body.input;

    if (input === undefined) return yield* failure("InternalError");
    const profile = isJsonObject(input) ? input.profile : undefined;

    return profile === "synthetic_partial_book_currency_settlement_v1"
      ? yield* decode(PartialSettlementSchema, row.body)
      : yield* decode(SettlementSchema, row.body);
  });
}

function readSavedSettlementReview(transaction: Transaction, scope: Scope, id: string) {
  return readSavedReview(transaction, "settlement", scope, id).pipe(
    Effect.flatMap((review) =>
      isSettlementReview(review) ? Effect.succeed(review) : Effect.fail(failure("InternalError")),
    ),
  );
}

function assertReviewCurrent(
  transaction: Transaction,
  kind: "recognition" | "settlement" | "partial_settlement" | "correction",
  scope: Scope,
  review: AnyReview,
) {
  return Effect.gen(function* () {
    const current = yield* currentSnapshot(transaction, kind, scope, review.input);

    // Reversal IDs are allocated when the review is sealed. Freshness compares
    // the financial content; execution still uses the IDs in that sealed review.
    const snapshotContent = (snapshot: typeof CorrectionSchema.fields.snapshot.Type) => ({
      ...snapshot,
      reversalLines: snapshot.reversalLines.map((line) => ({
        accountId: line.accountId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        description: line.description,
      })),
    });

    const currentContent =
      kind === "correction"
        ? snapshotContent(yield* decode(CorrectionSchema.fields.snapshot, current))
        : current;

    const savedContent =
      kind === "correction"
        ? snapshotContent(yield* decode(CorrectionSchema.fields.snapshot, review.snapshot))
        : review.snapshot;

    if ((yield* digest(currentContent)) !== (yield* digest(savedContent))) {
      return yield* failure("StaleDependency");
    }
  });
}

function makeReviewBody(
  scope: Scope,
  id: string,
  input: JsonObject,
  snapshot: JsonObject,
  principal: Principal,
  key: string,
  operation: string,
  createdAt: string,
  extra: JsonObject,
) {
  return Object.assign({ id, scope, version: 1 }, extra, {
    input,
    snapshot,
    createdBy: principal.actorId,
    createdAt,
    receipt: commandReceipt(key, operation, principal.actorId),
  });
}

function reviewDigest(value: JsonObject) {
  return digest(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== "digest")),
    "StaleDependency",
  );
}

function makePlanAndPost(
  transaction: Transaction,
  scope: Scope,
  principal: Principal,
  approval: FxDb.FxApprovalRow,
  action: JsonObject,
) {
  return Effect.gen(function* () {
    const createdAt = yield* isoNow(transaction);
    const changeSetId = newId("change");
    const groupId = newId("group");

    const planWithoutDigest = {
      schemaVersion: "1" as const,
      canonicalization: "openerp-c14n-v1" as const,
      id: changeSetId,
      version: 1 as const,
      scope,
      createdAt,
      dependencies: [],
      groups: [{ id: groupId, dependsOnGroupIds: [], actions: [action] }],
    } satisfies JsonObject;

    const planDigest = yield* digest(planWithoutDigest);
    const plan = { ...planWithoutDigest, planDigest } satisfies JsonObject;
    yield* Db.insertPlan(transaction, {
      bookId: scope.bookId,
      id: changeSetId,
      plan,
      digest: planDigest,
      createdBy: principal.actorId,
    });
    yield* Db.insertApproval(transaction, {
      bookId: scope.bookId,
      id: approval.id,
      changeSetId,
      digest: planDigest,
      actorId: approval.actorId,
      expiresAt: approval.expiresAt,
    });
    yield* admitPosting(transaction, scope, changeSetId, action, {
      kind: "commerce_fx",
      id: approval.reviewId,
    });
    const consumedAt = yield* isoNow(transaction);
    const consumed = yield* Db.consumeApproval(transaction, scope.bookId, approval.id, consumedAt);

    if (consumed.length !== 1) return yield* failure("InternalError");

    const series = yield* Db.allocateSeriesCounter(
      transaction,
      scope.bookId,
      requiredText(action.fiscalYearId),
      requiredText(action.series),
    );

    const sequence = yield* Db.allocateSequence(transaction, scope.bookId);
    const voucherNumber = series[0]?.lastNumber;
    const sequenceValue = sequence[0]?.sequence;

    if (voucherNumber === undefined || sequenceValue === undefined)
      return yield* failure("InternalError");
    const voucherId = newId("voucher");

    const voucher = yield* Db.insertVoucher(transaction, {
      bookId: scope.bookId,
      id: voucherId,
      fiscalYearId: requiredText(action.fiscalYearId),
      periodId: requiredText(action.accountingPeriodId),
      series: requiredText(action.series),
      number: voucherNumber,
      sequence: sequenceValue,
      postingDate: requiredText(action.postingDate),
      eventId: requiredText(action.eventId),
      postingPurpose: requiredText(action.postingPurpose),
      occurrenceKey: requiredText(action.occurrenceKey),
      correctsVoucherId: optionalText(action.correctsVoucherId),
      changeSetId,
      action,
      expectedLineCount: Array.isArray(action.lines) ? action.lines.length : 0,
    });

    const recordedAt = voucher[0]?.recordedAt;

    if (recordedAt === undefined) return yield* failure("InternalError");
    const lines = Array.isArray(action.lines) ? action.lines : [];
    yield* Db.insertJournalLines(
      transaction,
      lines.map((line, index) => ({
        bookId: scope.bookId,
        voucherId,
        id: String(line.lineId),
        ordinal: index + 1,
        accountId: String(line.accountId),
        debitMinor: String(line.debitMinor),
        creditMinor: String(line.creditMinor),
        description: String(line.description),
      })),
    );

    const receipt = {
      id: newId("receipt"),
      changeSetId,
      voucherId,
      planDigest,
      sequence: sequenceValue.toString(),
      voucherNumber: voucherNumber.toString(),
      committedAt: recordedAt,
    } satisfies typeof Accounting.ExecutionReceipt.Type;

    const groupReceipt = {
      id: newId("group_receipt"),
      changeSetId,
      groupId,
      planDigest,
      executionReceipts: [receipt],
      committedAt: recordedAt,
    } satisfies typeof Accounting.GroupReceipt.Type;

    yield* Db.insertGroupReceipt(transaction, {
      bookId: scope.bookId,
      id: groupReceipt.id,
      changeSetId,
      groupId,
      planDigest,
      body: groupReceipt,
      committedAt: recordedAt,
    });
    yield* Db.insertApprovalConsumption(transaction, {
      bookId: scope.bookId,
      approvalId: approval.id,
      changeSetId,
      groupId,
      planDigest,
      receiptId: groupReceipt.id,
      approverId: approval.actorId,
      consumedById: principal.actorId,
      consumedAt: recordedAt,
    });
    yield* Db.insertExecutionReceipt(transaction, {
      bookId: scope.bookId,
      id: receipt.id,
      changeSetId,
      voucherId,
      approvalId: approval.id,
      body: receipt,
    });
    yield* Db.insertOutbox(transaction, {
      bookId: scope.bookId,
      id: newId("outbox"),
      receiptId: receipt.id,
      kind: "voucher.posted.v1",
      payload: receipt,
    });

    return { receipt, voucherId, recordedAt };
  });
}

function recognitionAction(
  review: Review,
  eventId: string,
  lineId: string,
  revenueLineId: string,
  bookCurrency: string,
) {
  return {
    kind: "post_voucher",
    correctsVoucherId: null,
    eventId,
    postingPurpose: "adjustment",
    occurrenceKey: `commerce_fx_recognition_${review.itemId}`,
    fiscalYearId: review.snapshot.fiscalYearId,
    accountingPeriodId: review.input.accountingPeriodId,
    postingDate: review.input.recognitionDate,
    series: review.input.series,
    currency: bookCurrency,
    description: "Synthetic foreign customer receivable recognition",
    rationale: review.input.reason,
    taxAssessment: "not_applicable",
    lines: [
      {
        lineId,
        accountId: review.input.controlAccountId,
        debitMinor: review.snapshot.calculation.carryingMinor,
        creditMinor: "0",
        description: "Foreign customer receivable recognition",
      },
      {
        lineId: revenueLineId,
        accountId: review.input.revenueAccountId,
        debitMinor: "0",
        creditMinor: review.snapshot.calculation.carryingMinor,
        description: "Synthetic foreign-customer revenue recognition",
      },
    ],
    evidenceRefs: [
      {
        ...review.snapshot.sourceEvidence,
        locator: review.input.eventKey,
      },
    ],
    foreignCurrency: {
      kind: "recognition_v1",
      itemId: review.itemId,
      reviewId: review.id,
      reviewDigest: review.digest,
      sourceKey: review.input.sourceKey,
      sourceRevision: review.input.sourceRevision,
    },
  } satisfies JsonObject;
}

function settlementAction(
  kind: "settlement_v1" | "partial_settlement_v1",
  review: SettlementReview | PartialSettlementReview,
  eventId: string,
  bookCurrency: string,
  cashLineId: string,
  controlLineId: string | null,
  realizedLineId: string | null,
  settlementDigest: string,
) {
  const calculation = review.snapshot.calculation;
  const legOrdinal = "legOrdinal" in calculation ? calculation.legOrdinal : undefined;

  if (kind === "partial_settlement_v1" && legOrdinal === undefined)
    throw new Error("Missing partial leg");
  const roles = review.snapshot.accountBindings;
  const cash = roles.find((role) => role.role === "cash");
  const control = roles.find((role) => role.role === "control");
  const gainAccount = roles.find((role) => role.role === "realized_gain");
  const lossAccount = roles.find((role) => role.role === "realized_loss");

  if (!cash || !control) throw new Error("Missing settlement account role");

  const lines: JsonObject[] = [
    {
      lineId: cashLineId,
      accountId: cash.accountId,
      debitMinor: calculation.considerationMinor,
      creditMinor: "0",
      description: "Book-currency customer cash settlement",
    },
  ];

  if (controlLineId) {
    lines.push({
      lineId: controlLineId,
      accountId: control.accountId,
      debitMinor: "0",
      creditMinor: calculation.carryingReleasedMinor,
      description: "Foreign customer receivable carrying release",
    });
  }

  const gain = BigInt(calculation.realizedGainMinor);

  if (gain > 0n) {
    if (!gainAccount || !realizedLineId) throw new Error("Missing gain role");
    lines.push({
      lineId: realizedLineId,
      accountId: gainAccount.accountId,
      debitMinor: "0",
      creditMinor: calculation.realizedGainMinor,
      description: "Realized foreign-currency gain",
    });
  } else if (gain < 0n) {
    if (!lossAccount || !realizedLineId) throw new Error("Missing loss role");
    lines.push({
      lineId: realizedLineId,
      accountId: lossAccount.accountId,
      debitMinor: absoluteMinor(gain),
      creditMinor: "0",
      description: "Realized foreign-currency loss",
    });
  }

  const foreignCurrency: JsonObject = {
    kind,
    itemId: review.itemId,
    reviewId: review.id,
    reviewDigest: review.digest,
    settlementDigest,
  };

  if (kind === "partial_settlement_v1" && legOrdinal !== undefined) {
    Object.assign(foreignCurrency, { legOrdinal });
  }

  return {
    kind: "post_voucher",
    correctsVoucherId: null,
    eventId,
    postingPurpose: "adjustment",
    occurrenceKey: `${kind === "settlement_v1" ? "commerce_fx_settlement" : "commerce_fx_partial_settlement"}_${review.id}`,
    fiscalYearId: review.snapshot.fiscalYearId,
    accountingPeriodId: review.input.accountingPeriodId,
    postingDate: review.input.settlementDate,
    series: review.input.series,
    currency: bookCurrency,
    description:
      kind === "settlement_v1"
        ? "Synthetic full book-currency foreign-customer settlement"
        : "Synthetic partial book-currency foreign-customer settlement",
    rationale: review.input.reason,
    taxAssessment: "not_applicable",
    lines,
    evidenceRefs: [{ ...review.snapshot.sourceEvidence, locator: review.input.eventKey }],
    foreignCurrency,
  } satisfies JsonObject;
}

function correctionAction(
  review: CorrectionReview,
  bookCurrency: string,
  settlementId: string,
  settlementDigest: string,
  correctionEvidence: { evidenceId: string; sha256: string },
) {
  const originalEvidence = review.snapshot.voucher.action.evidenceRefs[0];

  if (!originalEvidence) throw new Error("Missing settlement evidence");

  return {
    kind: "post_voucher",
    correctsVoucherId: review.snapshot.voucher.id,
    eventId: review.snapshot.voucher.action.eventId,
    postingPurpose: "reversal",
    occurrenceKey: settlementId,
    fiscalYearId: review.snapshot.fiscalYearId,
    accountingPeriodId: review.input.accountingPeriodId,
    postingDate: review.input.postingDate,
    series: review.snapshot.voucher.action.series,
    currency: bookCurrency,
    description: "Correction: synthetic foreign-customer settlement",
    rationale: review.input.reason,
    taxAssessment: "not_applicable",
    lines: review.snapshot.reversalLines,
    evidenceRefs: [originalEvidence, { ...correctionEvidence, locator: "correction" }],
    foreignCurrency: {
      kind: "settlement_correction_v1",
      itemId: review.snapshot.item.id,
      settlementId,
      settlementDigest,
      reviewId: review.id,
      reviewDigest: review.digest,
      correctionEvidence,
    },
  } satisfies JsonObject;
}

function ensureEvent(transaction: Transaction, scope: Scope, evidenceId: string, eventKey: string) {
  return Effect.gen(function* () {
    const eventRows = yield* Db.readEvent(transaction, scope.bookId, evidenceId, eventKey);

    if (eventRows.length === 0) {
      const eventId = newId("event");
      yield* Db.insertEvent(transaction, scope.bookId, eventId, evidenceId, eventKey);

      return eventId;
    }

    return eventRows[0]?.id ?? newId("event");
  });
}

function assertNoItem(transaction: Transaction, bookId: string, reviewId: string) {
  return FxDb.readItemByReview(transaction, bookId, reviewId).pipe(
    Effect.flatMap((rows) =>
      rows.length > 0 ? Effect.fail(failure("IdempotencyConflict")) : Effect.void,
    ),
  );
}

function assertNoSettlement(transaction: Transaction, bookId: string, reviewId: string) {
  return FxDb.readSettlementByReview(transaction, bookId, reviewId).pipe(
    Effect.flatMap((rows) =>
      rows.length > 0 ? Effect.fail(failure("IdempotencyConflict")) : Effect.void,
    ),
  );
}

function loadCorrectionSettlement(transaction: Transaction, scope: Scope, settlementId: string) {
  return Effect.gen(function* () {
    const settlementRows = yield* FxDb.readSettlement(transaction, scope.bookId, settlementId);
    const settlement = settlementRows[0];

    if (!settlement) return yield* failure("NotFound");

    if (
      (yield* FxDb.readCorrectionBySettlement(transaction, scope.bookId, settlement.id)).length > 0
    ) {
      return yield* failure("IdempotencyConflict");
    }

    const settlementDigest = settlement.body.digest;

    if (typeof settlementDigest !== "string") return yield* failure("StaleDependency");

    return { settlement, settlementDigest };
  });
}

type SettlementParts =
  | { readonly kind: "partial"; readonly review: PartialSettlementReview }
  | { readonly kind: "full"; readonly review: SettlementReview };

function settlementParts(
  review: SettlementReview | PartialSettlementReview,
): SettlementParts | undefined {
  if (isPartialSettlementReview(review)) return { kind: "partial", review };

  return { kind: "full", review };
}

function executeReview(
  transaction: Transaction,
  principal: Principal,
  scope: Scope,
  kind: "recognition" | "settlement" | "correction",
  review: AnyReview,
  input: { approvalId: string },
  idempotencyKey: string,
) {
  return Effect.gen(function* () {
    const approval = yield* currentApproval(
      transaction,
      kind,
      scope,
      review.id,
      input.approvalId,
      review.digest,
    );

    if (kind === "recognition") {
      if (!isRecognitionReview(review)) return yield* failure("InternalError");
      const recognition = review;
      yield* assertNoItem(transaction, scope.bookId, recognition.id);

      const eventId = yield* ensureEvent(
        transaction,
        scope,
        recognition.snapshot.sourceEvidence.evidenceId,
        recognition.input.eventKey,
      );

      const lineId = newId("line");
      const revenueLineId = newId("line");
      const book = yield* readBook(transaction, scope);
      const action = recognitionAction(recognition, eventId, lineId, revenueLineId, book.currency);
      const posted = yield* makePlanAndPost(transaction, scope, principal, approval, action);

      const source = {
        kind: recognition.input.profile,
        sourceKey: recognition.input.sourceKey,
        sourceRevision: recognition.input.sourceRevision,
        counterpartyId: recognition.snapshot.counterpart.id,
        counterpartyRevision: recognition.snapshot.counterpart.revision,
        counterpartyName: recognition.snapshot.counterpart.displayName,
        documentNumber: recognition.input.documentNumber,
        recognitionDate: recognition.input.recognitionDate,
        evidence: recognition.snapshot.sourceEvidence,
      } satisfies JsonObject;

      const rate = {
        observationId: recognition.snapshot.rate.observationId,
        revision: recognition.snapshot.rate.revision,
        digest: recognition.snapshot.rate.digest,
        rate: recognition.snapshot.rate,
      } satisfies JsonObject;

      const bodyWithoutDigest = {
        id: recognition.itemId,
        scope,
        kind: recognition.input.profile,
        direction: "customer",
        source,
        rate,
        original: {
          currency: recognition.input.originalCurrency,
          scale: recognition.input.originalScale,
          minor: recognition.snapshot.calculation.originalMinor,
        },
        book: {
          currency: book.currency,
          scale: book.currencyScale,
          carryingMinor: recognition.snapshot.calculation.carryingMinor,
        },
        initialOriginalMinor: recognition.snapshot.calculation.originalMinor,
        initialCarryingMinor: recognition.snapshot.calculation.carryingMinor,
        accountBindings: recognition.snapshot.accountBindings,
        recognition: {
          eventId,
          voucherId: posted.voucherId,
          lineId,
          postingReceipt: posted.receipt,
        },
        receipt: commandReceipt(
          idempotencyKey,
          "execute_commerce_fx_recognition",
          principal.actorId,
        ),
      } satisfies JsonObject;

      const body = {
        ...bodyWithoutDigest,
        receipt: commandReceipt(
          idempotencyKey,
          "execute_commerce_fx_recognition",
          principal.actorId,
        ),
        digest: yield* reviewDigest(bodyWithoutDigest),
      } satisfies JsonObject;

      yield* FxDb.insertItem(transaction, {
        bookId: scope.bookId,
        id: recognition.itemId,
        reviewId: recognition.id,
        approvalId: approval.id,
        postingReceiptId: posted.receipt.id,
        counterpartyId: recognition.snapshot.counterpart.id,
        counterpartyRevision: recognition.snapshot.counterpart.revision,
        sourceKey: recognition.input.sourceKey,
        sourceRevision: recognition.input.sourceRevision,
        evidenceId: recognition.snapshot.sourceEvidence.evidenceId,
        rateObservationId: recognition.snapshot.rate.observationId,
        rateRevision: recognition.snapshot.rate.revision,
        rateDigest: recognition.snapshot.rate.digest,
        eventId,
        voucherId: posted.voucherId,
        lineId,
        originalCurrency: recognition.input.originalCurrency,
        originalScale: recognition.input.originalScale,
        originalMinor: recognition.snapshot.calculation.originalMinor,
        bookCurrency: book.currency,
        bookScale: book.currencyScale,
        carryingMinor: recognition.snapshot.calculation.carryingMinor,
        body,
      });
      const state = yield* readItemState(transaction, scope, recognition.itemId);
      const result = yield* decode(ItemSchema, state.item);

      return result;
    }

    if (kind === "settlement") {
      if (!isSettlementReview(review)) return yield* failure("InternalError");
      const settlement = review;
      const parts = settlementParts(settlement);

      if (!parts) return yield* failure("InternalError");
      const partialSettlement = parts.kind === "partial";
      const calculation = parts.review.snapshot.calculation;
      yield* assertNoSettlement(transaction, scope.bookId, settlement.id);

      const eventId = yield* ensureEvent(
        transaction,
        scope,
        settlement.snapshot.sourceEvidence.evidenceId,
        settlement.input.eventKey,
      );

      const cashLineId = newId("line");

      const controlLineId =
        settlement.snapshot.calculation.carryingReleasedMinor === "0" ? null : newId("line");

      const realizedLineId =
        settlement.snapshot.calculation.realizedGainMinor === "0" ? null : newId("line");

      const book = yield* readBook(transaction, scope);
      const actionKind = partialSettlement ? "partial_settlement_v1" : "settlement_v1";
      const settlementDigest = yield* digest(yield* toJsonObject(calculation));

      const action = settlementAction(
        actionKind,
        settlement,
        eventId,
        book.currency,
        cashLineId,
        controlLineId,
        realizedLineId,
        settlementDigest,
      );

      const posted = yield* makePlanAndPost(transaction, scope, principal, approval, action);
      const settlementId = newId(partialSettlement ? "fx_partial_settlement" : "fx_settlement");

      const bodyWithoutDigest =
        parts.kind === "partial"
          ? {
              id: settlementId,
              scope,
              itemId: settlement.itemId,
              profile: parts.review.input.profile,
              legOrdinal: parts.review.snapshot.calculation.legOrdinal,
              reviewId: settlement.id,
              reviewDigest: settlement.digest,
              approvalId: approval.id,
              calculation: parts.review.snapshot.calculation,
              postingReceipt: posted.receipt,
              committedAt: posted.recordedAt,
              receipt: commandReceipt(
                idempotencyKey,
                "execute_commerce_fx_partial_settlement",
                principal.actorId,
              ),
            }
          : {
              id: settlementId,
              scope,
              itemId: settlement.itemId,
              reviewId: settlement.id,
              reviewDigest: settlement.digest,
              approvalId: approval.id,
              originalReleasedMinor: parts.review.snapshot.calculation.originalReleasedMinor,
              carryingReleasedMinor: parts.review.snapshot.calculation.carryingReleasedMinor,
              considerationMinor: parts.review.snapshot.calculation.considerationMinor,
              realizedGainMinor: parts.review.snapshot.calculation.realizedGainMinor,
              formula: parts.review.snapshot.calculation.formula,
              postingReceipt: posted.receipt,
              committedAt: posted.recordedAt,
              receipt: commandReceipt(
                idempotencyKey,
                "execute_commerce_fx_settlement",
                principal.actorId,
              ),
            };

      const bodyJson = yield* toJsonObject(bodyWithoutDigest);
      const body: JsonObject = { ...bodyJson, digest: yield* reviewDigest(bodyJson) };
      yield* FxDb.insertSettlement(transaction, {
        bookId: scope.bookId,
        id: settlementId,
        itemId: settlement.itemId,
        reviewId: settlement.id,
        approvalId: approval.id,
        postingReceiptId: posted.receipt.id,
        eventId,
        voucherId: posted.voucherId,
        cashLineId,
        controlLineId,
        realizedLineId,
        originalReleasedMinor: calculation.originalReleasedMinor,
        carryingReleasedMinor: calculation.carryingReleasedMinor,
        considerationMinor: calculation.considerationMinor,
        realizedGainMinor: calculation.realizedGainMinor,
        body,
        profile: parts.review.input.profile,
        legOrdinal: parts.kind === "partial" ? parts.review.snapshot.calculation.legOrdinal : 1,
        finalLeg: parts.kind === "partial" ? parts.review.snapshot.calculation.finalLeg : null,
        originalRemainingBeforeMinor:
          parts.kind === "partial"
            ? parts.review.snapshot.calculation.originalRemainingBeforeMinor
            : null,
        originalRemainingAfterMinor:
          parts.kind === "partial"
            ? parts.review.snapshot.calculation.originalRemainingAfterMinor
            : null,
        carryingRemainingBeforeMinor:
          parts.kind === "partial"
            ? parts.review.snapshot.calculation.carryingRemainingBeforeMinor
            : null,
        carryingRemainingAfterMinor:
          parts.kind === "partial"
            ? parts.review.snapshot.calculation.carryingRemainingAfterMinor
            : null,
      });

      return parts.kind === "partial"
        ? yield* decode(PartialSettlementReceiptSchema, body)
        : yield* decode(FullSettlementReceiptSchema, body);
    }

    if (!isCorrectionReview(review)) return yield* failure("InternalError");
    const correction = review;

    const correctionSettlement = yield* loadCorrectionSettlement(
      transaction,
      scope,
      correction.settlementId,
    );

    const settlement = correctionSettlement.settlement;
    const settlementDigest = correctionSettlement.settlementDigest;
    const book = yield* readBook(transaction, scope);
    const correctionEvidence = correction.snapshot.sourceEvidence;

    const action = correctionAction(
      correction,
      book.currency,
      settlement.id,
      settlementDigest,
      correctionEvidence,
    );

    const posted = yield* makePlanAndPost(transaction, scope, principal, approval, action);
    const correctionId = newId("fx_settlement_correction");

    const bodyWithoutDigest: JsonObject = {
      id: correctionId,
      scope,
      itemId: settlement.itemId,
      settlementId: settlement.id,
      settlementDigest,
      reviewId: correction.id,
      reviewDigest: correction.digest,
      approvalId: approval.id,
      originalVoucherId: settlement.voucherId,
      postingReceipt: posted.receipt,
      restoredOriginalMinor: settlement.originalReleasedMinor,
      restoredCarryingMinor: settlement.carryingReleasedMinor,
      reason: correction.input.reason,
      committedAt: posted.recordedAt,
      receipt: commandReceipt(
        idempotencyKey,
        "execute_commerce_fx_settlement_correction",
        principal.actorId,
      ),
    };

    if (settlement.profile === "synthetic_partial_book_currency_settlement_v1") {
      Object.assign(bodyWithoutDigest, {
        settlementProfile: settlement.profile,
        legOrdinal: settlement.legOrdinal,
      });
    }

    const bodyJson = yield* toJsonObject(bodyWithoutDigest);
    const body: JsonObject = { ...bodyJson, digest: yield* reviewDigest(bodyJson) };
    yield* FxDb.insertCorrection(transaction, {
      bookId: scope.bookId,
      id: correctionId,
      itemId: settlement.itemId,
      settlementId: settlement.id,
      reviewId: correction.id,
      approvalId: approval.id,
      postingReceiptId: posted.receipt.id,
      originalVoucherId: settlement.voucherId,
      body,
    });

    return yield* decode(CorrectionReceiptSchema, body);
  });
}

export const prepareRecognition = Effect.fn("commerceFx.prepareRecognition")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: RecognitionInput },
) {
  return yield* withBook(token, command.scope, false, (transaction, principal) =>
    Effect.gen(function* () {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_commerce_fx_recognition",
        principal.actorId,
        command.input,
        RecognitionSchema,
      );

      if (request.previous) return request.previous;
      yield* requireDirectAccess(transaction, true);
      yield* Db.lockBookForUpdate(transaction, command.scope);
      const snapshot = yield* recognitionSnapshot(transaction, command.scope, command.input);
      const id = newId("fx_review");

      const bodyWithoutDigest = makeReviewBody(
        command.scope,
        id,
        command.input,
        snapshot,
        principal,
        command.idempotencyKey,
        "prepare_commerce_fx_recognition",
        yield* isoNow(transaction),
        { itemId: newId("fx_item") },
      );

      const body: JsonObject = Object.assign({}, bodyWithoutDigest, {
        digest: yield* reviewDigest(bodyWithoutDigest),
      });

      const result = yield* decode(RecognitionSchema, body);
      yield* FxDb.insertRecognitionReview(transaction, {
        bookId: command.scope.bookId,
        id,
        itemId: result.itemId,
        actorId: principal.actorId,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_commerce_fx_recognition",
        principal.actorId,
        result,
      );

      return result;
    }),
  );
});

export const approveRecognition = Effect.fn("commerceFx.approveRecognition")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof CommerceFx.ApproveFx.Type;
  },
) {
  return yield* withBook(token, command.scope, true, (transaction, principal) =>
    Effect.gen(function* () {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "approve_commerce_fx_recognition",
        principal.actorId,
        { id: command.id, input: command.input },
        CommerceFx.FxApproval,
      );

      if (request.previous) return request.previous;
      yield* requireDirectAccess(transaction, true);
      yield* Db.lockBookForUpdate(transaction, command.scope);
      const review = yield* readSavedReview(transaction, "recognition", command.scope, command.id);

      if (command.input.version !== 1 || command.input.digest !== review.digest)
        return yield* failure("StaleDependency");
      yield* assertReviewCurrent(transaction, "recognition", command.scope, review);

      if (review.createdBy === principal.actorId) return yield* failure("ApprovalRequired");

      const expiresAt = new Date(
        Date.parse(yield* isoNow(transaction)) + 60 * 60 * 1000,
      ).toISOString();

      const body = {
        id: newId("fx_recognition_approval"),
        scope: command.scope,
        kind: "recognition",
        reviewId: review.id,
        reviewDigest: review.digest,
        actorId: principal.actorId,
        expiresAt,
        receipt: commandReceipt(
          command.idempotencyKey,
          "approve_commerce_fx_recognition",
          principal.actorId,
        ),
      } satisfies JsonObject;

      yield* FxDb.insertRecognitionApproval(transaction, {
        bookId: command.scope.bookId,
        id: String(body.id),
        reviewId: review.id,
        actorId: principal.actorId,
        digest: review.digest,
        expiresAt,
        body,
      });
      const result = yield* decode(CommerceFx.FxApproval, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "approve_commerce_fx_recognition",
        principal.actorId,
        result,
      );

      return result;
    }),
  );
});

export const executeRecognition = Effect.fn("commerceFx.executeRecognition")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof CommerceFx.ExecuteFx.Type;
  },
) {
  return yield* withBook(token, command.scope, true, (transaction, principal) =>
    Effect.gen(function* () {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "execute_commerce_fx_recognition",
        principal.actorId,
        { id: command.id, input: command.input },
        ItemSchema,
      );

      if (request.previous) return request.previous;
      yield* requireDirectAccess(transaction, true);
      yield* Db.lockBookForUpdate(transaction, command.scope);
      const review = yield* readSavedReview(transaction, "recognition", command.scope, command.id);

      if (command.input.version !== 1 || command.input.digest !== review.digest)
        return yield* failure("StaleDependency");
      yield* assertReviewCurrent(transaction, "recognition", command.scope, review);

      const result = yield* executeReview(
        transaction,
        principal,
        command.scope,
        "recognition",
        review,
        command.input,
        command.idempotencyKey,
      );

      const receipt = yield* decode(ItemSchema, result);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "execute_commerce_fx_recognition",
        principal.actorId,
        receipt,
      );

      return receipt;
    }),
  );
});

export const prepareSettlement = Effect.fn("commerceFx.prepareSettlement")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: SettlementInput },
) {
  return yield* withBook(token, command.scope, false, (transaction, principal) =>
    Effect.gen(function* () {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_commerce_fx_settlement",
        principal.actorId,
        command.input,
        SettlementSchema,
      );

      if (request.previous) return request.previous;
      yield* requireDirectAccess(transaction, true);
      yield* Db.lockBookForUpdate(transaction, command.scope);
      const snapshot = yield* settlementSnapshot(transaction, command.scope, command.input);

      const bodyWithoutDigest = makeReviewBody(
        command.scope,
        newId("fx_settlement_review"),
        command.input,
        snapshot,
        principal,
        command.idempotencyKey,
        "prepare_commerce_fx_settlement",
        yield* isoNow(transaction),
        { itemId: command.input.itemId },
      );

      const body: JsonObject = Object.assign({}, bodyWithoutDigest, {
        digest: yield* reviewDigest(bodyWithoutDigest),
      });

      const result = yield* decode(SettlementSchema, body);
      yield* FxDb.insertSettlementReview(transaction, {
        bookId: command.scope.bookId,
        id: result.id,
        itemId: result.itemId,
        actorId: principal.actorId,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_commerce_fx_settlement",
        principal.actorId,
        result,
      );

      return result;
    }),
  );
});

export const preparePartialSettlement = Effect.fn("commerceFx.preparePartialSettlement")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: PartialSettlementInput },
) {
  return yield* withBook(token, command.scope, false, (transaction, principal) =>
    Effect.gen(function* () {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_commerce_fx_partial_settlement",
        principal.actorId,
        command.input,
        PartialSettlementSchema,
      );

      if (request.previous) return request.previous;
      yield* requireDirectAccess(transaction, true);
      yield* Db.lockBookForUpdate(transaction, command.scope);
      const snapshot = yield* settlementSnapshot(transaction, command.scope, command.input);

      const bodyWithoutDigest = makeReviewBody(
        command.scope,
        newId("fx_partial_settlement_review"),
        command.input,
        snapshot,
        principal,
        command.idempotencyKey,
        "prepare_commerce_fx_partial_settlement",
        yield* isoNow(transaction),
        { itemId: command.input.itemId },
      );

      const body: JsonObject = Object.assign({}, bodyWithoutDigest, {
        digest: yield* reviewDigest(bodyWithoutDigest),
      });

      const result = yield* decode(PartialSettlementSchema, body);
      yield* FxDb.insertSettlementReview(transaction, {
        bookId: command.scope.bookId,
        id: result.id,
        itemId: result.itemId,
        actorId: principal.actorId,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_commerce_fx_partial_settlement",
        principal.actorId,
        result,
      );

      return result;
    }),
  );
});

function approveSettlementLike(
  transaction: Transaction,
  principal: Principal,
  scope: Scope,
  kind: "settlement" | "partial_settlement",
  review: SettlementReview | PartialSettlementReview,
  idempotencyKey: string,
  operation: string,
) {
  return Effect.gen(function* () {
    const approvalId = newId(
      kind === "settlement" ? "fx_settlement_approval" : "fx_partial_settlement_approval",
    );

    const expiresAt = new Date(
      Date.parse(yield* isoNow(transaction)) + 60 * 60 * 1000,
    ).toISOString();

    const body = {
      id: approvalId,
      scope,
      kind,
      reviewId: review.id,
      reviewDigest: review.digest,
      actorId: principal.actorId,
      expiresAt,
      receipt: commandReceipt(idempotencyKey, operation, principal.actorId),
    } satisfies JsonObject;

    yield* insertApproval(transaction, "settlement", {
      bookId: scope.bookId,
      id: approvalId,
      reviewId: review.id,
      actorId: principal.actorId,
      digest: review.digest,
      expiresAt,
      body,
    });

    return yield* decode(CommerceFx.FxApproval, body);
  });
}

export const approveSettlement = Effect.fn("commerceFx.approveSettlement")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof CommerceFx.ApproveFx.Type;
  },
) {
  return yield* withBook(token, command.scope, true, (transaction, principal) =>
    Effect.gen(function* () {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "approve_commerce_fx_settlement",
        principal.actorId,
        { id: command.id, input: command.input },
        CommerceFx.FxApproval,
      );

      if (request.previous) return request.previous;
      yield* requireDirectAccess(transaction, true);
      yield* Db.lockBookForUpdate(transaction, command.scope);
      const review = yield* readSavedSettlementReview(transaction, command.scope, command.id);

      if (command.input.version !== 1 || command.input.digest !== review.digest)
        return yield* failure("StaleDependency");
      yield* assertReviewCurrent(transaction, "settlement", command.scope, review);

      if (review.createdBy === principal.actorId) return yield* failure("ApprovalRequired");

      const result = yield* approveSettlementLike(
        transaction,
        principal,
        command.scope,
        "settlement",
        review,
        command.idempotencyKey,
        "approve_commerce_fx_settlement",
      );

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "approve_commerce_fx_settlement",
        principal.actorId,
        result,
      );

      return result;
    }),
  );
});

export const approvePartialSettlement = Effect.fn("commerceFx.approvePartialSettlement")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof CommerceFx.ApproveFx.Type;
  },
) {
  return yield* withBook(token, command.scope, true, (transaction, principal) =>
    Effect.gen(function* () {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "approve_commerce_fx_partial_settlement",
        principal.actorId,
        { id: command.id, input: command.input },
        CommerceFx.FxApproval,
      );

      if (request.previous) return request.previous;
      yield* requireDirectAccess(transaction, true);
      yield* Db.lockBookForUpdate(transaction, command.scope);
      const review = yield* readSavedSettlementReview(transaction, command.scope, command.id);

      if (command.input.version !== 1 || command.input.digest !== review.digest)
        return yield* failure("StaleDependency");
      yield* assertReviewCurrent(transaction, "partial_settlement", command.scope, review);

      if (review.createdBy === principal.actorId) return yield* failure("ApprovalRequired");

      const result = yield* approveSettlementLike(
        transaction,
        principal,
        command.scope,
        "partial_settlement",
        review,
        command.idempotencyKey,
        "approve_commerce_fx_partial_settlement",
      );

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "approve_commerce_fx_partial_settlement",
        principal.actorId,
        result,
      );

      return result;
    }),
  );
});

function executeSettlementLike(
  transaction: Transaction,
  principal: Principal,
  scope: Scope,
  review: SettlementReview | PartialSettlementReview,
  input: typeof CommerceFx.ExecuteFx.Type,
  idempotencyKey: string,
) {
  return Effect.gen(function* () {
    if (input.version !== 1 || input.digest !== review.digest)
      return yield* failure("StaleDependency");
    yield* assertReviewCurrent(transaction, "settlement", scope, review);

    return yield* executeReview(
      transaction,
      principal,
      scope,
      "settlement",
      review,
      input,
      idempotencyKey,
    );
  });
}

export const executeSettlement = Effect.fn("commerceFx.executeSettlement")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof CommerceFx.ExecuteFx.Type;
  },
) {
  return yield* withBook(token, command.scope, true, (transaction, principal) =>
    Effect.gen(function* () {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "execute_commerce_fx_settlement",
        principal.actorId,
        { id: command.id, input: command.input },
        FullSettlementReceiptSchema,
      );

      if (request.previous) return request.previous;
      yield* requireDirectAccess(transaction, true);
      yield* Db.lockBookForUpdate(transaction, command.scope);
      const review = yield* readSavedSettlementReview(transaction, command.scope, command.id);

      const result = yield* executeSettlementLike(
        transaction,
        principal,
        command.scope,
        review,
        command.input,
        command.idempotencyKey,
      );

      const receipt = yield* decode(FullSettlementReceiptSchema, result);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "execute_commerce_fx_settlement",
        principal.actorId,
        receipt,
      );

      return receipt;
    }),
  );
});

export const executePartialSettlement = Effect.fn("commerceFx.executePartialSettlement")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof CommerceFx.ExecuteFx.Type;
  },
) {
  return yield* withBook(token, command.scope, true, (transaction, principal) =>
    Effect.gen(function* () {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "execute_commerce_fx_partial_settlement",
        principal.actorId,
        { id: command.id, input: command.input },
        PartialSettlementReceiptSchema,
      );

      if (request.previous) return request.previous;
      yield* requireDirectAccess(transaction, true);
      yield* Db.lockBookForUpdate(transaction, command.scope);
      const review = yield* readSavedSettlementReview(transaction, command.scope, command.id);

      const result = yield* executeSettlementLike(
        transaction,
        principal,
        command.scope,
        review,
        command.input,
        command.idempotencyKey,
      );

      const receipt = yield* decode(PartialSettlementReceiptSchema, result);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "execute_commerce_fx_partial_settlement",
        principal.actorId,
        receipt,
      );

      return receipt;
    }),
  );
});

export const prepareSettlementCorrection = Effect.fn("commerceFx.prepareSettlementCorrection")(
  function* (
    token: string,
    command: { scope: Scope; idempotencyKey: string; input: CorrectionInput },
  ) {
    return yield* withBook(token, command.scope, false, (transaction, principal) =>
      Effect.gen(function* () {
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "prepare_commerce_fx_settlement_correction",
          principal.actorId,
          command.input,
          CorrectionSchema,
        );

        if (request.previous) return request.previous;
        yield* requireDirectAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const snapshot = yield* correctionSnapshot(transaction, command.scope, command.input);

        const bodyWithoutDigest = makeReviewBody(
          command.scope,
          newId("fx_settlement_correction_review"),
          command.input,
          snapshot,
          principal,
          command.idempotencyKey,
          "prepare_commerce_fx_settlement_correction",
          yield* isoNow(transaction),
          { settlementId: command.input.settlementId },
        );

        const body: JsonObject = Object.assign({}, bodyWithoutDigest, {
          digest: yield* reviewDigest(bodyWithoutDigest),
        });

        const result = yield* decode(CorrectionSchema, body);
        yield* FxDb.insertCorrectionReview(transaction, {
          bookId: command.scope.bookId,
          id: result.id,
          settlementId: result.settlementId,
          actorId: principal.actorId,
          body,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "prepare_commerce_fx_settlement_correction",
          principal.actorId,
          result,
        );

        return result;
      }),
    );
  },
);

export const approveSettlementCorrection = Effect.fn("commerceFx.approveSettlementCorrection")(
  function* (
    token: string,
    command: {
      scope: Scope;
      id: string;
      idempotencyKey: string;
      input: typeof CommerceFx.ApproveFx.Type;
    },
  ) {
    return yield* withBook(token, command.scope, true, (transaction, principal) =>
      Effect.gen(function* () {
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "approve_commerce_fx_settlement_correction",
          principal.actorId,
          { id: command.id, input: command.input },
          CommerceFx.FxApproval,
        );

        if (request.previous) return request.previous;
        yield* requireDirectAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const review = yield* readSavedReview(transaction, "correction", command.scope, command.id);

        if (command.input.version !== 1 || command.input.digest !== review.digest)
          return yield* failure("StaleDependency");
        yield* assertReviewCurrent(transaction, "correction", command.scope, review);

        if (review.createdBy === principal.actorId) return yield* failure("ApprovalRequired");
        const approvalId = newId("fx_correction_approval");

        const expiresAt = new Date(
          Date.parse(yield* isoNow(transaction)) + 60 * 60 * 1000,
        ).toISOString();

        const body = {
          id: approvalId,
          scope: command.scope,
          kind: "correction",
          reviewId: review.id,
          reviewDigest: review.digest,
          actorId: principal.actorId,
          expiresAt,
          receipt: commandReceipt(
            command.idempotencyKey,
            "approve_commerce_fx_settlement_correction",
            principal.actorId,
          ),
        } satisfies JsonObject;

        yield* FxDb.insertCorrectionApproval(transaction, {
          bookId: command.scope.bookId,
          id: approvalId,
          reviewId: review.id,
          actorId: principal.actorId,
          digest: review.digest,
          expiresAt,
          body,
        });
        const result = yield* decode(CommerceFx.FxApproval, body);
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "approve_commerce_fx_settlement_correction",
          principal.actorId,
          result,
        );

        return result;
      }),
    );
  },
);

export const executeSettlementCorrection = Effect.fn("commerceFx.executeSettlementCorrection")(
  function* (
    token: string,
    command: {
      scope: Scope;
      id: string;
      idempotencyKey: string;
      input: typeof CommerceFx.ExecuteFx.Type;
    },
  ) {
    return yield* withBook(token, command.scope, true, (transaction, principal) =>
      Effect.gen(function* () {
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "execute_commerce_fx_settlement_correction",
          principal.actorId,
          { id: command.id, input: command.input },
          CorrectionReceiptSchema,
        );

        if (request.previous) return request.previous;
        yield* requireDirectAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const review = yield* readSavedReview(transaction, "correction", command.scope, command.id);

        if (command.input.version !== 1 || command.input.digest !== review.digest)
          return yield* failure("StaleDependency");
        yield* assertReviewCurrent(transaction, "correction", command.scope, review);

        const result = yield* executeReview(
          transaction,
          principal,
          command.scope,
          "correction",
          review,
          command.input,
          command.idempotencyKey,
        );

        const receipt = yield* decode(CorrectionReceiptSchema, result);
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "execute_commerce_fx_settlement_correction",
          principal.actorId,
          receipt,
        );

        return receipt;
      }),
    );
  },
);

export const getItem = Effect.fn("commerceFx.getItem")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    (transaction) =>
      Effect.gen(function* () {
        yield* requireDirectAccess(transaction, false);
        yield* Db.lockBookForShare(transaction, command.scope);
        const state = yield* readItemState(transaction, command.scope, command.id);

        return yield* decode(ItemSchema, state.item);
      }),
    "share",
  );
});

const recoveryOperations = new Set([
  "prepare_commerce_fx_recognition",
  "approve_commerce_fx_recognition",
  "execute_commerce_fx_recognition",
  "prepare_commerce_fx_settlement",
  "approve_commerce_fx_settlement",
  "execute_commerce_fx_settlement",
  "prepare_commerce_fx_partial_settlement",
  "approve_commerce_fx_partial_settlement",
  "execute_commerce_fx_partial_settlement",
  "prepare_commerce_fx_settlement_correction",
  "approve_commerce_fx_settlement_correction",
  "execute_commerce_fx_settlement_correction",
]);

function decodeRecovery(operation: string, value: JsonObject) {
  if (operation === "prepare_commerce_fx_recognition") return decode(RecognitionSchema, value);

  if (operation === "prepare_commerce_fx_settlement") return decode(SettlementSchema, value);

  if (operation === "prepare_commerce_fx_partial_settlement")
    return decode(PartialSettlementSchema, value);

  if (operation === "prepare_commerce_fx_settlement_correction")
    return decode(CorrectionSchema, value);

  if (operation === "execute_commerce_fx_recognition") return decode(ItemSchema, value);

  if (operation === "execute_commerce_fx_settlement")
    return decode(FullSettlementReceiptSchema, value);

  if (operation === "execute_commerce_fx_partial_settlement")
    return decode(PartialSettlementReceiptSchema, value);

  if (operation === "execute_commerce_fx_settlement_correction")
    return decode(CorrectionReceiptSchema, value);

  return decode(CommerceFx.FxApproval, value);
}

export const recoverCommand = Effect.fn("commerceFx.recoverCommand")(function* (
  token: string,
  command: { scope: Scope; key: string },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        yield* Db.lockBookForShare(transaction, command.scope);

        const row = (yield* Db.readCommandReceipt(
          transaction,
          command.scope.bookId,
          command.key,
        )).find(
          (candidate) =>
            candidate.actorId === principal.actorId && recoveryOperations.has(candidate.operation),
        );

        const result = row ? yield* decodeRecovery(row.operation, row.result) : null;

        return {
          key: command.key,
          checkedAt: yield* isoNow(transaction),
          status: row ? ("recorded" as const) : ("not_recorded_at_check" as const),
          operation: row?.operation ?? null,
          result,
        } satisfies typeof CommerceFx.CommandRecovery.Type;
      }),
    "share",
  );
});
