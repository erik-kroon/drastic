import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CommandReceipt } from "./reconciliation";

const MaybeText = Schema.NullOr(Accounting.Description);

const MaybeId = Schema.NullOr(Accounting.Identifier);

const MaybeDate = Schema.NullOr(Accounting.AccountingDate);

const MaybeAmount = Schema.NullOr(Accounting.MinorUnits);

const PositiveInteger = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,37}$/));

const Country = Schema.NullOr(Schema.String.check(Schema.isPattern(/^[A-Z]{2}$/)));

export const TaxAmounts = Schema.Struct({
  grossMinor: MaybeAmount,
  netMinor: MaybeAmount,
  vatMinor: MaybeAmount,
});

export const TaxSourceFacts = Schema.Struct({
  evidenceId: Accounting.Identifier,
  sourceLocator: Accounting.Description,
  description: Accounting.Description,
  recordClass: Schema.Literals(["actual_company", "synthetic"]),
  amounts: TaxAmounts,
  currency: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/))),
  currencyScale: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }))),
  supplierJurisdiction: Country,
  supplyJurisdiction: Country,
  issuedOn: MaybeDate,
  receivedOn: MaybeDate,
  suppliedOn: MaybeDate,
  taxPointOn: MaybeDate,
  changeSetId: MaybeId,
  voucherId: MaybeId,
});

export const RecordTaxSource = Schema.Struct({
  sourceKey: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/)),
  expectedSourceDigest: Schema.NullOr(Accounting.Digest),
  facts: TaxSourceFacts,
});

export const TaxReviewFacts = Schema.Struct({
  evidenceId: Accounting.Identifier,
  rationale: Accounting.Description,
  amounts: TaxAmounts,
  registration: Schema.Literals(["unknown", "registered", "not_registered"]),
  registrationEvidenceId: MaybeId,
  method: Schema.Literals(["unknown", "accrual", "cash"]),
  methodEvidenceId: MaybeId,
  bookJurisdiction: Country,
  suppliedOn: MaybeDate,
  taxPointOn: MaybeDate,
  dateBasis: MaybeText,
  dateEvidenceId: MaybeId,
  treatment: Schema.Literals([
    "unknown",
    "domestic_purchase",
    "foreign_purchase",
    "reverse_charge",
    "import",
    "exempt",
    "out_of_scope",
    "other",
  ]),
  profileId: MaybeText,
  profileVersion: MaybeText,
  rateNumerator: MaybeAmount,
  rateDenominator: Schema.NullOr(PositiveInteger),
  deductionNumerator: MaybeAmount,
  deductionDenominator: Schema.NullOr(PositiveInteger),
  deductionBasis: MaybeText,
  deductionEvidenceId: MaybeId,
  roundingPolicy: Schema.Literals(["unknown", "exact_only"]),
});

export const ReviewTaxSource = Schema.Struct({
  sourceDigest: Accounting.Digest,
  expectedReviewDigest: Schema.NullOr(Accounting.Digest),
  facts: TaxReviewFacts,
});

const RecordFields = {
  id: Accounting.Identifier,
  sourceId: Accounting.Identifier,
  revision: Schema.Int,
  digest: Accounting.Digest,
  previousDigest: Schema.NullOr(Accounting.Digest),
  scope: Accounting.Scope,
  recordedAt: Schema.String,
  receipt: CommandReceipt,
};

export const TaxSourceRevision = Schema.Struct({
  ...RecordFields,
  sourceKey: Schema.String,
  facts: TaxSourceFacts,
  evidenceSha256: Schema.String,
});

export const TaxReview = Schema.Struct({
  ...RecordFields,
  sourceDigest: Accounting.Digest,
  facts: TaxReviewFacts,
  evidenceRefs: Schema.Array(
    Schema.Struct({ evidenceId: Accounting.Identifier, sha256: Schema.String }),
  ),
  authority: Schema.Literal("operator_fact_review_only"),
});

export const WithdrawTaxSource = Schema.Struct({
  expectedSourceDigest: Accounting.Digest,
  evidenceId: Accounting.Identifier,
  rationale: Accounting.Description,
});

