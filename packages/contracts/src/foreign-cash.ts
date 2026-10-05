import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CurrencyCode, CurrencyScale } from "@open-erp/domain/exchange-rates";
import { MinorUnits, SignedMinorUnits } from "@open-erp/domain/money";
import { ForeignCashJournalLines } from "@open-erp/domain/foreign-cash";

const PositiveMinor = MinorUnits.check(Schema.isPattern(/^[1-9][0-9]*$/));

const shared = {
  accountId: Accounting.Identifier,
  date: Accounting.AccountingDate,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  evidenceId: Accounting.Identifier,
  sourceIdentity: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._:-]{1,128}$/)),
  reason: Accounting.Description,
  acknowledgeLimitedProfile: Schema.Literal(true),
};

export const NativeObservation = Schema.Struct({
  statementId: Accounting.Identifier,
  rowOrdinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});

export const ExchangeFee = Schema.Struct({
  kind: Schema.Literal("synthetic_foreign_cash_fee_v1"),
  currency: CurrencyCode,
  feeMinor: MinorUnits,
});

const bankSource = { nativeObservation: NativeObservation };

const resultAccounts = {
  gainAccountId: Accounting.Identifier,
  lossAccountId: Accounting.Identifier,
};

const rate = { rateObservationId: Accounting.Identifier, rateDigest: Accounting.Digest };

export const Prepare = Schema.Union([
  Schema.Struct({
    ...shared,
    kind: Schema.Literal("open"),
    nativeCurrency: CurrencyCode,
    nativeScale: CurrencyScale,
    openingNativeMinor: MinorUnits,
  }),
  Schema.Struct({
    ...shared,
    ...bankSource,
    kind: Schema.Literal("transfer"),
    receiverObservation: NativeObservation,
    receiverAccountId: Accounting.Identifier,
    nativeMinor: PositiveMinor,
  }),
  Schema.Struct({
    ...shared,
    ...resultAccounts,
    ...bankSource,
    kind: Schema.Literal("payable"),
    itemId: Accounting.Identifier,
    nativeMinor: PositiveMinor,
  }),
  Schema.Struct({
    ...shared,
    ...resultAccounts,
    ...rate,
    ...bankSource,
    kind: Schema.Literal("receipt"),
    itemId: Accounting.Identifier,
    nativeMinor: PositiveMinor,
  }),
  Schema.Struct({
    ...shared,
    ...resultAccounts,
    ...bankSource,
    kind: Schema.Literal("exchange"),
    receiverAccountId: Accounting.Identifier,
    nativeMinor: PositiveMinor,
    bookObservation: NativeObservation,
    feeEvidenceId: Accounting.Identifier,
    feeAccountId: Accounting.Identifier,
  }),
  Schema.Struct({
    ...shared,
    ...resultAccounts,
    ...rate,
    kind: Schema.Literal("valuation"),
  }),
]);

export const Holding = Schema.Struct({
  accountId: Accounting.Identifier,
  nativeCurrency: CurrencyCode,
  nativeScale: CurrencyScale,
  openedOn: Accounting.AccountingDate,
  nativeMinor: MinorUnits,
  carryingMinor: MinorUnits,
  capacityVersion: Accounting.Digest,
});

export const HoldingEffect = Schema.Struct({
  accountId: Accounting.Identifier,
  nativeDeltaMinor: SignedMinorUnits,
  carryingDeltaMinor: SignedMinorUnits,
});

export const ObligationConsumption = Schema.Struct({
  itemId: Accounting.Identifier,
  itemDigest: Accounting.Digest,
  nativeMinor: PositiveMinor,
  carryingMinor: MinorUnits,
});

export const Review = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  actorId: Accounting.Identifier,
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  input: Prepare,
  snapshot: Schema.JsonObject,
  effects: Schema.Array(HoldingEffect),
  obligation: Schema.NullOr(ObligationConsumption),
  journal: ForeignCashJournalLines,
  postingAction: Schema.NullOr(Schema.JsonObject),
  fiscalYearId: Accounting.Identifier,
  bookCurrency: CurrencyCode,
  createdAt: Schema.String,
});

export const Approve = Schema.Struct({ version: Schema.Literal(1), digest: Accounting.Digest });

export const Execute = Schema.Struct({ ...Approve.fields, approvalId: Accounting.Identifier });

export const Approval = Schema.Struct({
  id: Accounting.Identifier,
  reviewId: Accounting.Identifier,
  actorId: Accounting.Identifier,
  digest: Accounting.Digest,
  expiresAt: Schema.String,
});

export const Execution = Schema.Struct({
  reviewId: Accounting.Identifier,
  digest: Accounting.Digest,
  voucherId: Schema.NullOr(Accounting.Identifier),
  effects: Schema.Array(HoldingEffect),
  obligation: Schema.NullOr(ObligationConsumption),
});

export const PageQuery = Schema.Struct({ after: Schema.optional(Accounting.Identifier) });

export const HoldingPage = Schema.Struct({
  scope: Accounting.Scope,
  items: Schema.Array(Holding),
  next: Schema.NullOr(Accounting.Identifier),
});

export const ReviewPage = Schema.Struct({
  scope: Accounting.Scope,
  accountId: Accounting.Identifier,
  items: Schema.Array(Review),
  next: Schema.NullOr(Accounting.Identifier),
});

