import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import * as Commerce from "./commerce";
import * as Rates from "./exchange-rates";
import { ValuationPlan } from "@open-erp/domain/fx-remeasurement";
import { ChainBasis, ChainRepair } from "@open-erp/domain/fx-chain-repair";

const Currency = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/));

const CurrencyScale = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }));

const PositiveMinor = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,37}$/));

const Profile = Schema.Literal("synthetic_customer_foreign_receivable_v1");

// NEXT-17. The discriminated foreign payable variant through the same commerce FX
// owner. It is a genuine foreign-currency obligation recognized from a qualified
// rate, never a retained book-currency number relabelled as foreign units.
const PayableProfile = Schema.Literal("synthetic_supplier_foreign_payable_v1");

// NEXT-17. The explicit-fee settlement profile. One journal group carries the
// gross book consideration, every fee and every actual cash leg.
const FeeSettlementProfile = Schema.Literal("synthetic_book_currency_settlement_with_fees_v1");

const SettlementProfile = Schema.Literal("synthetic_full_book_currency_settlement_v1");

const PartialSettlementProfile = Schema.Literal("synthetic_partial_book_currency_settlement_v1");

const ItemProfile = Schema.Literals([
  "synthetic_customer_foreign_receivable_v1",
  "synthetic_supplier_foreign_payable_v1",
]);

const SettlementKind = Schema.Literals([
  "synthetic_partial_book_currency_settlement_v1",
  "synthetic_book_currency_settlement_with_fees_v1",
]);

const CorrectionProfile = Schema.Literal("synthetic_latest_settlement_correction_v1");

const RoundingPolicy = Schema.Literal("synthetic_half_up_nonnegative_v1");

// The only fee expense role this profile admits. A fee is a book-currency expense
// resolved to one reviewed account; fee tax, foreign cash, hedges and
// multilateral netting have no reviewed owner here and are refused.
const FeeExpenseRole = Schema.Literal("fee_expense");

const AccountRole = Schema.Literals([
  "control",
  "revenue",
  "expense",
  "cash",
  "realized_gain",
  "realized_loss",
  "fee_expense",
]);

// A reviewed source identity. One identity is consumed by at most one financial
// operation, so the same bank observation or fee evidence cannot be matched twice.
const SourceIdentity = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._:-]{1,128}$/));

const EvidenceReference = Commerce.EvidenceReference;

const CommandReceipt = Commerce.CommandReceipt;

const SharedRecognitionFields = {
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
  cashAccountId: Accounting.Identifier,
  realizedGainAccountId: Accounting.Identifier,
  realizedLossAccountId: Accounting.Identifier,
  accountRoleEvidence: EvidenceReference,
  evidenceId: Accounting.Identifier,
  eventKey: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/)),
  reason: Accounting.Description,
  syntheticNoTaxConfirmed: Schema.Literal(true),
  acknowledgeLimitedProfile: Schema.Literal(true),
};

export const PrepareRecognition = Schema.Struct({
  profile: Profile,
  ...SharedRecognitionFields,
  revenueAccountId: Accounting.Identifier,
});

export const PreparePayableRecognition = Schema.Struct({
  profile: PayableProfile,
  ...SharedRecognitionFields,
  expenseAccountId: Accounting.Identifier,
});

export const PrepareRecognitionCommand = Schema.Union([
  PrepareRecognition,
  PreparePayableRecognition,
]);

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

export const SettlementFee = Schema.Struct({
  sourceIdentity: SourceIdentity,
  bookMinor: PositiveMinor,
  expenseRole: FeeExpenseRole,
  treatmentWitness: EvidenceReference,
});

// One actual cash leg created by this operation. The signed book amounts must
// total the settlement's own signed cash amount exactly; no observation is
// matched twice and none is manufactured from a net figure.
export const SettlementCashSource = Schema.Struct({
  sourceIdentity: SourceIdentity,
  signedBookMinor: Schema.String.check(Schema.isPattern(/^-?[1-9][0-9]{0,37}$/)),
  treatmentWitness: EvidenceReference,
});

