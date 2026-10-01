import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Profiles from "./company-profiles";
import * as Drafts from "./supplier-invoice-drafts";
import { accountingErrors } from "./accounting-errors";

// Owned general-rule cross-border service purchases (NEXT-05), and the exact
// reverse-charge components they publish. The pure calculation lives in
// @open-erp/domain/service-purchases; this file is its wire shape.

// One recognized economic service purchase event. A revised supplier document
// is not automatically another purchase, so the economic key is the reviewed
// supplier identity and only one recognition may own it in a book.
export const ServiceEconomicDocumentKey = Schema.String.check(
  Schema.isPattern(/^service_purchase:[a-z][a-z0-9_-]{2,127}:[\s\S]{1,200}$/u),
);

import {
  JurisdictionClass,
  Rational,
  ReverseChargeBasisBox,
  ReverseChargeOutputBox,
  RoundingMode,
  ServiceKind,
  SourceReference,
  TaxPointDate,
} from "@open-erp/domain/service-purchases";

export {
  JurisdictionClass,
  Rational,
  ReverseChargeBasisBox,
  ReverseChargeOutputBox,
  RoundingMode,
  ServiceKind,
  SourceReference,
  TaxPointDate,
};

const CurrencyCode = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/));

const CurrencyScale = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(6),
);

// A line assignment is a reviewed service decision, not a percentage. The
// service kind, origin class, deduction fraction and both conversion witnesses
// are the operator's qualified choice; the compiler checks them against the
// release selection and refuses anything outside it.
export const ServiceLineAssignment = Schema.Struct({
  lineId: Accounting.Identifier,
  expenseAccountId: Accounting.Identifier,
  originalNetMinor: Accounting.MinorUnits,
  originalCurrency: CurrencyCode,
  originalScale: CurrencyScale,
  sourceTaxMinor: Accounting.MinorUnits,
  serviceKind: ServiceKind,
  jurisdictionClass: JurisdictionClass,
  deduction: Rational,
  accountingRate: Rational,
  accountingRateScheme: Accounting.Description,
  taxPointRate: Rational,
  taxPointRateScheme: Accounting.Description,
});

// The resolved qualified release selection sealed with the review, so approval
// binds the exact rate, boxes and rounding that will post.
export const ServiceReleaseSelection = Schema.Struct({
  rateId: Accounting.Identifier,
  rate: Rational,
  euBasisBox: Schema.Literal("21"),
  nonEuBasisBox: Schema.Literal("22"),
  outputBox: ReverseChargeOutputBox,
  inputBox: Schema.Literal("48"),
  taxRounding: RoundingMode,
  deductionRounding: RoundingMode,
  supportedServiceKinds: Schema.Array(ServiceKind).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(80),
  ),
  supportedClasses: Schema.Array(JurisdictionClass).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(2),
  ),
});

export const PrepareServicePurchase = Schema.Struct({
  profile: Schema.Literal("general-service-reverse-charge-v1"),
  draftId: Accounting.Identifier,
  expectedRevision: Commerce.Version,
  expectedDigest: Accounting.Digest,
  controlAccountId: Accounting.Identifier,
  inputVatAccountId: Accounting.Identifier,
  outputVatAccountId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  reason: Accounting.Description,
  taxPoint: TaxPointDate,
  rateId: Accounting.Identifier,
  lineAssignments: Schema.Array(ServiceLineAssignment).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
});

export const ApproveServicePurchase = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
});

export const ExecuteServicePurchase = Schema.Struct({
  ...ApproveServicePurchase.fields,
  approvalId: Accounting.Identifier,
});

