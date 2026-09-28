import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as A from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { ProfileWitness } from "./company-profiles";
import { CommandReceipt } from "./reconciliation";
import { VatFilingRuleRelease, VatReportBox, VatSourceFamily } from "./vat-filing-release";

const MaybeId = Schema.NullOr(A.Identifier);

export const ExpenseLink = Schema.Struct({
  sourceId: A.Identifier,
  sourceDigest: A.Digest,
  reviewDigest: A.Digest,
});

export const VatFactInput = Schema.Struct({
  sourceKey: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/)),
  expectedDigest: Schema.NullOr(A.Digest),
  recordClass: Schema.Literals(["actual_company", "synthetic"]),
  evidenceId: A.Identifier,
  sourceLocator: A.Description,
  description: A.Description,
  reviewEvidenceId: A.Identifier,
  reviewRationale: A.Description,
  treatment: Schema.Literals(["unknown", "domestic_sale", "domestic_purchase", "unsupported"]),
  netMinor: A.MinorUnits,
  vatMinor: A.MinorUnits,
  grossMinor: A.MinorUnits,
  currency: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/))),
  issuedOn: Schema.NullOr(A.AccountingDate),
  receivedOn: Schema.NullOr(A.AccountingDate),
  suppliedOn: Schema.NullOr(A.AccountingDate),
  taxPointOn: Schema.NullOr(A.AccountingDate),
  dateBasis: Schema.NullOr(A.Description),
  periodEvidenceId: MaybeId,
  registration: Schema.Literals(["unknown", "registered", "not_registered"]),
  registrationEvidenceId: MaybeId,
  method: Schema.Literals(["unknown", "accrual", "cash"]),
  methodEvidenceId: MaybeId,
  domesticEligibility: Schema.Literals(["unknown", "confirmed", "unsupported"]),
  treatmentEvidenceId: MaybeId,
  fullDeduction: Schema.Literals(["unknown", "confirmed", "unsupported"]),
  deductionEvidenceId: MaybeId,
  voucherId: MaybeId,
  taxLineIds: Schema.Array(A.Identifier).check(Schema.isMaxLength(20)),
  expenseLink: Schema.NullOr(ExpenseLink),
});

export const VatFact = Schema.Struct({
  id: A.Identifier,
  factId: A.Identifier,
  revision: Schema.Int,
  digest: A.Digest,
  previousDigest: Schema.NullOr(A.Digest),
  scope: A.Scope,
  input: VatFactInput,
  recordedAt: Schema.String,
  receipt: CommandReceipt,
  evidenceRefs: Schema.Array(Schema.Struct({ evidenceId: A.Identifier, sha256: Schema.String })),
  expenseSourceDigest: Schema.NullOr(A.Digest),
  expenseReviewDigest: Schema.NullOr(A.Digest),
});

export const WithdrawVatFact = Schema.Struct({
  expectedDigest: A.Digest,
  evidenceId: A.Identifier,
  rationale: A.Description,
});

export const VatFactWithdrawal = Schema.Struct({
  id: A.Identifier,
  digest: A.Digest,
  scope: A.Scope,
  factId: A.Identifier,
  revisionId: A.Identifier,
  revision: Schema.Int,
  revisionDigest: A.Digest,
  input: WithdrawVatFact,
  evidenceSha256: Schema.String,
  recordedAt: Schema.String,
  receipt: CommandReceipt,
  permanent: Schema.Literal(true),
});

export const VatFactObservation = Schema.Struct({
  // Saved v1/v2 bases predate expense-source withdrawal.
  expenseSourceWithdrawn: Schema.optional(Schema.Boolean),
  // Saved v1 bases predate withdrawal metadata. New live bases always include this field.
  withdrawal: Schema.optional(Schema.NullOr(VatFactWithdrawal)),
  fact: VatFact,
  expenseLinkCurrent: Schema.Boolean,
  voucherReversed: Schema.Boolean,
  voucherPostingDate: Schema.NullOr(A.AccountingDate),
  taxLines: Schema.Array(
    Schema.Struct({
      id: A.Identifier,
      accountId: A.Identifier,
      debitMinor: A.MinorUnits,
      creditMinor: A.MinorUnits,
    }),
  ),
});

export const VatBasis = Schema.Struct({
  digest: A.Digest,
  bookSequence: A.MinorUnits,
  bookProfile: Schema.String,
  bookProfileVersion: A.MinorUnits,
  currency: Schema.String,
  currencyScale: Schema.Int,
  facts: Schema.Array(VatFactObservation),
});

export const PrepareVatDraft = Schema.Struct({
  mode: Schema.Literals(["actual_review", "synthetic_demonstration"]),
  startsOn: A.AccountingDate,
  endsOn: A.AccountingDate,
  periodEvidenceId: MaybeId,
  otherBoxes: Schema.Literals(["unknown", "absent_in_synthetic_example"]),
});

export const VatBlocker = Schema.Literals([
  "withdrawn_expense_source",
  "withdrawn_fact",
  "actual_profile_unapproved",
  "wrong_record_class",
  "unsupported_book",
  "unsupported_treatment",
  "currency_unsupported",
  "missing_dates",
  "outside_period",
  "registration_unestablished",
  "method_unestablished",
  "domestic_unestablished",
  "deduction_unestablished",
  "period_unestablished",
  "source_amount_difference",
  "rate_difference",
  "missing_ledger_link",
  "reversed_voucher",
  "ledger_tax_difference",
  "stale_expense_review",
  "duplicate_source_component",
  "overlapping_tax_lines",
]);

