import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Profiles from "./company-profiles";
import { accountingErrors } from "./accounting-errors";

// Owned source-line recognition of a domestic purchase, and the exact signed tax
// components it publishes. The pure calculation lives in
// @open-erp/domain/purchasing; this file is its wire shape.

// The reviewed treatment of one source line. A basis code states why a line is
// treated as it is, and the deduction fraction must agree with it. Nothing is
// inferred from a brand, an account number or a document total.
import {
  AcceptancePolicy,
  Rational,
  RoundingMode,
  SourceReference,
  TaxPointDate,
  TaxPointBasis,
} from "@open-erp/domain/purchasing";

export { AcceptancePolicy, Rational, RoundingMode, SourceReference, TaxPointDate, TaxPointBasis };

export const DeductionBasis = Schema.Literals([
  "full_deduction",
  "half_deduction",
  "no_deduction_exclusion",
  "no_tax_exempt",
]);

export const ReviewedTreatment = Schema.Struct({
  basis: DeductionBasis,
  rate: Rational,
  deduction: Rational,
  invoiceTaxRounding: RoundingMode,
  deductionRounding: RoundingMode,
  acceptancePolicy: AcceptancePolicy,
  toleranceMinor: Accounting.MinorUnits,
});

// The two dates a retained supplier document actually carries. A tax point this
// operation cannot evidence is refused, not assumed.
export const DraftTaxPoint = Schema.Struct({
  taxPointOn: Accounting.AccountingDate,
  basis: Schema.Literals(["document_date", "supply_date"]),
});

// The sealed compiler result kept with the acceptance review, so approval binds
// the exact lines, journal group and deduction decisions that will post.
export const CreditLineRelease = Schema.Struct({
  sourceLineId: Accounting.Identifier,
  expenseAccountId: Accounting.Identifier,
  inputVatAccountId: Schema.NullOr(Accounting.Identifier),
  creditNetMinor: Accounting.MinorUnits,
  creditSourceTaxMinor: Accounting.MinorUnits,
  releasedDeductionMinor: Accounting.MinorUnits,
  expenseMinor: Accounting.MinorUnits,
  taxComponentId: Accounting.Identifier,
  creditedNetAfterMinor: Accounting.MinorUnits,
  creditedSourceTaxAfterMinor: Accounting.MinorUnits,
  releasedDeductionAfterMinor: Accounting.MinorUnits,
});