export const PrepareFeeSettlement = Schema.Struct({
  profile: FeeSettlementProfile,
  itemId: Accounting.Identifier,
  originalReleasedMinor: PositiveMinor,
  settlementDate: Accounting.AccountingDate,
  accountingPeriodId: Accounting.Identifier,
  // K. The evidenced gross settlement consideration in book minor units. It is
  // never the current exchange-rate quote multiplied by principal, and a zero
  // consideration is not a settlement.
  grossBookMinor: PositiveMinor,
  feeExpenseAccountId: Accounting.Identifier,
  feeAccountRoleEvidence: EvidenceReference,
  fees: Schema.Array(SettlementFee).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  // At least one leg is required: a settlement whose signed cash equation is
  // nonzero always has at least one actual cash observation behind it.
  actualCashSources: Schema.Array(SettlementCashSource).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(20),
  ),
  evidenceId: Accounting.Identifier,
  eventKey: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/)),
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  reason: Accounting.Description,
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
  kind: Schema.Literals([
    "recognition",
    "settlement",
    "partial_settlement",
    "fee_settlement",
    "correction",
  ]),
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
  kind: ItemProfile,
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
  input: PrepareRecognitionCommand,
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

const SettlementItemSnapshot = Schema.Struct({
  id: Accounting.Identifier,
  digest: Accounting.Digest,
  source: SourceObligation,
  rate: RateBinding,
  accountBindings: AccountBindings,
  remainingOriginalMinor: PositiveMinor,
  remainingCarryingMinor: Accounting.MinorUnits,
});

// One retained settlement source. It binds a reviewed source identity to the exact
// journal line this operation created and to the treatment evidence. A corrected
// settlement releases its sources without deleting them, so the right is derived
// from the retained history rather than from a mutable flag.
export const SettlementSource = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  settlementId: Accounting.Identifier,
  ordinal: Schema.Int.check(Schema.isGreaterThan(0)),
  kind: Schema.Literals(["fee", "cash_source"]),
  sourceIdentity: SourceIdentity,
  accountId: Accounting.Identifier,
  // The exact journal line this settlement created for the leg. A reversal posts
  // new lines, so this stays the original line and the correction is what makes the
  // source reusable.
  journalLineId: Accounting.Identifier,
  signedBookMinor: Accounting.SignedMinorUnits,
  evidenceId: Accounting.Identifier,
  receipt: CommandReceipt,
  digest: Accounting.Digest,
});

const FeeSettlementCalculation = Schema.Struct({
  legOrdinal: Schema.Int.check(Schema.isGreaterThan(0)),
  direction: Schema.Literals(["customer", "supplier"]),
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
  grossBookMinor: Accounting.MinorUnits,
  feeTotalMinor: Accounting.MinorUnits,
  signedCashMinor: Accounting.SignedMinorUnits,
  realizedGainMinor: Accounting.SignedMinorUnits,
  cashSourceCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  feeCount: Schema.Int.check(Schema.isGreaterThan(0)),
  formula: Schema.String,
});

export const FeeSettlementReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  itemId: Accounting.Identifier,
  profile: FeeSettlementProfile,
  legOrdinal: Schema.Int.check(Schema.isGreaterThan(0)),
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  calculation: FeeSettlementCalculation,
  sources: Schema.Array(SettlementSource).check(Schema.isMinLength(1), Schema.isMaxLength(40)),
  postingReceipt: Accounting.ExecutionReceipt,
  committedAt: Schema.String,
  digest: Accounting.Digest,
  receipt: CommandReceipt,
});

export const FeeSettlementReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  itemId: Accounting.Identifier,
  input: PrepareFeeSettlement,
  snapshot: Schema.Struct({
    item: SettlementItemSnapshot,
    sourceEvidence: EvidenceReference,
    feeRoleEvidence: EvidenceReference,
    calculation: FeeSettlementCalculation,
    fiscalYearId: Accounting.Identifier,
    profileVersion: Accounting.MinorUnits,
    writerEpoch: Accounting.MinorUnits,
    periodVersion: Accounting.MinorUnits,
    accountBindings: AccountBindings,
    feeExpenseAccount: AccountBinding,
  }),
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
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
  // The fee and cash source rights the reversed settlement releases. The full
  // settlement profile has none, so the field is absent rather than zero.
  restoredSourceCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  settlementProfile: Schema.optional(SettlementKind),
  legOrdinal: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  reason: Accounting.Description,
  committedAt: Schema.String,
  digest: Accounting.Digest,
  receipt: CommandReceipt,
});