export const VatContribution = Schema.Struct({
  box05Minor: A.AggregateMinorUnits,
  box10Minor: A.AggregateMinorUnits,
  box48Minor: A.AggregateMinorUnits,
});

export const VatAssessment = Schema.Struct({
  factId: A.Identifier,
  sourceDigest: A.Digest,
  state: Schema.Literals(["included_synthetic", "excluded"]),
  blockers: Schema.Array(VatBlocker),
  sourceDifferenceMinor: A.SignedMinorUnits,
  rateDifferenceNumerator: A.SignedMinorUnits,
  ledgerTaxMinor: Schema.NullOr(A.SignedMinorUnits),
  ledgerDifferenceMinor: Schema.NullOr(A.SignedMinorUnits),
  contribution: Schema.NullOr(VatContribution),
});

export const VatBox = Schema.Struct({
  exactMinor: A.SignedMinorUnits,
  reportedKrona: Schema.NullOr(A.SignedMinorUnits),
  residualMinor: Schema.NullOr(A.SignedMinorUnits),
});

export const VatCalculation = Schema.Struct({
  engine: Schema.Literals(["vat-return-draft-v1", "vat-return-draft-v2", "vat-return-draft-v3"]),
  assessments: Schema.Array(VatAssessment),
  includedCount: Schema.Int,
  excludedCount: Schema.Int,
  syntheticBoxes: Schema.NullOr(
    Schema.Struct({ box05: VatBox, box10: VatBox, box48: VatBox, box49: Schema.NullOr(VatBox) }),
  ),
  blockers: Schema.Array(
    Schema.Literals([
      "legal_profile_unapproved",
      "coverage_unestablished",
      "ledger_reconciliation_unavailable",
      "other_boxes_unknown",
      "period_registration_unverified",
      "fractional_box05",
      "no_included_facts",
      "excluded_facts",
    ]),
  ),
  coverageEstablished: Schema.Literal(false),
  ledgerReconciled: Schema.Literal(false),
  legalProfileActive: Schema.Literal(false),
  filingReady: Schema.Literal(false),
});

export const VatDraft = Schema.Struct({
  id: A.Identifier,
  digest: A.Digest,
  scope: A.Scope,
  input: PrepareVatDraft,
  basis: VatBasis,
  calculation: VatCalculation,
  recordedAt: Schema.String,
  receipt: CommandReceipt,
  periodEvidenceSha256: Schema.NullOr(Schema.String),
});

export const VatDraftView = Schema.Struct({ draft: VatDraft, basisCurrent: Schema.Boolean });

export const VatDraftList = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      id: A.Identifier,
      digest: A.Digest,
      input: PrepareVatDraft,
      recordedAt: Schema.String,
    }),
  ),
});

export const CompareVatDrafts = Schema.Struct({
  originalDraftId: A.Identifier,
  originalDraftDigest: A.Digest,
  replacementDraftId: A.Identifier,
  replacementDraftDigest: A.Digest,
});

const VatDraftReference = Schema.Struct({
  id: A.Identifier,
  digest: A.Digest,
  basisDigest: A.Digest,
  engine: VatCalculation.fields.engine,
  input: PrepareVatDraft,
  bookSequence: A.MinorUnits,
  bookProfile: Schema.String,
  bookProfileVersion: A.MinorUnits,
  currency: Schema.String,
  currencyScale: Schema.Int,
  blockers: VatCalculation.fields.blockers,
});

const VatFactImpactSide = Schema.Struct({
  revisionId: A.Identifier,
  revision: Schema.Int,
  assessment: VatAssessment,
});

const VatFactImpact = Schema.Struct({
  factId: A.Identifier,
  original: Schema.NullOr(VatFactImpactSide),
  replacement: Schema.NullOr(VatFactImpactSide),
  sourceChanged: Schema.Boolean,
  assessmentChanged: Schema.Boolean,
  contributionDelta: Schema.Struct({
    box05Minor: A.SignedMinorUnits,
    box10Minor: A.SignedMinorUnits,
    box48Minor: A.SignedMinorUnits,
  }),
});

export const VatDraftImpact = Schema.Struct({
  digest: A.Digest,
  version: Schema.Literal("vat-draft-impact-v1"),
  scope: A.Scope,
  original: VatDraftReference,
  replacement: VatDraftReference,
  facts: Schema.Array(VatFactImpact),
  boxes: Schema.Array(
    Schema.Struct({
      box: Schema.Literals(["box05", "box10", "box48", "box49"]),
      original: Schema.NullOr(VatBox),
      replacement: Schema.NullOr(VatBox),
      exactDeltaMinor: Schema.NullOr(A.SignedMinorUnits),
      reportedDeltaKrona: Schema.NullOr(A.SignedMinorUnits),
      residualDeltaMinor: Schema.NullOr(A.SignedMinorUnits),
    }),
  ),
  filingReady: Schema.Literal(false),
  externalState: Schema.Literal("not_submitted"),
});

export const VatFactLineage = Schema.Struct({
  interpretation: Schema.Literal("retained_fact_membership"),
  currentnessChecked: Schema.Literal(false),
  legalObligationAssessed: Schema.Literal(false),
  drafts: Schema.Array(
    Schema.Struct({
      draftId: A.Identifier,
      draftDigest: A.Digest,
      engine: VatCalculation.fields.engine,
      startsOn: A.AccountingDate,
      endsOn: A.AccountingDate,
      recordedAt: Schema.String,
      revisionId: A.Identifier,
      revision: Schema.Int,
      sourceDigest: A.Digest,
      assessment: VatAssessment,
    }),
  ).check(Schema.isMaxLength(500)),
  amendments: Schema.Array(
    Schema.Struct({
      amendmentId: A.Identifier,
      amendmentDigest: A.Digest,
      recordedAt: Schema.String,
      originalDraftId: A.Identifier,
      originalDraftDigest: A.Digest,
      replacementDraftId: A.Identifier,
      replacementDraftDigest: A.Digest,
      impactDigest: A.Digest,
      factImpact: VatFactImpact,
    }),
  ).check(Schema.isMaxLength(500)),
});

