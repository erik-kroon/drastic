import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import * as Commerce from "./commerce";
import * as Rates from "./exchange-rates";

const Currency = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/));
const CurrencyScale = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }));
const PositiveMinor = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,37}$/));
const Profile = Schema.Literal("synthetic_customer_foreign_receivable_v1");
const SettlementProfile = Schema.Literal("synthetic_full_book_currency_settlement_v1");
const PartialSettlementProfile = Schema.Literal("synthetic_partial_book_currency_settlement_v1");
const CorrectionProfile = Schema.Literal("synthetic_latest_settlement_correction_v1");
const RoundingPolicy = Schema.Literal("synthetic_half_up_nonnegative_v1");
const AccountRole = Schema.Literals([
  "control",
  "revenue",
  "cash",
  "realized_gain",
  "realized_loss",
]);
const EvidenceReference = Commerce.EvidenceReference;
const CommandReceipt = Commerce.CommandReceipt;

export const PrepareRecognition = Schema.Struct({
  profile: Profile,
  sourceKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  sourceRevision: Commerce.Version,
  counterpartyId: Accounting.Identifier,
  counterpartyRevision: Commerce.Version,
  documentNumber: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  recognitionDate: Accounting.AccountingDate,
  originalCurrency: Currency,
  originalScale: CurrencyScale,
  originalMinor: PositiveMinor,
  rateObservationId: Accounting.Identifier,
  rateDigest: Accounting.Digest,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  controlAccountId: Accounting.Identifier,
  revenueAccountId: Accounting.Identifier,
  cashAccountId: Accounting.Identifier,
  realizedGainAccountId: Accounting.Identifier,
  realizedLossAccountId: Accounting.Identifier,
  accountRoleEvidence: EvidenceReference,
  evidenceId: Accounting.Identifier,
  eventKey: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/)),
  reason: Accounting.Description,
  syntheticNoTaxConfirmed: Schema.Literal(true),
  acknowledgeLimitedProfile: Schema.Literal(true),
});
export const PrepareSettlement = Schema.Struct({
  profile: SettlementProfile,
  itemId: Accounting.Identifier,
  settlementDate: Accounting.AccountingDate,
  accountingPeriodId: Accounting.Identifier,
  considerationMinor: PositiveMinor,
  evidenceId: Accounting.Identifier,
  eventKey: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/)),
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  reason: Accounting.Description,
  feesExcluded: Schema.Literal(true),
  fullSettlementOnly: Schema.Literal(true),
  acknowledgeLimitedProfile: Schema.Literal(true),
});
export const PreparePartialSettlement = Schema.Struct({
  profile: PartialSettlementProfile,
  itemId: Accounting.Identifier,
  originalReleasedMinor: PositiveMinor,
  settlementDate: Accounting.AccountingDate,
  accountingPeriodId: Accounting.Identifier,
  considerationMinor: PositiveMinor,
  evidenceId: Accounting.Identifier,
  eventKey: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/)),
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  reason: Accounting.Description,
  feesExcluded: Schema.Literal(true),
  acknowledgeLimitedProfile: Schema.Literal(true),
});
export const PrepareSettlementCorrection = Schema.Struct({
  profile: CorrectionProfile,
  settlementId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  evidenceId: Accounting.Identifier,
  reason: Accounting.Description,
  latestUnconsumedOnly: Schema.Literal(true),
  acknowledgeLimitedProfile: Schema.Literal(true),
});
export const ApproveFx = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
});
export const ExecuteFx = Schema.Struct({
  ...ApproveFx.fields,
  approvalId: Accounting.Identifier,
});
export const FxApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  kind: Schema.Literals(["recognition", "settlement", "partial_settlement", "correction"]),
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  receipt: CommandReceipt,
});
const AccountBinding = Schema.Struct({
  role: AccountRole,
  accountId: Accounting.Identifier,
  version: Accounting.MinorUnits,
});
const AccountBindings = Schema.Array(AccountBinding).check(
  Schema.isMinLength(5),
  Schema.isMaxLength(5),
);
const SourceObligation = Schema.Struct({
  kind: Profile,
  sourceKey: PrepareRecognition.fields.sourceKey,
  sourceRevision: Commerce.Version,
  counterpartyId: Accounting.Identifier,
  counterpartyRevision: Commerce.Version,
  counterpartyName: Schema.String,
  documentNumber: PrepareRecognition.fields.documentNumber,
  recognitionDate: Accounting.AccountingDate,
  evidence: EvidenceReference,
});
const RateBinding = Schema.Struct({
  observationId: Accounting.Identifier,
  revision: Schema.Int,
  digest: Accounting.Digest,
  rate: Rates.ExchangeRateRevision,
});
const BookBasis = Schema.Struct({
  currency: Currency,
  currencyScale: CurrencyScale,
  profile: Schema.String,
  profileVersion: Accounting.MinorUnits,
  writerAuthority: Schema.String,
  writerEpoch: Accounting.MinorUnits,
});
const RecognitionCalculation = Schema.Struct({
  originalCurrency: Currency,
  originalScale: CurrencyScale,
  originalMinor: PositiveMinor,
  bookCurrency: Currency,
  bookScale: CurrencyScale,
  carryingMinor: PositiveMinor,
  exactNumerator: Schema.String,
  exactDenominator: Schema.String,
  quotientMinor: Schema.String,
  remainderNumerator: Schema.String,
  residualNumerator: Schema.String,
  residualDenominator: Schema.String,
  roundingPolicy: RoundingPolicy,
  formula: Schema.String,
});
export const RecognitionReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  itemId: Accounting.Identifier,
  input: PrepareRecognition,
  snapshot: Schema.Struct({
    bookBasis: BookBasis,
    rate: Rates.ExchangeRateRevision,
    counterpart: Commerce.CounterpartyRevision,
    sourceEvidence: EvidenceReference,
    accountRoleEvidence: EvidenceReference,
    accountBindings: AccountBindings,
    calculation: RecognitionCalculation,
    fiscalYearId: Accounting.Identifier,
    profileVersion: Accounting.MinorUnits,
    writerEpoch: Accounting.MinorUnits,
    periodVersion: Accounting.MinorUnits,
  }),
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  digest: Accounting.Digest,
  receipt: CommandReceipt,
});
export const SettlementReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  itemId: Accounting.Identifier,
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  originalReleasedMinor: PositiveMinor,
  carryingReleasedMinor: PositiveMinor,
  considerationMinor: PositiveMinor,
  realizedGainMinor: Accounting.SignedMinorUnits,
  formula: Schema.String,
  postingReceipt: Accounting.ExecutionReceipt,
  committedAt: Schema.String,
  digest: Accounting.Digest,
  receipt: CommandReceipt,
});
const PartialSettlementCalculation = Schema.Struct({
  legOrdinal: Schema.Int.check(Schema.isGreaterThan(0)),
  originalRemainingBeforeMinor: PositiveMinor,
  originalReleasedMinor: PositiveMinor,
  originalRemainingAfterMinor: Accounting.MinorUnits,
  carryingRemainingBeforeMinor: Accounting.MinorUnits,
  carryingReleasedMinor: Accounting.MinorUnits,
  carryingRemainingAfterMinor: Accounting.MinorUnits,
  exactNumerator: Schema.String,
  exactDenominator: PositiveMinor,
  quotientMinor: Accounting.MinorUnits,
  remainderNumerator: Schema.String,
  residualNumerator: Schema.String,
  residualDenominator: PositiveMinor,
  roundingPolicy: RoundingPolicy,
  finalLeg: Schema.Boolean,
  considerationMinor: PositiveMinor,
  realizedGainMinor: Accounting.SignedMinorUnits,
  formula: Schema.String,
});
export const PartialSettlementReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  itemId: Accounting.Identifier,
  profile: PartialSettlementProfile,
  legOrdinal: Schema.Int.check(Schema.isGreaterThan(0)),
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  calculation: PartialSettlementCalculation,
  postingReceipt: Accounting.ExecutionReceipt,
  committedAt: Schema.String,
  digest: Accounting.Digest,
  receipt: CommandReceipt,
});
export const CorrectionReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  itemId: Accounting.Identifier,
  settlementId: Accounting.Identifier,
  settlementDigest: Accounting.Digest,
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  originalVoucherId: Accounting.Identifier,
  postingReceipt: Accounting.ExecutionReceipt,
  restoredOriginalMinor: PositiveMinor,
  restoredCarryingMinor: Accounting.MinorUnits,
  settlementProfile: Schema.optional(PartialSettlementProfile),
  legOrdinal: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  reason: Accounting.Description,
  committedAt: Schema.String,
  digest: Accounting.Digest,
  receipt: CommandReceipt,
});
export const MonetaryItem = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  kind: Profile,
  direction: Schema.Literal("customer"),
  status: Schema.Literals(["open", "partially_settled", "settled", "corrected"]),
  source: SourceObligation,
  rate: RateBinding,
  original: Schema.Struct({ currency: Currency, scale: CurrencyScale, minor: PositiveMinor }),
  book: Schema.Struct({ currency: Currency, scale: CurrencyScale, carryingMinor: PositiveMinor }),
  initialOriginalMinor: PositiveMinor,
  initialCarryingMinor: PositiveMinor,
  remainingOriginalMinor: Accounting.MinorUnits,
  remainingCarryingMinor: Accounting.MinorUnits,
  accountBindings: AccountBindings,
  recognition: Schema.Struct({
    eventId: Accounting.Identifier,
    voucherId: Accounting.Identifier,
    lineId: Accounting.Identifier,
    postingReceipt: Accounting.ExecutionReceipt,
  }),
  settlement: Schema.NullOr(SettlementReceipt),
  correction: Schema.NullOr(CorrectionReceipt),
  partialSettlements: Schema.optional(Schema.Array(PartialSettlementReceipt)),
  partialCorrections: Schema.optional(Schema.Array(CorrectionReceipt)),
  receipt: CommandReceipt,
  digest: Accounting.Digest,
});
const SettlementItemSnapshot = Schema.Struct({
  id: Accounting.Identifier,
  digest: Accounting.Digest,
  source: SourceObligation,
  rate: RateBinding,
  accountBindings: AccountBindings,
  remainingOriginalMinor: PositiveMinor,
  remainingCarryingMinor: Accounting.MinorUnits,
});
export const SettlementReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  itemId: Accounting.Identifier,
  input: PrepareSettlement,
  snapshot: Schema.Struct({
    item: SettlementItemSnapshot,
    sourceEvidence: EvidenceReference,
    calculation: Schema.Struct({
      originalReleasedMinor: PositiveMinor,
      carryingReleasedMinor: PositiveMinor,
      considerationMinor: PositiveMinor,
      realizedGainMinor: Accounting.SignedMinorUnits,
      formula: Schema.String,
    }),
    fiscalYearId: Accounting.Identifier,
    profileVersion: Accounting.MinorUnits,
    writerEpoch: Accounting.MinorUnits,
    periodVersion: Accounting.MinorUnits,
    accountBindings: AccountBindings,
  }),
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  digest: Accounting.Digest,
  receipt: CommandReceipt,
});
export const PartialSettlementReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  itemId: Accounting.Identifier,
  input: PreparePartialSettlement,
  snapshot: Schema.Struct({
    item: SettlementItemSnapshot,
    sourceEvidence: EvidenceReference,
    calculation: PartialSettlementCalculation,
    fiscalYearId: Accounting.Identifier,
    profileVersion: Accounting.MinorUnits,
    writerEpoch: Accounting.MinorUnits,
    periodVersion: Accounting.MinorUnits,
    accountBindings: AccountBindings,
  }),
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  digest: Accounting.Digest,
  receipt: CommandReceipt,
});
const FxJournalLine = Schema.Struct({
  ...Accounting.JournalLine.fields,
  lineId: Accounting.Identifier,
});
export const SettlementCorrectionReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  settlementId: Accounting.Identifier,
  input: PrepareSettlementCorrection,
  snapshot: Schema.Struct({
    item: MonetaryItem,
    settlement: Schema.Union([SettlementReceipt, PartialSettlementReceipt]),
    voucher: Accounting.Voucher,
    sourceEvidence: EvidenceReference,
    reversalLines: Schema.Array(FxJournalLine).check(Schema.isMinLength(2), Schema.isMaxLength(3)),
    fiscalYearId: Accounting.Identifier,
    profileVersion: Accounting.MinorUnits,
    writerEpoch: Accounting.MinorUnits,
    periodVersion: Accounting.MinorUnits,
    accountBindings: AccountBindings,
  }),
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  digest: Accounting.Digest,
  receipt: CommandReceipt,
});
export const CommandRecovery = Schema.Struct({
  key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
  checkedAt: Schema.String,
  status: Schema.Literals(["recorded", "not_recorded_at_check"]),
  operation: Schema.NullOr(Schema.String),
  result: Schema.NullOr(
    Schema.Union([
      RecognitionReview,
      SettlementReview,
      PartialSettlementReview,
      SettlementCorrectionReview,
      FxApproval,
      MonetaryItem,
      SettlementReceipt,
      PartialSettlementReceipt,
      CorrectionReceipt,
    ]),
  ),
});