export const MonetaryItem = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  kind: ItemProfile,
  direction: Schema.Literals(["customer", "supplier"]),
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
  feeSettlements: Schema.optional(Schema.Array(FeeSettlementReceipt)),
  // The corrections of explicit-fee settlements. Without them a reader cannot see
  // that a settlement in `feeSettlements` was reversed, and therefore cannot tell
  // that its fee and cash source rights are consumable again.
  feeCorrections: Schema.optional(Schema.Array(CorrectionReceipt)),
  receipt: CommandReceipt,
  digest: Accounting.Digest,
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
    settlement: Schema.Union([SettlementReceipt, PartialSettlementReceipt, FeeSettlementReceipt]),
    voucher: Accounting.Voucher,
    sourceEvidence: EvidenceReference,
    // Bounded by the widest settlement journal: two cash legs, one control leg,
    // twenty fee legs and one realized leg.
    reversalLines: Schema.Array(FxJournalLine).check(Schema.isMinLength(2), Schema.isMaxLength(24)),
    fiscalYearId: Accounting.Identifier,
    profileVersion: Accounting.MinorUnits,
    writerEpoch: Accounting.MinorUnits,
    periodVersion: Accounting.MinorUnits,
    accountBindings: AccountBindings,
    restoredSourceCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
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
      FeeSettlementReview,
      SettlementCorrectionReview,
      FxApproval,
      MonetaryItem,
      SettlementReceipt,
      PartialSettlementReceipt,
      FeeSettlementReceipt,
      CorrectionReceipt,
    ]),
  ),
});

// NEXT-18. An incremental open-item FX remeasurement. The caller names the
// items, the reporting-rate revision and the cutoff; it states no amount and
// no carrying. The owner reads every remaining balance, every current
// carrying and the retained rate, and seals the target-less-current plan.
export const RemeasurementItemSelection = Schema.Struct({
  itemId: Accounting.Identifier,
});

export const PrepareRemeasurement = Schema.Struct({
  itemIds: Schema.Array(Accounting.Identifier).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(500),
  ),
  rateObservationId: Accounting.Identifier,
  rateDigest: Accounting.Digest,
  accountingCutoff: Accounting.AccountingDate,
  bookScale: Rates.CurrencyScale,
  unrealizedGainAccountId: Accounting.Identifier,
  unrealizedLossAccountId: Accounting.Identifier,
  rounding: Schema.Literals(["exact", "half_up"]),
  economicDecisionId: Accounting.Identifier,
  fiscalYearId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  reason: Accounting.Description,
});

// The posting witnesses above are reviewed configuration: the fiscal year,
// period and series the cutoff falls in. They are verified at prepare and
// sealed with the plan, so execution cannot move the valuation to another
// period.

// The posting witnesses are reviewed configuration, not valuation math: the
// fiscal year, period and series the cutoff falls in, and the book currency the
// valuation is stated in. They are verified at prepare and sealed with the plan.
export const RemeasurementPosting = Schema.Struct({
  fiscalYearId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  bookCurrency: Currency,
});
// NEXT-41. A late rate correction replays one item's frozen chain: prior
// valuations and settlements are read as history, the corrected rate is
// applied, and the per-date attribution delta posts as a correction journal.
// The caller names the item, the corrected rate revision and the repair key;
// every event, carrying and prior delta comes from a retained row.

export const PrepareChainRepair = Schema.Struct({
  itemId: Accounting.Identifier,
  rateObservationId: Accounting.Identifier,
  rateDigest: Accounting.Digest,
  accountingCutoff: Accounting.AccountingDate,
  repairKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  rounding: Schema.Literals(["exact", "half_up"]),
  economicDecisionId: Accounting.Identifier,
  unrealizedGainAccountId: Accounting.Identifier,
  unrealizedLossAccountId: Accounting.Identifier,
  fiscalYearId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  reason: Accounting.Description,
});