export const VatFactView = Schema.Struct({
  current: VatFact,
  history: Schema.Array(VatFact),
  withdrawal: Schema.NullOr(VatFactWithdrawal),
  lineage: VatFactLineage,
});

export const VatDraftImpactView = Schema.Struct({
  impact: VatDraftImpact,
  replacementBasisCurrent: Schema.Boolean,
});

export const ReviewVatAmendment = Schema.Struct({
  ...CompareVatDrafts.fields,
  expectedImpactDigest: A.Digest,
  reviewEvidenceId: A.Identifier,
  rationale: A.Description,
});

export const VatAmendment = Schema.Struct({
  id: A.Identifier,
  digest: A.Digest,
  scope: A.Scope,
  input: ReviewVatAmendment,
  impact: VatDraftImpact,
  reviewEvidenceSha256: Schema.String,
  recordedAt: Schema.String,
  receipt: CommandReceipt,
  state: Schema.Literal("reviewed_internal_amendment"),
  filingReady: Schema.Literal(false),
  externalState: Schema.Literal("not_submitted"),
});

export const VatAmendmentView = Schema.Struct({
  amendment: VatAmendment,
  originalDraft: VatDraft,
  replacementDraft: VatDraft,
  replacementBasisCurrent: Schema.Boolean,
});

export const VatAmendmentList = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      id: A.Identifier,
      digest: A.Digest,
      originalDraftId: A.Identifier,
      replacementDraftId: A.Identifier,
      recordedAt: Schema.String,
    }),
  ),
});

export const VatControlAccountRole = Schema.Literals([
  "output_vat_control",
  "input_vat_control",
  "vat_settlement_control",
]);

export const PrepareVatControlReclassification = Schema.Struct({
  profile: Schema.Literal("vat_control_reclassification_v1"),
  draftId: A.Identifier,
  expectedDraftDigest: A.Digest,
  outputAccountId: A.Identifier,
  inputAccountId: A.Identifier,
  settlementAccountId: A.Identifier,
  roleEvidenceId: A.Identifier,
  reviewEvidenceId: A.Identifier,
  accountingPeriodId: A.Identifier,
  postingDate: A.AccountingDate,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  rationale: A.Description,
  acknowledgeSyntheticOnly: Schema.Literal(true),
});

export const ApproveVatControlReclassification = Schema.Struct({
  expectedReviewDigest: A.Digest,
  acknowledgeSyntheticOnly: Schema.Literal(true),
});

export const ExecuteVatControlReclassification = Schema.Struct({
  ...ApproveVatControlReclassification.fields,
  approvalId: A.Identifier,
});

export const VatControlProfile = Schema.Struct({
  id: A.Identifier,
  profile: Schema.Literal("vat_control_reclassification_v1"),
  profileVersion: A.MinorUnits,
  jurisdiction: Schema.Literal("SE"),
  scheme: Schema.Literal("synthetic_output_input_v1"),
  evidenceSha256: Schema.String,
  digest: A.Digest,
});

export const VatReportingObligation = Schema.Struct({
  id: A.Identifier,
  registrationNamespace: Schema.Literal("synthetic"),
  registrationId: A.Identifier,
  jurisdiction: Schema.Literal("SE"),
  scheme: Schema.Literal("synthetic_output_input_v1"),
  startsOn: A.AccountingDate,
  endsOn: A.AccountingDate,
  periodEvidenceId: Schema.NullOr(A.Identifier),
  digest: A.Digest,
});

export const VatControlAccountRoleBinding = Schema.Struct({
  role: VatControlAccountRole,
  accountId: A.Identifier,
  accountVersion: A.MinorUnits,
  code: Schema.String,
  name: Schema.String,
  active: Schema.Boolean,
});

export const VatControlContribution = Schema.Struct({
  factId: A.Identifier,
  factRevisionId: A.Identifier,
  factRevision: Schema.Int,
  factDigest: A.Digest,
  voucherId: A.Identifier,
  lineId: A.Identifier,
  role: Schema.Literals(["output_vat_control", "input_vat_control"]),
  accountId: A.Identifier,
  accountVersion: A.MinorUnits,
  debitMinor: A.MinorUnits,
  creditMinor: A.MinorUnits,
  balanceMinor: A.SignedMinorUnits,
});

export const VatControlPostingLine = Schema.Struct({
  lineId: A.Identifier,
  ...A.JournalLine.fields,
});

export const VatControlReclassificationAmounts = Schema.Struct({
  outputTaxMinor: A.MinorUnits,
  deductibleInputTaxMinor: A.MinorUnits,
  accountingNetMinor: A.SignedMinorUnits,
  reportedNetKrona: A.SignedMinorUnits,
  reportedResidualMinor: A.SignedMinorUnits,
  assessedMinor: Schema.Null,
});

