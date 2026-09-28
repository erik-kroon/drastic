import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import { accountingErrors } from "./accounting-errors";

// K2 annual-report semantic model and iXBRL (NEXT-24). One sealed draft, one
// human approval, one finalized semantic model with its render intent, one
// presentation revision and one retained artifact. The pure disclosure,
// finalization, presentation, assembly and validation-record math lives in
// @open-erp/domain/annual-report; this file is its wire shape.

import {
  DisclosureRequirement,
  FinalSemanticReport,
  IxbrlContext,
  IxbrlFact,
  PresentedFact,
  PresentationRevision,
  SemanticFact,
} from "@open-erp/domain/annual-report";

export {
  DisclosureRequirement,
  FinalSemanticReport,
  IxbrlFact,
  IxbrlContext,
  PresentedFact,
  PresentationRevision,
  SemanticFact,
};

// A reviewed disclosure requirement. An applicable requirement carries either
// a derived amount or an explicit reviewed non-ledger fact; an inapplicable
// one carries its reason and fact evidence, never an empty default.
export const ReportDisclosureInput = Schema.Struct({
  requirementId: Accounting.Identifier,
  applicability: Schema.Literals(["applicable", "inapplicable", "unknown"]),
  inapplicableReason: Schema.NullOr(Accounting.Identifier),
  derivedMinor: Schema.NullOr(Accounting.SignedMinorUnits),
  reviewedExplicitFact: Schema.Boolean,
  evidenceId: Schema.NullOr(Accounting.Identifier),
});

// A reviewed semantic fact. Narratives, governance assertions and other
// non-ledger facts arrive here as explicit reviewed values; the compiler
// never derives them from ledger balances.
export const ReportFactInput = Schema.Struct({
  semanticId: Accounting.Identifier,
  valueMinor: Schema.NullOr(Accounting.SignedMinorUnits),
  notApplicable: Schema.Boolean,
  evidenceRefs: Schema.Array(Accounting.Identifier).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(20),
  ),
  calculationRefs: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(20)),
});

// A narrative section carries only approved content. An unapproved or draft
// section keeps the whole report a draft; the human approval seals exactly
// the content it reviewed.
export const NarrativeSection = Schema.Struct({
  sectionId: Accounting.Identifier,
  title: Accounting.Description,
  approvedContent: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(65536)),
  approvedBy: Schema.NullOr(Accounting.Identifier),
});

// A reviewed taxonomy concept mapping. Concept QNames, context rules and
// datatypes are qualified data carried here, never invented by the renderer.
export const ConceptMapping = Schema.Struct({
  semanticId: Accounting.Identifier,
  concept: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  contextRef: Accounting.Identifier,
  unitRef: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  decimals: Schema.String.check(Schema.isPattern(/^-?[0-9]{1,6}$/)),
});

export const ReportContextInput = Schema.Struct({
  contextRef: Accounting.Identifier,
  period: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  dimensions: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
});

export const PrepareAnnualReport = Schema.Struct({
  profile: Schema.Literal("k2-annual-report-v1"),
  fiscalYearId: Accounting.Identifier,
  closeCertificateId: Accounting.Identifier,
  statementSnapshotIds: Schema.Array(Accounting.Identifier).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(10),
  ),
  comparativeSnapshotIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(10)),
  missingHistoryNote: Schema.NullOr(Accounting.Description),
  frameworkRelease: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  eligibilityEvidenceId: Accounting.Identifier,
  disclosures: Schema.Array(ReportDisclosureInput).check(Schema.isMaxLength(200)),
  facts: Schema.Array(ReportFactInput).check(Schema.isMaxLength(500)),
  narratives: Schema.Array(NarrativeSection).check(Schema.isMaxLength(50)),
  reason: Accounting.Description,
});

export const ApproveAnnualReport = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
});

export const FinalizeAnnualReport = Schema.Struct({
  ...ApproveAnnualReport.fields,
  approvalId: Accounting.Identifier,
});

export const AnnualReportDraft = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  profile: Schema.Literal("k2-annual-report-v1"),
  fiscalYearId: Accounting.Identifier,
  fiscalYear: Schema.String.check(Schema.isPattern(/^\d{4}$/)),
  input: PrepareAnnualReport,
  closeCertificateId: Accounting.Identifier,
  frameworkRelease: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  requirements: Schema.Array(DisclosureRequirement),
  facts: Schema.Array(SemanticFact),
  narratives: Schema.Array(NarrativeSection),
  narrativesApproved: Schema.Boolean,
  comparativeSupported: Schema.Boolean,
  evidence: Commerce.EvidenceReference,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const AnnualReportApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  draftId: Accounting.Identifier,
  digest: Accounting.Digest,
  version: Schema.Literal(1),
  actorId: Accounting.Identifier,
  ordinal: Schema.Int,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
});