const path = "/v1/entities/:entityId/books/:bookId/commerce/fx";
const scoped = { params: Accounting.Scope, error: accountingErrors };
const identified = { params: Accounting.ChangePath, error: accountingErrors };
const mutation = { ...scoped, headers: Accounting.IdempotencyHeaders };
const identifiedMutation = { ...identified, headers: Accounting.IdempotencyHeaders };
const RecoveryPath = Schema.Struct({
  ...Accounting.Scope.fields,
  key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
});
export const CommerceFxApi = HttpApiGroup.make("commerceFx").add(
  HttpApiEndpoint.post("prepareCommerceFxRecognition", `${path}/recognition-reviews`, {
    ...mutation,
    payload: PrepareRecognition.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: RecognitionReview,
  }),
  HttpApiEndpoint.post(
    "approveCommerceFxRecognition",
    `${path}/recognition-reviews/:id/approvals`,
    {
      ...identifiedMutation,
      payload: ApproveFx.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: FxApproval,
    },
  ),
  HttpApiEndpoint.post("executeCommerceFxRecognition", `${path}/recognition-reviews/:id/execute`, {
    ...identifiedMutation,
    payload: ExecuteFx.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: MonetaryItem,
  }),
  HttpApiEndpoint.post("prepareCommerceFxSettlement", `${path}/settlement-reviews`, {
    ...mutation,
    payload: PrepareSettlement.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SettlementReview,
  }),
  HttpApiEndpoint.post("approveCommerceFxSettlement", `${path}/settlement-reviews/:id/approvals`, {
    ...identifiedMutation,
    payload: ApproveFx.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: FxApproval,
  }),
  HttpApiEndpoint.post("executeCommerceFxSettlement", `${path}/settlement-reviews/:id/execute`, {
    ...identifiedMutation,
    payload: ExecuteFx.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SettlementReceipt,
  }),
  HttpApiEndpoint.post("prepareCommerceFxPartialSettlement", `${path}/partial-settlement-reviews`, {
    ...mutation,
    payload: PreparePartialSettlement.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: PartialSettlementReview,
  }),
  HttpApiEndpoint.post(
    "approveCommerceFxPartialSettlement",
    `${path}/partial-settlement-reviews/:id/approvals`,
    {
      ...identifiedMutation,
      payload: ApproveFx.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: FxApproval,
    },
  ),
  HttpApiEndpoint.post(
    "executeCommerceFxPartialSettlement",
    `${path}/partial-settlement-reviews/:id/execute`,
    {
      ...identifiedMutation,
      payload: ExecuteFx.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: PartialSettlementReceipt,
    },
  ),
  HttpApiEndpoint.post("prepareCommerceFxSettlementCorrection", `${path}/settlement-corrections`, {
    ...mutation,
    payload: PrepareSettlementCorrection.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SettlementCorrectionReview,
  }),
  HttpApiEndpoint.post(
    "approveCommerceFxSettlementCorrection",
    `${path}/settlement-corrections/:id/approvals`,
    {
      ...identifiedMutation,
      payload: ApproveFx.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: FxApproval,
    },
  ),
  HttpApiEndpoint.post(
    "executeCommerceFxSettlementCorrection",
    `${path}/settlement-corrections/:id/execute`,
    {
      ...identifiedMutation,
      payload: ExecuteFx.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: CorrectionReceipt,
    },
  ),
  HttpApiEndpoint.get("getCommerceFxItem", `${path}/items/:id`, {
    ...identified,
    success: MonetaryItem,
  }),
  HttpApiEndpoint.get("recoverCommerceFxCommand", `${path}/commands/:key`, {
    params: RecoveryPath,
    error: accountingErrors,
    success: CommandRecovery,
  }),
);