export const VatControlReclassificationBasis = Schema.Struct({
  profile: VatControlProfile,
  obligation: VatReportingObligation,
  draft: Schema.Struct({
    id: A.Identifier,
    digest: A.Digest,
    basisDigest: A.Digest,
    engine: Schema.Literal("vat-return-draft-v3"),
    startsOn: A.AccountingDate,
    endsOn: A.AccountingDate,
  }),
  amounts: VatControlReclassificationAmounts,
  accountRoles: Schema.Array(VatControlAccountRoleBinding).check(
    Schema.isMinLength(3),
    Schema.isMaxLength(3),
  ),
  contributions: Schema.Array(VatControlContribution).check(Schema.isMaxLength(500)),
  period: Schema.Struct({ id: A.Identifier, version: A.MinorUnits }),
  roleEvidenceSha256: Schema.String,
  reviewEvidenceSha256: Schema.String,
  postingLines: Schema.Array(VatControlPostingLine).check(Schema.isMaxLength(500)),
  currentFactDigest: A.Digest,
  dependencyDigest: A.Digest,
  coverage: Schema.Literal("not_established"),
  legalProfileActive: Schema.Literal(false),
  taxAccountMatched: Schema.Literal(false),
});

export const VatControlReclassificationReview = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  version: Schema.Literal(1),
  ordinal: Schema.Int,
  state: Schema.Literal("prepared"),
  input: PrepareVatControlReclassification,
  basis: VatControlReclassificationBasis,
  postingPlan: Schema.NullOr(A.ChangeSet),
  requiresOperatorApproval: Schema.Literal(true),
  assessmentEffect: Schema.Literal("none"),
  cashTransferEffect: Schema.Literal("none"),
  filingReady: Schema.Literal(false),
  externalState: Schema.Literal("not_submitted"),
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: A.Digest,
});

export const VatControlReclassificationApproval = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  version: Schema.Literal(1),
  reviewId: A.Identifier,
  reviewDigest: A.Digest,
  actorId: A.Identifier,
  expiresAt: Schema.String,
  kernelApproval: Schema.NullOr(A.Approval),
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: A.Digest,
});

export const VatControlReclassificationEffect = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  version: Schema.Literal(1),
  obligationId: A.Identifier,
  draftId: A.Identifier,
  reviewId: A.Identifier,
  reviewDigest: A.Digest,
  approvalId: A.Identifier,
  outcome: Schema.Literals(["posted", "no_effect"]),
  amounts: VatControlReclassificationAmounts,
  changeSetId: Schema.NullOr(A.Identifier),
  voucherId: Schema.NullOr(A.Identifier),
  postingReceipt: Schema.NullOr(A.ExecutionReceipt),
  postingDate: A.AccountingDate,
  assessmentEffect: Schema.Literal("none"),
  cashTransferEffect: Schema.Literal("none"),
  filingReady: Schema.Literal(false),
  externalState: Schema.Literal("not_submitted"),
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: A.Digest,
});

export const VatControlReclassificationView = Schema.Struct({
  review: VatControlReclassificationReview,
  approvals: Schema.Array(VatControlReclassificationApproval).check(Schema.isMaxLength(20)),
  reclassification: Schema.NullOr(VatControlReclassificationEffect),
  liveBasisCheckedAt: Schema.NullOr(Schema.String),
});

export const VatControlReclassificationList = Schema.Struct({
  scope: A.Scope,
  items: Schema.Array(
    Schema.Struct({
      reviewId: A.Identifier,
      reviewDigest: A.Digest,
      obligationId: A.Identifier,
      draftId: A.Identifier,
      startsOn: A.AccountingDate,
      endsOn: A.AccountingDate,
      accountingNetMinor: A.SignedMinorUnits,
      state: Schema.Literals(["prepared", "approved", "posted", "no_effect"]),
      reclassificationId: Schema.NullOr(A.Identifier),
      recordedAt: Schema.String,
    }),
  ),
});

export const VatControlReclassificationCommandResult = Schema.Union([
  VatControlReclassificationReview,
  VatControlReclassificationApproval,
  VatControlReclassificationEffect,
]);

export const VatControlReclassificationRecovery = Schema.Struct({
  state: Schema.Literal("committed"),
  result: VatControlReclassificationCommandResult,
});

// The actual domestic VAT return. It calculates exact, reported and residual
// amounts and reconciles every VAT control. It never carries a submitted,
// assessed or paid state.

export const VatFactOrigin = Schema.Literals([
  "manual_admission",
  "owned_purchase_recognition",
  "owned_owner_purchase",
  "owned_customer_credit",
  "owned_service_purchase",
]);

export const VatRegisteredPeriod = Schema.Struct({
  factRevisionId: A.Identifier,
  factRevisionDigest: A.Digest,
  startsOn: A.AccountingDate,
  endsOn: A.AccountingDate,
  periodEvidenceId: A.Identifier,
  periodEvidenceSha256: Schema.String,
});

export const VatFactControlComponent = Schema.Struct({
  voucherId: A.Identifier,
  lineId: A.Identifier,
  accountId: A.Identifier,
  role: VatControlAccountRole,
  signedMinor: A.SignedMinorUnits,
  postingDate: A.AccountingDate,
  withinControlInterval: Schema.Boolean,
});

export const VatTreatment = Schema.Literals([
  "domestic_sale",
  "domestic_purchase",
  "service_reverse_charge_eu",
  "service_reverse_charge_non_eu",
]);

export const VatFactObservationState = Schema.Struct({
  recordClass: Schema.Literals(["actual_company", "synthetic"]),
  treatment: Schema.NullOr(VatTreatment),
  withdrawn: Schema.Boolean,
  voucherReversed: Schema.Boolean,
  withinLedgerBoundary: Schema.Boolean,
});