export const AnnualReportFinal = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  draftId: Accounting.Identifier,
  draftDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  fiscalYearId: Accounting.Identifier,
  summary: FinalSemanticReport,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const PrepareReportPresentation = Schema.Struct({
  finalId: Accounting.Identifier,
  facts: Schema.Array(PresentedFact).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  expectedTotalMinor: Accounting.SignedMinorUnits,
  presentationOnlyRows: Schema.Array(
    Schema.Struct({
      label: Accounting.Identifier,
      amountMinor: Accounting.SignedMinorUnits,
    }),
  ).check(Schema.isMaxLength(20)),
});

export const ReportPresentation = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  finalId: Accounting.Identifier,
  revision: PresentationRevision,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const RenderReportArtifact = Schema.Struct({
  presentationId: Accounting.Identifier,
  entityIdentifier: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  units: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(10),
  ),
  contexts: Schema.Array(ReportContextInput).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  conceptMappings: Schema.Array(ConceptMapping).check(Schema.isMaxLength(500)),
});

export const ReportArtifact = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  presentationId: Accounting.Identifier,
  finalId: Accounting.Identifier,
  xhtml: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000000)),
  contentHash: Accounting.Digest,
  mediaType: Schema.Literal("application/xhtml+xml"),
  sizeBytes: Schema.Int,
  factCount: Accounting.MinorUnits,
  contextCount: Accounting.MinorUnits,
  unitCount: Accounting.MinorUnits,
  // No qualified native validator is released, so every retained artifact
  // carries validation pending. A pending artifact is retained evidence, never
  // a validated manifest, and it blocks artifact acceptance.
  validationState: Schema.Literal("pending_qualified_validator"),
  signatureScopeDigest: Schema.NullOr(Accounting.Digest),
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export const AnnualReportView = Schema.Struct({
  draft: AnnualReportDraft,
  approval: Schema.NullOr(AnnualReportApproval),
  final: Schema.NullOr(AnnualReportFinal),
  presentation: Schema.NullOr(ReportPresentation),
  artifact: Schema.NullOr(ReportArtifact),
  blockers: Schema.Array(Schema.String),
  dependenciesCurrent: Schema.Boolean,
  approvalUsable: Schema.Boolean,
});

export const AnnualReportHistory = Schema.Struct({
  scope: Accounting.Scope,
  fiscalYearId: Accounting.Identifier,
  complete: Schema.Literal(true),
  count: Schema.Int,
  items: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      digest: Accounting.Digest,
      createdAt: Schema.String,
      finalId: Schema.NullOr(Accounting.Identifier),
      artifactId: Schema.NullOr(Accounting.Identifier),
    }),
  ).check(Schema.isMaxLength(50)),
});

const path = "/v1/entities/:entityId/books/:bookId/reports/annual";

const mutation = {
  params: Accounting.ChangePath,
  headers: Accounting.IdempotencyHeaders,
  error: accountingErrors,
};

export const AnnualReportApi = HttpApiGroup.make("annualReport").add(
  HttpApiEndpoint.post("prepareAnnualReport", `${path}/drafts`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareAnnualReport.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: AnnualReportDraft,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("approveAnnualReport", `${path}/drafts/:id/approvals`, {
    ...mutation,
    payload: ApproveAnnualReport.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: AnnualReportApproval,
  }),
  HttpApiEndpoint.post("finalizeAnnualReport", `${path}/drafts/:id/finalize`, {
    ...mutation,
    payload: FinalizeAnnualReport.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: AnnualReportFinal,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("prepareReportPresentation", `${path}/finals/:id/presentation`, {
    ...mutation,
    payload: PrepareReportPresentation.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ReportPresentation,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("renderReportArtifact", `${path}/presentations/:id/artifact`, {
    ...mutation,
    payload: RenderReportArtifact.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ReportArtifact,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getAnnualReport", `${path}/drafts/:id`, {
    params: Accounting.ChangePath,
    success: AnnualReportView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("annualReportHistory", `${path}/years/:id/history`, {
    params: Accounting.ChangePath,
    success: AnnualReportHistory,
    error: accountingErrors,
  }),
);

// All report mutations are operator-only. Ordinary MCP exposes reads only.
export const AnnualReportCapabilities = {
  reports_get_annual_report: {
    description:
      "Read a sealed K2 annual-report draft with its approval, finalized model, presentation and retained artifact. Not a filing, an audit opinion or Bolagsverket acceptance.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: AnnualReportView,
    readOnly: true,
  },
  reports_annual_report_history: {
    description:
      "Read the complete bounded annual-report draft history of one fiscal year, including finalized models and retained artifacts.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: AnnualReportHistory,
    readOnly: true,
  },
};