export const TaxSourceWithdrawal = Schema.Struct({
  id: Accounting.Identifier,
  digest: Accounting.Digest,
  scope: Accounting.Scope,
  sourceId: Accounting.Identifier,
  revisionId: Accounting.Identifier,
  revision: Schema.Int,
  revisionDigest: Accounting.Digest,
  input: WithdrawTaxSource,
  evidenceSha256: Schema.String,
  permanent: Schema.Literal(true),
  recordedAt: Schema.String,
  receipt: CommandReceipt,
});

export const TaxSourceView = Schema.Struct({
  withdrawal: Schema.NullOr(TaxSourceWithdrawal),
  current: TaxSourceRevision,
  latestReview: Schema.NullOr(TaxReview),
  reviewCurrent: Schema.Boolean,
  sourceHistory: Schema.Array(TaxSourceRevision),
  reviewHistory: Schema.Array(TaxReview),
});

export const ExpenseTaxBlocker = Schema.Literals([
  "withdrawn_source",
  "duplicate_source_component",
  "ambiguous_voucher_sources",
  "missing_review",
  "stale_review",
  "wrong_record_class",
  "production_profile_unapproved",
  "unsupported_profile",
  "missing_source_amounts",
  "missing_review_amounts",
  "source_amount_difference",
  "review_amount_difference",
  "source_review_difference",
  "missing_currency",
  "foreign_currency",
  "missing_jurisdiction",
  "foreign_supply",
  "missing_source_dates",
  "missing_review_dates",
  "date_difference",
  "outside_interval",
  "registration_unknown_or_unsupported",
  "method_unknown_or_unsupported",
  "unsupported_treatment",
  "missing_rate",
  "missing_deduction_basis",
  "invalid_deduction_fraction",
  "rounding_policy_unavailable",
  "fractional_tax",
  "fractional_deduction",
  "calculated_tax_difference",
  "amount_out_of_range",
]);

const Difference = Schema.NullOr(Accounting.SignedMinorUnits);

export const TaxControls = Schema.Struct({
  sourceBalanceDifferenceMinor: Difference,
  reviewBalanceDifferenceMinor: Difference,
  grossDifferenceMinor: Difference,
  netDifferenceMinor: Difference,
  vatDifferenceMinor: Difference,
  calculatedVatDifferenceMinor: Difference,
});

export const TaxCalculation = Schema.Struct({
  taxProductNumerator: Accounting.AggregateMinorUnits,
  rateDenominator: PositiveInteger,
  taxRemainder: Accounting.AggregateMinorUnits,
  calculatedVatMinor: MaybeAmount,
  deductionProductNumerator: Schema.NullOr(Accounting.AggregateMinorUnits),
  deductionDenominator: Schema.NullOr(PositiveInteger),
  deductionRemainder: Schema.NullOr(Accounting.AggregateMinorUnits),
  deductibleMinor: MaybeAmount,
  nonDeductibleMinor: MaybeAmount,
  expenseMinor: MaybeAmount,
});

export const TaxContribution = Schema.Struct({
  grossMinor: Accounting.MinorUnits,
  netMinor: Accounting.MinorUnits,
  vatMinor: Accounting.MinorUnits,
  deductibleMinor: Accounting.MinorUnits,
  nonDeductibleMinor: Accounting.MinorUnits,
  expenseMinor: Accounting.MinorUnits,
});

export const TaxAssessment = Schema.Struct({
  state: Schema.Literals(["included_synthetic", "excluded"]),
  blockers: Schema.Array(ExpenseTaxBlocker),
  controls: TaxControls,
  calculation: Schema.NullOr(TaxCalculation),
  contribution: Schema.NullOr(TaxContribution),
});

export const PrepareTaxSnapshot = Schema.Struct({
  mode: Schema.Literals(["actual_review", "synthetic_demonstration"]),
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
});