// The reverse-charge detail a general-rule service selection carries. Null for
// every domestic fact, so earlier sealed captures remain readable.
export const ServiceReverseChargeDetail = Schema.Struct({
  rateId: A.Identifier,
  jurisdictionClass: Schema.Literals(["EU_OTHER", "NON_EU"]),
  basisBox: Schema.Literals(["21", "22"]),
  outputBox: Schema.Literals(["30", "31", "32"]),
  deductibleMinor: A.SignedMinorUnits,
});

export const VatSelectedFact = Schema.Struct({
  factId: A.Identifier,
  origin: VatFactOrigin,
  revisionId: A.Identifier,
  digest: A.Digest,
  treatment: Schema.NullOr(VatTreatment),
  taxPointOn: A.AccountingDate,
  voucherId: A.Identifier,
  basisMinor: A.SignedMinorUnits,
  taxMinor: A.SignedMinorUnits,
  // Optional only so earlier sealed captures remain readable; new captures retain
  // signed source tax independently of the amount deductible in this return.
  sourceTaxMinor: Schema.optional(A.SignedMinorUnits),
  adjustsFactId: Schema.NullOr(A.Identifier),
  ruleReleaseId: Schema.NullOr(A.Identifier),
  serviceDetail: Schema.NullOr(ServiceReverseChargeDetail),
  observation: VatFactObservationState,
  controlComponents: Schema.Array(VatFactControlComponent).check(Schema.isMaxLength(20)),
});

export const VatControlMovementRow = Schema.Struct({
  voucherId: A.Identifier,
  lineId: A.Identifier,
  postingDate: A.AccountingDate,
  signedMinor: A.SignedMinorUnits,
  postingPurpose: Schema.String,
});

export const VatControlSnapshot = Schema.Struct({
  role: VatControlAccountRole,
  accountId: A.Identifier,
  reviewedOpeningMinor: A.SignedMinorUnits,
  frozenGlOpeningMinor: A.SignedMinorUnits,
  frozenGlMovementMinor: A.SignedMinorUnits,
  frozenGlClosingMinor: A.SignedMinorUnits,
  movements: Schema.Array(VatControlMovementRow).check(Schema.isMaxLength(500)),
});

// A released owner effect that moved a VAT control inside the control interval,
// read through its own committed records. This packet never reclassifies.
export const VatOwnedControlEffect = Schema.Struct({
  owner: Schema.Literal("control_reclassification"),
  effectId: A.Identifier,
  obligationId: A.Identifier,
  voucherId: A.Identifier,
  postingDate: A.AccountingDate,
  controlComponents: Schema.Array(VatFactControlComponent).check(Schema.isMaxLength(20)),
});

export const VatSourceCoverageState = Schema.Struct({
  family: VatSourceFamily,
  state: Schema.Literals(["current", "unavailable", "unknown"]),
  evidenceId: Schema.NullOr(A.Identifier),
  evidenceSha256: Schema.NullOr(Schema.String),
});

export const VatActualPopulation = Schema.Struct({
  bookAdmittedFactCount: Schema.Int,
  bookPurchaseComponentCount: Schema.Int,
  selectedAdmittedFactCount: Schema.Int,
  selectedPurchaseComponentCount: Schema.Int,
  // Optional for saved captures that predate these native producers.
  bookOwnerPurchaseComponentCount: Schema.optional(Schema.Int),
  selectedOwnerPurchaseComponentCount: Schema.optional(Schema.Int),
  bookCustomerCreditComponentCount: Schema.optional(Schema.Int),
  selectedCustomerCreditComponentCount: Schema.optional(Schema.Int),
  // Optional for saved captures that predate the service-purchase owner.
  bookServiceComponentCount: Schema.optional(Schema.Int),
  selectedServiceComponentCount: Schema.optional(Schema.Int),
  // A manually admitted fact with no tax point belongs to no period at all, so
  // the population is not completely classified until it is resolved.
  withoutTaxPoint: Schema.Int,
  membershipEpoch: A.MinorUnits,
});

// A reserved owner's committed inventory, read through its own released
// records. `no_committed_financial_effect` states that the owner exposes no
// per-account vector to read, which is a retained fact and never a computed
// zero over a port this packet could not see.
export const VatOwnerPortState = Schema.Struct({
  owner: Schema.Literals([
    "vat_control_reclassification",
    "vat_draft_amendment",
    "owner_paid_purchase",
    "customer_credit",
  ]),
  state: Schema.Literals(["read_committed_records", "no_committed_financial_effect"]),
  recordCount: Schema.Int,
  recordDigests: Schema.Array(A.Digest).check(Schema.isMaxLength(500)),
});

export const VatActualBasis = Schema.Struct({
  digest: A.Digest,
  scope: A.Scope,
  engine: Schema.Literal("vat-actual-return-v1"),
  bookProfile: Schema.String,
  currency: Schema.String,
  currencyScale: Schema.Int,
  ledgerBoundary: A.MinorUnits,
  recordedCutoff: Schema.String,
  registeredPeriod: VatRegisteredPeriod,
  profileWitness: ProfileWitness,
  mappingRelease: Schema.Struct({
    releaseId: A.Identifier,
    checksum: A.Digest,
    vat: VatFilingRuleRelease,
  }),
  accountRoles: Schema.Array(VatControlAccountRoleBinding).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(8),
  ),
  population: VatActualPopulation,
  // The owned purchase recognitions that published a captured component. A
  // later recognition is a new dependency, not an edit to this one.
  recognitions: Schema.Array(A.Identifier).check(Schema.isMaxLength(500)),
  facts: Schema.Array(VatSelectedFact).check(Schema.isMaxLength(500)),
  controls: Schema.Array(VatControlSnapshot).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
  ownedEffects: Schema.Array(VatOwnedControlEffect).check(Schema.isMaxLength(200)),
  sourceCoverage: Schema.Array(VatSourceCoverageState).check(Schema.isMaxLength(20)),
  ownerPorts: Schema.Array(VatOwnerPortState).check(Schema.isMaxLength(8)),
  openingEvidenceId: A.Identifier,
  openingEvidenceSha256: Schema.String,
});