export const ExchangeObservation = Schema.Struct({
  statementId: Accounting.Identifier,
  rowOrdinal: Schema.Int,
  accountId: Accounting.Identifier,
  observedOn: Accounting.AccountingDate,
  amountMinor: SignedMinorUnits,
  evidenceId: Accounting.Identifier,
  evidenceSha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
});

export const ExchangeBasis = Schema.Struct({
  book: Schema.Struct({ currency: CurrencyCode, scale: CurrencyScale }),
  holding: Holding,
  nativeObservation: ExchangeObservation,
  bookObservation: ExchangeObservation,
  feeEvidence: Schema.Struct({
    id: Accounting.Identifier,
    sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
    currency: CurrencyCode,
    feeMinor: MinorUnits,
  }),
});

export const ExchangeView = Schema.Struct({
  review: Review,
  basis: ExchangeBasis,
  currentHolding: Holding,
  grossMinor: MinorUnits,
  releasedMinor: MinorUnits,
  gainMinor: SignedMinorUnits,
  remainingNativeMinor: MinorUnits,
  remainingCarryingMinor: MinorUnits,
  approvals: Schema.Array(Approval),
  execution: Schema.NullOr(Execution),
});

export const Reconciliation = Schema.Struct({
  holding: Holding,
  statementId: Accounting.Identifier,
  nativeStatementMinor: SignedMinorUnits,
  nativeDifferenceMinor: SignedMinorUnits,
  ledgerCarryingMinor: SignedMinorUnits,
  bookDifferenceMinor: SignedMinorUnits,
  sourceComplete: Schema.Boolean,
  sourceConsumptionComplete: Schema.Boolean,
  nativeReconciled: Schema.Boolean,
  bookReconciled: Schema.Boolean,
});

const path = "/v1/entities/:entityId/books/:bookId/banking/foreign-cash";

const mutation = {
  params: Accounting.Scope,
  headers: Accounting.IdempotencyHeaders,
  error: accountingErrors,
};

const identified = { params: Accounting.ChangePath, error: accountingErrors };

export const ForeignCashApi = HttpApiGroup.make("foreignCash")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiEndpoint.get("listForeignCashHoldings", `${path}/accounts`, {
      params: Accounting.Scope,
      query: PageQuery,
      error: accountingErrors,
      success: HoldingPage,
    }),
    HttpApiEndpoint.get("listForeignCashReviews", `${path}/accounts/:id/reviews`, {
      ...identified,
      query: PageQuery,
      success: ReviewPage,
    }),
    HttpApiEndpoint.get("getForeignCashExchange", `${path}/reviews/:id/exchange`, {
      ...identified,
      success: ExchangeView,
    }),
    HttpApiEndpoint.post("prepareForeignCash", `${path}/reviews`, {
      ...mutation,
      payload: Prepare,
      success: Review,
    }),
    HttpApiEndpoint.post("approveForeignCash", `${path}/reviews/:id/approvals`, {
      ...identified,
      headers: Accounting.IdempotencyHeaders,
      payload: Approve,
      success: Approval,
    }),
    HttpApiEndpoint.post("executeForeignCash", `${path}/reviews/:id/execute`, {
      ...identified,
      headers: Accounting.IdempotencyHeaders,
      payload: Execute,
      success: Execution,
    }),
    HttpApiEndpoint.get("getForeignCashReview", `${path}/reviews/:id`, {
      ...identified,
      success: Review,
    }),
    HttpApiEndpoint.get("getForeignCashHolding", `${path}/accounts/:id`, {
      ...identified,
      success: Holding,
    }),
    HttpApiEndpoint.get(
      "reconcileForeignCash",
      `${path}/accounts/:id/reconciliation/:statementId`,
      {
        params: Schema.Struct({
          ...Accounting.ChangePath.fields,
          statementId: Accounting.Identifier,
        }),
        error: accountingErrors,
        success: Reconciliation,
      },
    ),
  );

const command = {
  scope: Accounting.Scope,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};

export const ForeignCashCapabilities = {
  banking_prepare_foreign_cash: {
    input: Schema.Struct({ ...command, input: Prepare }),
    output: Review,
    description:
      "Seal a synthetic foreign cash operation from retained native units and book carrying.",
    readOnly: false,
  },
  banking_approve_foreign_cash: {
    input: Schema.Struct({ ...command, reviewId: Accounting.Identifier, input: Approve }),
    output: Approval,
    description: "Human approval of one exact foreign cash review.",
    readOnly: false,
    agentCallable: false,
  },
  banking_execute_foreign_cash: {
    input: Schema.Struct({ ...command, reviewId: Accounting.Identifier, input: Execute }),
    output: Execution,
    description: "Commit approved cash and obligation effects in one financial transaction.",
    readOnly: false,
  },
  banking_get_foreign_cash_holding: {
    input: Schema.Struct({ scope: Accounting.Scope, accountId: Accounting.Identifier }),
    output: Holding,
    description: "Read native units and stored book carrying independently.",
    readOnly: true,
  },
  banking_get_foreign_cash_review: {
    input: Schema.Struct({ scope: Accounting.Scope, reviewId: Accounting.Identifier }),
    output: Review,
    description: "Read the exact retained foreign cash action.",
    readOnly: true,
  },
  banking_reconcile_foreign_cash: {
    input: Schema.Struct({
      scope: Accounting.Scope,
      accountId: Accounting.Identifier,
      statementId: Accounting.Identifier,
    }),
    output: Reconciliation,
    description: "Compare native statement balance and book ledger independently.",
    readOnly: true,
  },
};