export const TaxSnapshot = Schema.Struct({
  schemaVersion: Schema.Literals(["1", "2"]),
  calculationEngine: Schema.Literals(["expense-tax-controls-v1", "expense-tax-controls-v2"]),
  bookProfile: Schema.String,
  bookProfileVersion: Accounting.MinorUnits,
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  input: PrepareTaxSnapshot,
  digest: Accounting.Digest,
  basisDigest: Accounting.Digest,
  recordedAt: Schema.String,
  receipt: CommandReceipt,
  bookSequence: Accounting.MinorUnits,
  currency: Schema.String,
  currencyScale: Schema.Int,
  entries: Schema.Array(
    Schema.Struct({
      source: TaxSourceRevision,
      review: Schema.NullOr(TaxReview),
      withdrawal: Schema.optional(Schema.NullOr(TaxSourceWithdrawal)),
      assessment: TaxAssessment,
    }),
  ),
  includedCount: Schema.Int,
  excludedCount: Schema.Int,
  syntheticTotals: Schema.Struct({
    grossMinor: Accounting.AggregateMinorUnits,
    netMinor: Accounting.AggregateMinorUnits,
    vatMinor: Accounting.AggregateMinorUnits,
    deductibleMinor: Accounting.AggregateMinorUnits,
    nonDeductibleMinor: Accounting.AggregateMinorUnits,
    expenseMinor: Accounting.AggregateMinorUnits,
  }),
  coverageEstablished: Schema.Literal(false),
  ledgerReconciled: Schema.Literal(false),
  vatReturnReady: Schema.Literal(false),
  productionProfileApproved: Schema.Literal(false),
  postingEnabled: Schema.Literal(false),
});

export const TaxSnapshotView = Schema.Struct({
  snapshot: TaxSnapshot,
  basisCurrent: Schema.Boolean,
});

export const TaxInventory = Schema.Struct({
  basisDigest: Accounting.Digest,
  observedAt: Schema.String,
  coverageEstablished: Schema.Literal(false),
  sources: Schema.Array(
    Schema.Struct({
      current: TaxSourceRevision,
      latestReview: Schema.NullOr(TaxReview),
      withdrawal: Schema.NullOr(TaxSourceWithdrawal),
      reviewCurrent: Schema.Boolean,
    }),
  ),
});

const SnapshotCursor = Schema.String.check(
  Schema.isPattern(
    /^(?:[a-f0-9]{16}_[0-9]{1,18}_[0-9]{1,18}|esm1_[a-f0-9]{64}_[0-9]{1,18}_[0-9]{1,18})$/,
  ),
);

export const TaxSnapshotSourceMembership = Schema.Struct({
  schemaVersion: TaxSnapshot.fields.schemaVersion,
  calculationEngine: TaxSnapshot.fields.calculationEngine,
  revisionId: Accounting.Identifier,
  revision: Schema.Int,
  sourceDigest: Accounting.Digest,
  review: Schema.NullOr(
    Schema.Struct({
      id: Accounting.Identifier,
      revision: Schema.Int,
      digest: Accounting.Digest,
      sourceDigest: Accounting.Digest,
    }),
  ),
  withdrawal: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        id: Accounting.Identifier,
        digest: Accounting.Digest,
        revisionId: Accounting.Identifier,
        revisionDigest: Accounting.Digest,
      }),
    ),
  ),
  assessment: TaxAssessment,
});

export const TaxSnapshotPage = Schema.Struct({
  membershipScan: Schema.optional(
    Schema.Struct({
      sourceId: Accounting.Identifier,
      cutoffOrdinal: Accounting.MinorUnits,
      examinedThroughOrdinal: Accounting.MinorUnits,
      examinedCount: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 25 })),
      interpretation: Schema.Literal("retained_source_membership"),
      currentnessChecked: Schema.Literal(false),
      legalObligationAssessed: Schema.Literal(false),
    }),
  ),
  items: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      digest: Accounting.Digest,
      input: PrepareTaxSnapshot,
      recordedAt: Schema.String,
      sourceMembership: Schema.optional(TaxSnapshotSourceMembership),
    }),
  ),
  next: Schema.NullOr(SnapshotCursor),
});