export const VatActualBox = Schema.Struct({
  box: Schema.Literals(["05", "10", "11", "12", "21", "22", "30", "31", "32", "48", "49"]),
  kind: Schema.Literals(["primitive", "net"]),
  exactMinor: A.SignedMinorUnits,
  reportedMinor: A.SignedMinorUnits,
  residualMinor: A.SignedMinorUnits,
});

export const VatActualContribution = Schema.Struct({
  ordinal: Schema.Int,
  factId: A.Identifier,
  origin: VatFactOrigin,
  mappingRuleId: A.Identifier,
  rateId: A.Identifier,
  box: VatReportBox,
  signedMinor: A.SignedMinorUnits,
  basisMinor: A.SignedMinorUnits,
  taxMinor: A.SignedMinorUnits,
  revisionId: A.Identifier,
  digest: A.Digest,
});

export const VatActualExclusionReason = Schema.Literals([
  "synthetic_record_class",
  "unsupported_treatment",
  "unmapped_treatment",
  "rate_absent_from_release",
  "published_tax_not_the_qualified_rate",
  "basis_box_absent_from_release",
  "withdrawn_fact",
  "duplicate_source_component",
  "unlinked_control_component",
  "voucher_reversed",
  "voucher_outside_ledger_boundary",
  "rule_release_mismatch",
]);

export const VatActualExclusion = Schema.Struct({
  ordinal: Schema.Int,
  factId: A.Identifier,
  origin: VatFactOrigin,
  revisionId: A.Identifier,
  reason: VatActualExclusionReason,
  detail: A.Description,
});

export const VatControlRowDifference = Schema.Struct({
  state: Schema.Literals(["unexplained", "missing"]),
  voucherId: A.Identifier,
  lineId: A.Identifier,
  postingDate: A.AccountingDate,
  signedMinor: A.SignedMinorUnits,
});

export const VatControlReconciliation = Schema.Struct({
  role: VatControlAccountRole,
  accountId: A.Identifier,
  reviewedOpeningMinor: A.SignedMinorUnits,
  expectedClosingMinor: A.SignedMinorUnits,
  frozenGlClosingMinor: A.SignedMinorUnits,
  differenceMinor: A.SignedMinorUnits,
  unexplainedRows: Schema.Array(VatControlRowDifference).check(Schema.isMaxLength(500)),
  missingRows: Schema.Array(VatControlRowDifference).check(Schema.isMaxLength(500)),
  reconciled: Schema.Boolean,
});

export const VatTimingBridgeRow = Schema.Struct({
  factId: A.Identifier,
  origin: VatFactOrigin,
  revisionId: A.Identifier,
  taxPointOn: A.AccountingDate,
  reason: Schema.Literals(["control_component_outside_interval", "opening_balance_component"]),
  componentPostingDates: Schema.Array(A.AccountingDate).check(Schema.isMaxLength(20)),
});

// A readiness reason inside a retained calculation. A release that cannot apply
// at all is a refusal at capture, not a blocker here.
export const VatActualBlocker = Schema.Literals([
  "no_supported_mapping_for_treatment",
  "rate_absent_from_release",
  "rule_release_mismatch",
  "excluded_mandatory_fact",
  "unclassified_fact_population",
  "source_coverage_unavailable",
  "source_coverage_unknown",
  "control_unexplained_rows",
  "control_missing_rows",
  "control_opening_difference",
  "control_component_conflict",
]);

export const VatMonetaryRelease = Schema.Struct({
  releaseId: A.Identifier,
  manifestDigest: A.Digest,
  artifactDigest: A.Digest,
  sourceTreeDigest: A.Digest,
  runtimeId: Schema.String,
});

export const VatActualCalculation = Schema.Struct({
  engine: Schema.Literal("vat-actual-return-v1"),
  basisDigest: A.Digest,
  monetaryRelease: Schema.optional(VatMonetaryRelease),
  // A population the release could not map declares no box at all. An absent net
  // box is the honest result; a zero net over a partial population is not.
  // Ten primitive boxes plus the net is the bound once reverse charge joins.
  boxes: Schema.Array(VatActualBox).check(Schema.isMaxLength(12)),
  contributions: Schema.Array(VatActualContribution).check(Schema.isMaxLength(1000)),
  exclusions: Schema.Array(VatActualExclusion).check(Schema.isMaxLength(1000)),
  controls: Schema.Array(VatControlReconciliation).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(8),
  ),
  timingBridge: Schema.Array(VatTimingBridgeRow).check(Schema.isMaxLength(1000)),
  sourceCoverage: Schema.Array(VatSourceCoverageState).check(Schema.isMaxLength(20)),
  blockers: Schema.Array(VatActualBlocker).check(Schema.isMaxLength(20)),
  // Facts assessed, facts declared and facts excluded are three different
  // counts. A fact can be assessed and declared with no primitive row when its
  // qualified amount is exactly zero.
  assessedCount: Schema.Int,
  includedCount: Schema.Int,
  excludedCount: Schema.Int,
  calculationSupported: Schema.Boolean,
  coverageComplete: Schema.Boolean,
  controlsReconciled: Schema.Boolean,
  periodVerified: Schema.Boolean,
  filingReady: Schema.Boolean,
});