export const RecognitionPlan = Schema.Struct({
  totalNetMinor: Accounting.MinorUnits,
  totalSourceTaxMinor: Accounting.MinorUnits,
  totalDeductibleTaxMinor: Accounting.MinorUnits,
  totalNonDeductibleTaxMinor: Accounting.MinorUnits,
  payableMinor: Accounting.MinorUnits,
  lines: Schema.Array(
    Schema.Struct({
      sourceLineId: Accounting.Identifier,
      expenseAccountId: Accounting.Identifier,
      netMinor: Accounting.MinorUnits,
      sourceTaxMinor: Accounting.MinorUnits,
      deductibleTaxMinor: Accounting.MinorUnits,
      nonDeductibleTaxMinor: Accounting.MinorUnits,
      expenseMinor: Accounting.MinorUnits,
      taxComponentId: Accounting.Identifier,
      taxFactId: Accounting.Identifier,
      taxPointOn: Accounting.AccountingDate,
      recognitionDate: Accounting.AccountingDate,
      taxDiscrepancyMinor: Accounting.SignedMinorUnits,
      taxDiscrepancyOutcome: Schema.Literals(["exact_match", "retained_discrepancy"]),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  taxFacts: Schema.Array(
    Schema.Struct({
      sourceLineId: Accounting.Identifier,
      componentRole: Schema.Literal("input_tax"),
      taxComponentId: Accounting.Identifier,
      signedBaseMinor: Accounting.SignedMinorUnits,
      signedOutputTaxMinor: Accounting.SignedMinorUnits,
      signedDeductibleTaxMinor: Accounting.SignedMinorUnits,
      sourceTaxMinor: Accounting.MinorUnits,
      nonDeductibleTaxMinor: Accounting.MinorUnits,
      basis: DeductionBasis,
      taxPointOn: Accounting.AccountingDate,
      sourceRefs: Schema.Array(SourceReference).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(20),
      ),
      adjustsTaxFactId: Schema.NullOr(Accounting.Identifier),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  journal: Schema.Array(
    Schema.Struct({
      sourceLineId: Schema.NullOr(Accounting.Identifier),
      accountId: Accounting.Identifier,
      debitMinor: Accounting.MinorUnits,
      creditMinor: Accounting.MinorUnits,
      description: Accounting.Description,
    }),
  ).check(Schema.isMinLength(2), Schema.isMaxLength(200)),
});

export const RecordedTaxFact = Schema.Struct({
  id: Accounting.Identifier,
  recognitionId: Accounting.Identifier,
  sourceLineId: Accounting.Identifier,
  componentRole: Schema.Literal("input_tax"),
  taxComponentId: Accounting.Identifier,
  voucherId: Accounting.Identifier,
  signedBaseMinor: Accounting.SignedMinorUnits,
  signedOutputTaxMinor: Accounting.SignedMinorUnits,
  signedDeductibleTaxMinor: Accounting.SignedMinorUnits,
  sourceTaxMinor: Accounting.MinorUnits,
  nonDeductibleTaxMinor: Accounting.MinorUnits,
  basis: DeductionBasis,
  taxPointOn: Accounting.AccountingDate,
  reportingObligationId: Schema.NullOr(Accounting.Identifier),
  ruleReleaseId: Schema.NullOr(Accounting.Identifier),
  sourceRefs: Schema.Array(SourceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  adjustsTaxFactId: Schema.NullOr(Accounting.Identifier),
  recordedAt: Schema.String,
  digest: Accounting.Digest,
});

export const LineCapacity = Schema.Struct({
  recognitionId: Accounting.Identifier,
  sourceLineId: Accounting.Identifier,
  expenseAccountId: Accounting.Identifier,
  inputVatAccountId: Schema.NullOr(Accounting.Identifier),
  originalNetMinor: Accounting.MinorUnits,
  originalSourceTaxMinor: Accounting.MinorUnits,
  originalDeductibleTaxMinor: Accounting.MinorUnits,
  creditedNetMinor: Accounting.MinorUnits,
  creditedSourceTaxMinor: Accounting.MinorUnits,
  releasedDeductionMinor: Accounting.MinorUnits,
  remainingNetMinor: Accounting.MinorUnits,
  remainingSourceTaxMinor: Accounting.MinorUnits,
  remainingDeductionMinor: Accounting.MinorUnits,
  treatment: ReviewedTreatment,
  taxFactId: Accounting.Identifier,
  version: Accounting.MinorUnits,
  updatedAt: Schema.String,
});

const recognitionCommon = {
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  economicKey: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._:-]{2,190}$/)),
  voucherId: Accounting.Identifier,
  payableId: Accounting.Identifier,
  taxFactIds: Schema.Array(Accounting.Identifier).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  recordedBy: Accounting.Identifier,
  recordedAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
};

const commonRecognitionFields = {
  currency: Schema.String,
  currencyScale: Schema.Int,
  recognitionDate: Accounting.AccountingDate,
  taxPoint: TaxPointDate,
  profileWitness: Schema.NullOr(Profiles.ProfileWitness),
  profileGaps: Schema.Array(Profiles.ProfileGap).check(Schema.isMaxLength(40)),
  changeSetId: Accounting.Identifier,
  approvalId: Accounting.Identifier,
};

// One recognized economic purchase event. A revised supplier document is not
// automatically another purchase, so the economic key is the reviewed supplier
// identity and only one recognition may own it in a book.
export const PurchaseRecognition = Schema.Struct({
  ...recognitionCommon,
  eventOwner: Schema.Literal("supplier_purchase"),
  draftId: Accounting.Identifier,
  draftRevision: Commerce.Version,
  draftDigest: Accounting.Digest,
  supplierInvoiceRevision: Commerce.Version,
  counterpartyId: Accounting.Identifier,
  supplierDocumentNumber: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  ...commonRecognitionFields,
  plan: RecognitionPlan,
}).check(
  Schema.makeFilter(
    (recognition) =>
      recognition.draftRevision === recognition.supplierInvoiceRevision ||
      "A recognition records the exact supplier document revision it recognized.",
  ),
);

// A recognized supplier credit is its own economic event. It appends negative
// signed components that adjust the original recognition's components and
// consumes that recognition's original-line capacity; it never rewrites them.
export const PurchaseCreditRecognition = Schema.Struct({
  ...recognitionCommon,
  eventOwner: Schema.Literal("supplier_credit"),
  originalRecognitionId: Accounting.Identifier,
  invoiceId: Accounting.Identifier,
  supplierCreditNumber: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  reviewId: Accounting.Identifier,
  counterpartyId: Accounting.Identifier,
  creditGrossMinor: Accounting.MinorUnits,
  releasedDeductionMinor: Accounting.MinorUnits,
  lineReleases: Schema.Array(CreditLineRelease).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  ...commonRecognitionFields,
  creditDate: Accounting.AccountingDate,
  creditEvidence: Commerce.EvidenceReference,
});

export const RecognizedPurchaseEvent = Schema.Union([
  PurchaseRecognition,
  PurchaseCreditRecognition,
]);

export const PurchaseRecognitionView = Schema.Struct({
  recognition: RecognizedPurchaseEvent,
  taxFacts: Schema.Array(RecordedTaxFact).check(Schema.isMaxLength(100)),
  capacities: Schema.Array(LineCapacity).check(Schema.isMaxLength(50)),
  adjustments: Schema.Array(RecordedTaxFact).check(Schema.isMaxLength(100)),
  blockers: Schema.Array(Schema.String),
  dependenciesCurrent: Schema.Boolean,
});

const path = "/v1/entities/:entityId/books/:bookId/commerce/purchase-recognitions";

export const PurchaseRecognitionApi = HttpApiGroup.make("purchaseRecognition").add(
  HttpApiEndpoint.get("getPurchaseRecognition", `${path}/:id`, {
    params: Accounting.ChangePath,
    success: PurchaseRecognitionView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getPurchaseRecognitionByDraft", `${path}/by-draft/:draftId`, {
    params: Schema.Struct({
      entityId: Accounting.Identifier,
      bookId: Accounting.Identifier,
      draftId: Accounting.Identifier,
    }),
    success: PurchaseRecognitionView,
    error: accountingErrors,
  }),
);

export const PurchaseRecognitionCapabilities = {
  commerce_get_purchase_recognition: {
    description:
      "Read one recognized supplier purchase with its sealed compiler plan, exact signed tax components, current original-line capacities and any appended credit adjustments. This is the purchase owner's own recognition; it is not a VAT return, an assessment or a filing.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: PurchaseRecognitionView,
    readOnly: true,
  },
  commerce_get_purchase_recognition_by_draft: {
    description:
      "Read the recognized supplier purchase for one reviewed supplier draft, or a not-found refusal when that draft has no recognition. Content deduplication is not deduplication of business events.",
    input: Schema.Struct({ scope: Accounting.Scope, draftId: Accounting.Identifier }),
    output: PurchaseRecognitionView,
    readOnly: true,
  },
};
