import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as A from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CommandReceipt } from "./reconciliation";

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
export const VatFactView = Schema.Struct({
  current: VatFact,
  history: Schema.Array(VatFact),
  withdrawal: Schema.NullOr(VatFactWithdrawal),
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
export const VatDraftImpact = Schema.Struct({
  digest: A.Digest,
  version: Schema.Literal("vat-draft-impact-v1"),
  scope: A.Scope,
  original: VatDraftReference,
  replacement: VatDraftReference,
  facts: Schema.Array(
    Schema.Struct({
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
    }),
  ),
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

const path = "/v1/entities/:entityId/books/:bookId/vat-returns";
const scoped = { params: A.Scope, error: accountingErrors };
const identified = { params: A.ChangePath, error: accountingErrors };
export const VatReturnsApi = HttpApiGroup.make("vatReturns").add(
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
);
const scope = { scope: A.Scope };
export const PrepareVatCommand = Schema.Struct({
  ...scope,
  idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
  input: PrepareVatDraft,
});
export const VatReturnCapabilities = {
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
    description: "Read immutable VAT fact history in the admitted book.",
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
};