// A reviewed opening balance per bound VAT control account, and the independent
// coverage evidence per required source family. Both are qualified inputs the
// caller must state; neither is ever defaulted here.
export const VatControlOpeningInput = Schema.Struct({
  accountId: A.Identifier,
  signedMinor: A.SignedMinorUnits,
});

export const VatSourceCoverageInput = Schema.Struct({
  family: VatSourceFamily,
  state: Schema.Literals(["current", "unavailable", "unknown"]),
  evidenceId: Schema.NullOr(A.Identifier),
});

export const PrepareActualVatReturn = Schema.Struct({
  startsOn: A.AccountingDate,
  endsOn: A.AccountingDate,
  periodEvidenceId: A.Identifier,
  openingEvidenceId: A.Identifier,
  controlOpenings: Schema.Array(VatControlOpeningInput).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(8),
  ),
  sourceCoverage: Schema.Array(VatSourceCoverageInput).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(4),
  ),
  rationale: A.Description,
});

export const ActualVatReturn = Schema.Struct({
  id: A.Identifier,
  digest: A.Digest,
  scope: A.Scope,
  version: Schema.Literal(1),
  input: PrepareActualVatReturn,
  basis: VatActualBasis,
  calculation: VatActualCalculation,
  recordedAt: Schema.String,
  receipt: CommandReceipt,
  externalState: Schema.Literal("not_submitted"),
  assessedMinor: Schema.Null,
  paymentState: Schema.Literal("not_paid"),
});

export const ActualVatReturnView = Schema.Struct({
  saved: ActualVatReturn,
  currentness: Schema.Struct({
    basisCurrent: Schema.Boolean,
    checkedAt: Schema.String,
    staleReasons: Schema.Array(Schema.String).check(Schema.isMaxLength(20)),
  }),
});

export const ActualVatReturnList = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      id: A.Identifier,
      digest: A.Digest,
      startsOn: A.AccountingDate,
      endsOn: A.AccountingDate,
      filingReady: Schema.Boolean,
      exactNetMinor: A.SignedMinorUnits,
      reportedNetMinor: A.SignedMinorUnits,
      recordedAt: Schema.String,
    }),
  ),
});

export const PrepareActualVatCommand = Schema.Struct({
  scope: A.Scope,
  idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
  input: PrepareActualVatReturn,
});

const path = "/v1/entities/:entityId/books/:bookId/vat-returns";

const scoped = { params: A.Scope, error: accountingErrors };

const identified = { params: A.ChangePath, error: accountingErrors };

export const VatReturnsApi = HttpApiGroup.make("vatReturns").add(
  HttpApiEndpoint.post("prepareVatControlReclassification", `${path}/reclassifications`, {
    ...scoped,
    headers: A.IdempotencyHeaders,
    payload: PrepareVatControlReclassification.annotate({
      parseOptions: { onExcessProperty: "error" },
    }),
    success: VatControlReclassificationReview,
  }),
  HttpApiEndpoint.post(
    "approveVatControlReclassification",
    `${path}/reclassifications/:id/approval`,
    {
      ...identified,
      headers: A.IdempotencyHeaders,
      payload: ApproveVatControlReclassification.annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
      success: VatControlReclassificationApproval,
    },
  ),
  HttpApiEndpoint.post(
    "executeVatControlReclassification",
    `${path}/reclassifications/:id/execution`,
    {
      ...identified,
      headers: A.IdempotencyHeaders,
      payload: ExecuteVatControlReclassification.annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
      success: VatControlReclassificationEffect,
    },
  ),
  HttpApiEndpoint.get(
    "recoverVatControlReclassification",
    `${path}/reclassifications/requests/:key`,
    {
      params: Schema.Struct({
        ...A.Scope.fields,
        key: A.IdempotencyHeaders.fields["idempotency-key"],
      }),
      error: accountingErrors,
      success: VatControlReclassificationRecovery,
    },
  ),
  HttpApiEndpoint.get("getVatControlReclassification", `${path}/reclassifications/:id`, {
    ...identified,
    success: VatControlReclassificationView,
  }),
  HttpApiEndpoint.get("listVatControlReclassifications", `${path}/reclassifications`, {
    ...scoped,
    success: VatControlReclassificationList,
  }),
  HttpApiEndpoint.post("withdrawVatFact", `${path}/facts/:id/withdrawal`, {
    ...identified,
    headers: A.IdempotencyHeaders,
    payload: WithdrawVatFact.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: VatFactWithdrawal,
  }),
  HttpApiEndpoint.post("compareVatDrafts", `${path}/amendments/compare`, {
    ...scoped,
    payload: CompareVatDrafts.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: VatDraftImpactView,
  }),
  HttpApiEndpoint.post("reviewVatAmendment", `${path}/amendments`, {
    ...scoped,
    headers: A.IdempotencyHeaders,
    payload: ReviewVatAmendment.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: VatAmendment,
  }),
  HttpApiEndpoint.get("getVatAmendment", `${path}/amendments/:id`, {
    ...identified,
    success: VatAmendmentView,
  }),
  HttpApiEndpoint.get("listVatAmendments", `${path}/amendments`, {
    ...scoped,
    success: VatAmendmentList,
  }),
  HttpApiEndpoint.post("recordVatFact", `${path}/facts`, {
    ...scoped,
    headers: A.IdempotencyHeaders,
    payload: VatFactInput.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: VatFact,
  }),
  HttpApiEndpoint.get("vatReturnBasis", `${path}/facts`, { ...scoped, success: VatBasis }),
  HttpApiEndpoint.get("getVatFact", `${path}/facts/:id`, { ...identified, success: VatFactView }),
  HttpApiEndpoint.post("prepareVatDraft", `${path}/drafts`, {
    ...scoped,
    headers: A.IdempotencyHeaders,
    payload: PrepareVatDraft.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: VatDraft,
  }),
  HttpApiEndpoint.get("getVatDraft", `${path}/drafts/:id`, {
    ...identified,
    success: VatDraftView,
  }),
  HttpApiEndpoint.get("listVatDrafts", `${path}/drafts`, { ...scoped, success: VatDraftList }),
  HttpApiEndpoint.post("prepareActualVatReturn", `${path}/actuals`, {
    ...scoped,
    headers: A.IdempotencyHeaders,
    payload: PrepareActualVatReturn.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ActualVatReturn,
  }),
  HttpApiEndpoint.get("getActualVatReturn", `${path}/actuals/:id`, {
    ...identified,
    success: ActualVatReturnView,
  }),
  HttpApiEndpoint.get("listActualVatReturns", `${path}/actuals`, {
    ...scoped,
    success: ActualVatReturnList,
  }),
);