export const ServiceRecognitionPlan = Schema.Struct({
  currencyScale: CurrencyScale,
  bookCurrency: CurrencyCode,
  recognitionDate: Accounting.AccountingDate,
  totalAccountingValueMinor: Accounting.MinorUnits,
  totalTaxBaseMinor: Accounting.MinorUnits,
  totalOutputTaxMinor: Accounting.MinorUnits,
  totalDeductibleTaxMinor: Accounting.MinorUnits,
  totalNonDeductibleTaxMinor: Accounting.MinorUnits,
  payableMinor: Accounting.MinorUnits,
  payableAccountId: Accounting.Identifier,
  inputVatAccountId: Accounting.Identifier,
  outputVatAccountId: Accounting.Identifier,
  lines: Schema.Array(
    Schema.Struct({
      sourceLineId: Accounting.Identifier,
      expenseAccountId: Accounting.Identifier,
      originalNetMinor: Accounting.MinorUnits,
      originalCurrency: CurrencyCode,
      accountingValueMinor: Accounting.MinorUnits,
      taxBaseMinor: Accounting.MinorUnits,
      outputTaxMinor: Accounting.MinorUnits,
      deductibleTaxMinor: Accounting.MinorUnits,
      nonDeductibleTaxMinor: Accounting.MinorUnits,
      expenseMinor: Accounting.MinorUnits,
      taxComponentId: Accounting.Identifier,
      taxFactId: Accounting.Identifier,
      taxPointOn: Accounting.AccountingDate,
      recognitionDate: Accounting.AccountingDate,
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  taxFacts: Schema.Array(
    Schema.Struct({
      sourceLineId: Accounting.Identifier,
      componentRole: Schema.Literal("reverse_charge"),
      taxComponentId: Accounting.Identifier,
      taxFactId: Accounting.Identifier,
      signedBaseMinor: Accounting.SignedMinorUnits,
      signedOutputTaxMinor: Accounting.SignedMinorUnits,
      signedDeductibleTaxMinor: Accounting.SignedMinorUnits,
      sourceTaxMinor: Accounting.MinorUnits,
      nonDeductibleTaxMinor: Accounting.MinorUnits,
      serviceKind: ServiceKind,
      jurisdictionClass: JurisdictionClass,
      rateId: Accounting.Identifier,
      basisBox: ReverseChargeBasisBox,
      outputBox: ReverseChargeOutputBox,
      inputBox: Schema.Literal("48"),
      originalNetMinor: Accounting.MinorUnits,
      originalCurrency: CurrencyCode,
      originalScale: CurrencyScale,
      accountingRate: Rational,
      accountingRateScheme: Accounting.Description,
      accountingResidualMinor: Accounting.SignedMinorUnits,
      taxPointRate: Rational,
      taxPointRateScheme: Accounting.Description,
      taxBaseResidualMinor: Accounting.SignedMinorUnits,
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

export const RecordedServiceTaxFact = Schema.Struct({
  id: Accounting.Identifier,
  recognitionId: Accounting.Identifier,
  sourceLineId: Accounting.Identifier,
  componentRole: Schema.Literal("reverse_charge"),
  taxComponentId: Accounting.Identifier,
  voucherId: Accounting.Identifier,
  signedBaseMinor: Accounting.SignedMinorUnits,
  signedOutputTaxMinor: Accounting.SignedMinorUnits,
  signedDeductibleTaxMinor: Accounting.SignedMinorUnits,
  sourceTaxMinor: Accounting.MinorUnits,
  nonDeductibleTaxMinor: Accounting.SignedMinorUnits,
  serviceKind: ServiceKind,
  jurisdictionClass: JurisdictionClass,
  rateId: Accounting.Identifier,
  basisBox: ReverseChargeBasisBox,
  outputBox: ReverseChargeOutputBox,
  inputBox: Schema.Literal("48"),
  taxPointOn: Accounting.AccountingDate,
  reportingObligationId: Schema.NullOr(Accounting.Identifier),
  ruleReleaseId: Schema.NullOr(Accounting.Identifier),
  sourceRefs: Schema.Array(SourceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  adjustsTaxFactId: Schema.NullOr(Accounting.Identifier),
  recordedAt: Schema.String,
  digest: Accounting.Digest,
});

export const ServicePurchaseRecognition = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  eventOwner: Schema.Literal("service_purchase"),
  economicKey: ServiceEconomicDocumentKey,
  reviewId: Accounting.Identifier,
  draftId: Accounting.Identifier,
  draftRevision: Commerce.Version,
  draftDigest: Accounting.Digest,
  counterpartyId: Accounting.Identifier,
  supplierDocumentNumber: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  currency: CurrencyCode,
  currencyScale: CurrencyScale,
  recognitionDate: Accounting.AccountingDate,
  taxPoint: TaxPointDate,
  profileWitness: Schema.NullOr(Profiles.ProfileWitness),
  profileGaps: Schema.Array(Profiles.ProfileGap).check(Schema.isMaxLength(40)),
  releaseSelection: ServiceReleaseSelection,
  changeSetId: Accounting.Identifier,
  approvalId: Accounting.Identifier,
  voucherId: Accounting.Identifier,
  payableId: Accounting.Identifier,
  taxFactIds: Schema.Array(Accounting.Identifier).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  plan: ServiceRecognitionPlan,
  recordedBy: Accounting.Identifier,
  recordedAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const ServicePurchaseRecognitionView = Schema.Struct({
  recognition: ServicePurchaseRecognition,
  taxFacts: Schema.Array(RecordedServiceTaxFact).check(Schema.isMaxLength(100)),
  blockers: Schema.Array(Schema.String),
  dependenciesCurrent: Schema.Boolean,
});

export const ServicePurchaseReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  profile: Schema.Literal("general-service-reverse-charge-v1"),
  ordinal: Schema.Int,
  input: PrepareServicePurchase,
  draftSnapshot: Drafts.SupplierInvoiceDraftRevision,
  postingPlan: Accounting.ChangeSet,
  evidence: Commerce.EvidenceReference,
  originalLines: Schema.Array(
    Schema.Struct({
      lineId: Accounting.Identifier,
      expenseAccountId: Accounting.Identifier,
      originalNetMinor: Accounting.MinorUnits,
      originalCurrency: CurrencyCode,
      originalScale: CurrencyScale,
      sourceTaxMinor: Accounting.MinorUnits,
      taxComponentId: Accounting.Identifier,
      serviceKind: ServiceKind,
      jurisdictionClass: JurisdictionClass,
      deduction: Rational,
      accountingRate: Rational,
      accountingRateScheme: Accounting.Description,
      taxPointRate: Rational,
      taxPointRateScheme: Accounting.Description,
    }),
  ),
  recognition: ServiceRecognitionPlan,
  releaseSelection: ServiceReleaseSelection,
  profileWitness: Schema.optional(Profiles.ProfileWitness),
  profileGaps: Schema.optional(Schema.Array(Profiles.ProfileGap).check(Schema.isMaxLength(40))),
  inputVatAccountId: Accounting.Identifier,
  outputVatAccountId: Accounting.Identifier,
  legalBlockers: Schema.Array(Schema.String),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const ServicePurchaseApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  digest: Accounting.Digest,
  version: Schema.Literal(1),
  actorId: Accounting.Identifier,
  ordinal: Schema.Int,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const ServicePurchaseReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  profile: Schema.Literal("general-service-reverse-charge-v1"),
  draftId: Accounting.Identifier,
  draftRevision: Commerce.Version,
  draftDigest: Accounting.Digest,
  supplierDocumentNumber: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  accepted: Schema.Literal(true),
  recognized: Schema.Literal(true),
  paid: Schema.Literal(false),
  postingReceipt: Accounting.ExecutionReceipt,
  registerInvoiceId: Accounting.Identifier,
  recognitionId: Schema.NullOr(Accounting.Identifier),
  taxFactIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(50)),
  legalBlockers: Schema.Array(Schema.String),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const ServicePurchaseView = Schema.Struct({
  plan: ServicePurchaseReview,
  approval: Schema.NullOr(ServicePurchaseApproval),
  acceptance: Schema.NullOr(ServicePurchaseReceipt),
  blockers: Schema.Array(Schema.String),
  dependenciesCurrent: Schema.Boolean,
  approvalUsable: Schema.Boolean,
});

export const ServicePurchaseHistory = Schema.Struct({
  scope: Accounting.Scope,
  draftId: Accounting.Identifier,
  complete: Schema.Literal(true),
  count: Schema.Int,
  items: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      ordinal: Schema.Int,
      draftRevision: Commerce.Version,
      digest: Accounting.Digest,
      createdAt: Schema.String,
      acceptanceId: Schema.NullOr(Accounting.Identifier),
      supplierDocumentNumber: Schema.NullOr(Schema.String),
    }),
  ).check(Schema.isMaxLength(50)),
});

const path = "/v1/entities/:entityId/books/:bookId/commerce";

const mutation = {
  params: Accounting.ChangePath,
  headers: Accounting.IdempotencyHeaders,
  error: accountingErrors,
};

export const ServicePurchaseApi = HttpApiGroup.make("servicePurchases").add(
  HttpApiEndpoint.post("prepareServicePurchase", `${path}/service-purchase-reviews`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareServicePurchase.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ServicePurchaseReview,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("approveServicePurchase", `${path}/service-purchase-reviews/:id/approvals`, {
    ...mutation,
    payload: ApproveServicePurchase.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ServicePurchaseApproval,
  }),
  HttpApiEndpoint.post("executeServicePurchase", `${path}/service-purchase-reviews/:id/execute`, {
    ...mutation,
    payload: ExecuteServicePurchase.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ServicePurchaseReceipt,
  }),
  HttpApiEndpoint.get("getServicePurchaseReview", `${path}/service-purchase-reviews/:id`, {
    params: Accounting.ChangePath,
    success: ServicePurchaseView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get(
    "servicePurchaseHistory",
    `${path}/supplier-invoice-drafts/:id/service-purchase-reviews`,
    {
      params: Accounting.ChangePath,
      success: ServicePurchaseHistory,
      error: accountingErrors,
    },
  ),
  HttpApiEndpoint.get(
    "getServicePurchaseRecognition",
    `${path}/service-purchase-recognitions/:id`,
    {
      params: Accounting.ChangePath,
      success: ServicePurchaseRecognitionView,
      error: accountingErrors,
    },
  ),
);

// All recognition mutations are operator-only. Ordinary MCP exposes reads only.
export const ServicePurchaseCapabilities = {
  commerce_get_service_purchase_review: {
    description:
      "Read a sealed cross-border service purchase review, its current blockers, human approval and committed receipt. Not a VAT return, an assessment or a filing.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: ServicePurchaseView,
    readOnly: true,
  },
  commerce_service_purchase_history: {
    description:
      "Read the complete bounded service-purchase review history for one supplier draft, including saved recognition identities for recovery after reload.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: ServicePurchaseHistory,
    readOnly: true,
  },
  commerce_get_service_purchase_recognition: {
    description:
      "Read one recognized cross-border service purchase with its sealed compiler plan and exact reverse-charge components. This is the service owner's own recognition; it is not a VAT return, an assessment or a filing.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: ServicePurchaseRecognitionView,
    readOnly: true,
  },
};