export const TaxAfter = Schema.Struct({
  after: Schema.optional(SnapshotCursor),
  sourceId: Schema.optional(Accounting.Identifier),
});

const path = "/v1/entities/:entityId/books/:bookId/expense-tax";

const scoped = { params: Accounting.Scope, error: accountingErrors };

const identified = { params: Accounting.ChangePath, error: accountingErrors };

const mutation = { ...scoped, headers: Accounting.IdempotencyHeaders };

export const ExpenseTaxApi = HttpApiGroup.make("expenseTax").add(
  HttpApiEndpoint.post("withdrawExpenseTaxSource", `${path}/sources/:id/withdrawals`, {
    ...identified,
    headers: Accounting.IdempotencyHeaders,
    payload: WithdrawTaxSource.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: TaxSourceWithdrawal,
  }),
  HttpApiEndpoint.post("recordExpenseTaxSource", `${path}/sources`, {
    ...mutation,
    payload: RecordTaxSource.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: TaxSourceRevision,
  }),
  HttpApiEndpoint.get("expenseTaxInventory", `${path}/sources`, {
    ...scoped,
    success: TaxInventory,
  }),
  HttpApiEndpoint.get("getExpenseTaxSource", `${path}/sources/:id`, {
    ...identified,
    success: TaxSourceView,
  }),
  HttpApiEndpoint.post("reviewExpenseTaxSource", `${path}/sources/:id/reviews`, {
    ...identified,
    headers: Accounting.IdempotencyHeaders,
    payload: ReviewTaxSource.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: TaxReview,
  }),
  HttpApiEndpoint.post("prepareExpenseTaxSnapshot", `${path}/snapshots`, {
    ...mutation,
    payload: PrepareTaxSnapshot.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: TaxSnapshot,
  }),
  HttpApiEndpoint.get("getExpenseTaxSnapshot", `${path}/snapshots/:id`, {
    ...identified,
    success: TaxSnapshotView,
  }),
  HttpApiEndpoint.get("listExpenseTaxSnapshots", `${path}/snapshots`, {
    ...scoped,
    query: TaxAfter,
    success: TaxSnapshotPage,
  }),
);

const scope = { scope: Accounting.Scope };

const command = {
  ...scope,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};

export const ExpenseTaxCapabilities = {
  expense_tax_record_source: {
    input: Schema.Struct({ ...command, input: RecordTaxSource }),
    output: TaxSourceRevision,
    readOnly: false,
    description:
      "Retain or append scoped expense tax source observations. Unknown values remain null; no invoice issuance, tax activation or posting.",
  },
  expense_tax_inventory: {
    input: Schema.Struct(scope),
    output: TaxInventory,
    readOnly: true,
    description:
      "Read the bounded current expense tax source/reviewer inventory and basis digest. Source completeness is unestablished.",
  },
  expense_tax_get_source: {
    input: Schema.Struct({ ...scope, sourceId: Accounting.Identifier }),
    output: TaxSourceView,
    readOnly: true,
    description:
      "Read immutable expense source/reviewer history and whether the latest operator review covers the current source.",
  },
  expense_tax_prepare_snapshot: {
    input: Schema.Struct({ ...command, input: PrepareTaxSnapshot }),
    output: TaxSnapshot,
    readOnly: false,
    description:
      "Freeze accountant-facing expense tax controls and explicit exclusions. Only the named synthetic exact-arithmetic demonstration may contribute. Never a VAT return or filing.",
  },
  expense_tax_get_snapshot: {
    input: Schema.Struct({ ...scope, snapshotId: Accounting.Identifier }),
    output: TaxSnapshotView,
    readOnly: true,
    description:
      "Recover immutable expense-tax controls, source/reviewer lineage, synthetic totals and current basis freshness.",
  },
  expense_tax_list_snapshots: {
    input: Schema.Struct({ ...scope, ...TaxAfter.fields }),
    output: TaxSnapshotPage,
    readOnly: true,
    description:
      "Page immutable expense snapshot references. Optional exact sourceId returns captured membership from25 examined snapshots per page; empty items can still have next. No currentness check, recalculation or tax-return authority.",
  },
};