const scope = { scope: A.Scope };

export const PrepareVatCommand = Schema.Struct({
  ...scope,
  idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
  input: PrepareVatDraft,
});

export const VatReturnCapabilities = {
  vat_return_get_reclassification: {
    input: Schema.Struct({ ...scope, reviewId: A.Identifier }),
    output: VatControlReclassificationView,
    readOnly: true,
    description:
      "Read one retained synthetic VAT control reclassification, its exact plan, approvals and any committed effect. It records no assessment, payment or filing.",
  },
  vat_return_list_reclassifications: {
    input: Schema.Struct(scope),
    output: VatControlReclassificationList,
    readOnly: true,
    description:
      "Rediscover the complete bounded synthetic VAT control-reclassification history. One obligation accepts only its first reclassification effect.",
  },
  vat_return_recover_reclassification: {
    input: Schema.Struct({ ...scope, key: A.IdempotencyHeaders.fields["idempotency-key"] }),
    output: VatControlReclassificationRecovery,
    readOnly: true,
    description:
      "Recover a committed VAT reclassification command by its original idempotency key without creating a new financial effect.",
  },
  vat_return_compare_drafts: {
    input: Schema.Struct({ ...scope, input: CompareVatDrafts }),
    output: VatDraftImpactView,
    readOnly: true,
    description:
      "Compare exact saved synthetic draft versions, fact contributions and exclusions. No tax recalculation or filing.",
  },
  vat_return_get_amendment: {
    input: Schema.Struct({ ...scope, amendmentId: A.Identifier }),
    output: VatAmendmentView,
    readOnly: true,
    description:
      "Read the immutable operator-reviewed internal amendment and both original drafts. Not a submitted return.",
  },
  vat_return_list_amendments: {
    input: Schema.Struct(scope),
    output: VatAmendmentList,
    readOnly: true,
    description: "Rediscover all bounded internal VAT draft amendment relationships.",
  },
  vat_return_basis: {
    input: Schema.Struct(scope),
    output: VatBasis,
    readOnly: true,
    description:
      "Read all bounded VAT fact revisions and posted tax-line basis. Does not establish tax eligibility or completeness.",
  },
  vat_return_get_fact: {
    input: Schema.Struct({ ...scope, factId: A.Identifier }),
    output: VatFactView,
    readOnly: true,
    description:
      "Read immutable VAT fact history and exact saved draft/amendment membership, including captured exclusions. Does not recalculate, check currentness or determine a legal amendment obligation.",
  },
  vat_return_prepare_draft: {
    input: PrepareVatCommand,
    output: VatDraft,
    readOnly: false,
    description:
      "Save a non-filing VAT review draft. Only explicitly synthetic mode can contribute calculated boxes; no active legal profile.",
  },
  vat_return_get_draft: {
    input: Schema.Struct({ ...scope, draftId: A.Identifier }),
    output: VatDraftView,
    readOnly: true,
    description:
      "Read saved VAT draft, exact contributions, exclusions and current basis status. Never filing acceptance.",
  },
  vat_return_list_drafts: {
    input: Schema.Struct(scope),
    output: VatDraftList,
    readOnly: true,
    description: "Rediscover the complete bounded saved VAT review draft inventory.",
  },
  vat_return_prepare_actual: {
    input: PrepareActualVatCommand,
    output: ActualVatReturn,
    readOnly: false,
    description:
      "Seal an actual domestic VAT return calculation from the complete fact, purchase-component and VAT-control basis, using the reviewed vat rule release for every rate, box and filing unit. It records no submission, assessment or payment.",
  },
  vat_return_get_actual: {
    input: Schema.Struct({ ...scope, returnId: A.Identifier }),
    output: ActualVatReturnView,
    readOnly: true,
    description:
      "Read one sealed actual VAT return with its exact, reported and residual boxes, its contributors, its exclusions and its unresolved control rows, plus separately computed currentness.",
  },
  vat_return_list_actuals: {
    input: Schema.Struct(scope),
    output: ActualVatReturnList,
    readOnly: true,
    description: "Rediscover the complete bounded sealed actual VAT return inventory.",
  },
};