export const ChainRepairReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  actorId: Accounting.Identifier,
  digest: Accounting.Digest,
  repair: ChainRepair,
  // The sealed basis is retained whole, so execution re-verifies the same
  // frozen chain rather than reconstructing a different one.
  basis: ChainBasis,
  gainAccountId: Accounting.Identifier,
  lossAccountId: Accounting.Identifier,
  controlAccountId: Accounting.Identifier,
  rateEvidenceId: Accounting.Identifier,
  posting: RemeasurementPosting,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const ApproveChainRepair = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
});

export const ChainRepairApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  digest: Accounting.Digest,
  version: Schema.Literal(1),
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const ExecuteChainRepair = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  approvalId: Accounting.Identifier,
});

export const ChainRepairExecuted = Schema.Struct({
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  digest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  voucherId: Schema.NullOr(Accounting.Identifier),
  createdAt: Schema.String,
});

export const RemeasurementReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  actorId: Accounting.Identifier,
  digest: Accounting.Digest,
  plan: ValuationPlan,
  // The reporting rate's evidence anchors the posting event. It is read from
  // the retained rate revision at prepare, never stated by the caller.
  rateEvidenceId: Accounting.Identifier,
  posting: RemeasurementPosting,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const ApproveRemeasurement = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
});

export const RemeasurementApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  digest: Accounting.Digest,
  version: Schema.Literal(1),
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const ExecuteRemeasurement = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  approvalId: Accounting.Identifier,
});

export const RemeasurementExecuted = Schema.Struct({
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  digest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  voucherId: Schema.NullOr(Accounting.Identifier),
  effectCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  createdAt: Schema.String,
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
    payload: PrepareRecognitionCommand.annotate({ parseOptions: { onExcessProperty: "error" } }),
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
  HttpApiEndpoint.post("prepareCommerceFxFeeSettlement", `${path}/fee-settlement-reviews`, {
    ...mutation,
    payload: PrepareFeeSettlement.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: FeeSettlementReview,
  }),
  HttpApiEndpoint.post(
    "approveCommerceFxFeeSettlement",
    `${path}/fee-settlement-reviews/:id/approvals`,
    {
      ...identifiedMutation,
      payload: ApproveFx.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: FxApproval,
    },
  ),
  HttpApiEndpoint.post(
    "executeCommerceFxFeeSettlement",
    `${path}/fee-settlement-reviews/:id/execute`,
    {
      ...identifiedMutation,
      payload: ExecuteFx.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: FeeSettlementReceipt,
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
  HttpApiEndpoint.post("prepareFxRemeasurement", `${path}/remeasurement-reviews`, {
    ...mutation,
    payload: PrepareRemeasurement.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: RemeasurementReview,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("approveFxRemeasurement", `${path}/remeasurement-reviews/:id/approvals`, {
    ...identifiedMutation,
    payload: ApproveRemeasurement.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: RemeasurementApproval,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("executeFxRemeasurement", `${path}/remeasurement-reviews/:id/execute`, {
    ...identifiedMutation,
    payload: ExecuteRemeasurement.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: RemeasurementExecuted,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("prepareFxChainRepair", `${path}/chain-repair-reviews`, {
    ...mutation,
    payload: PrepareChainRepair.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ChainRepairReview,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("approveFxChainRepair", `${path}/chain-repair-reviews/:id/approvals`, {
    ...identifiedMutation,
    payload: ApproveChainRepair.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ChainRepairApproval,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("executeFxChainRepair", `${path}/chain-repair-reviews/:id/execute`, {
    ...identifiedMutation,
    payload: ExecuteChainRepair.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ChainRepairExecuted,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getFxChainRepair", `${path}/chain-repair-reviews/:id`, {
    ...identified,
    success: ChainRepairReview,
  }),
  HttpApiEndpoint.get("getFxRemeasurement", `${path}/remeasurement-reviews/:id`, {
    ...identified,
    success: RemeasurementReview,
  }),
);
