import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Drafts from "./invoice-drafts";
import * as SupplierDrafts from "./supplier-invoice-drafts";
import { maxSourceBytes } from "./source-intake";
import { accountingErrors } from "./accounting-errors";

// The bounded extraction lifecycle for one retained supplier original. Extraction
// produces suggestions and provenance only: it never writes a reviewed fact, never
// posts and never changes a draft. The reviewed draft stays with the existing
// supplier draft owner, and an accepted economic document is never revised here.

const Label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

const ByteOffset = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: maxSourceBytes }));

// A reviewed engine release, not a caller-chosen string. Adding a document
// vocabulary or a provider is a new release literal in a reviewed change.
export const ExtractionEngineRelease = Schema.Literal("native-text-v1");

export const ExtractionDataUsePolicy = Schema.Literals(["retain_diagnostics", "retain_output"]);

export const ExtractionPage = Schema.Struct({
  page: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10000 })),
  startByte: ByteOffset,
  endByte: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: maxSourceBytes })),
});

export const ExtractionFieldKey = Schema.Literals([
  "title",
  "supplierDocumentNumber",
  "documentDate",
  "supplyDate",
  "dueDate",
  "paymentTerms",
  "sourceTotalMinor",
  "description",
  "quantity",
  "unitPriceMinor",
  "baseMinor",
  "discountMinor",
  "chargeMinor",
  "taxMinor",
  "taxDescription",
  "sourceGrossMinor",
]);

export const ExtractionDiagnostic = Schema.Struct({
  code: Label,
  lineOrdinal: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 })),
  fieldKey: Schema.String.check(Schema.isMaxLength(64)),
  detail: Schema.String.check(Schema.isMaxLength(120)),
});

export const SourceLocator = Schema.String.check(Schema.isPattern(/^span:[0-9]{1,8}-[0-9]{1,8}$/));

export const ExtractedField = Schema.Struct({
  // 0 addresses a header field; 1..50 addresses a draft line position.
  lineOrdinal: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 })),
  fieldKey: ExtractionFieldKey,
  proposedValue: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1000))),
  sourceLocators: Schema.Array(SourceLocator).check(Schema.isMaxLength(8)),
});

export const ExtractedLine = Schema.Struct({
  candidateLineId: Accounting.Identifier,
  sourceLocators: Schema.Array(SourceLocator).check(Schema.isMaxLength(8)),
  fields: Schema.Array(ExtractedField).check(Schema.isMaxLength(16)),
  content: Drafts.DraftLine,
});

// The retained engine interpretation. Money is an exact source assertion: a
// money field value is a canonical minor-integer string or null, never a number.
export const SupplierExtractionAttempt = Schema.Struct({
  requestId: Accounting.Identifier,
  attemptId: Accounting.Identifier,
  engineRelease: ExtractionEngineRelease,
  sourceHash: Accounting.Digest,
  originalHashUnchanged: Schema.Boolean,
  result: Schema.Literals(["succeeded", "rejected_output", "failed", "unknown"]),
  textDigest: Schema.NullOr(Accounting.Digest),
  textByteLength: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: maxSourceBytes })),
  retainedOutputHash: Accounting.Digest,
  fields: Schema.Array(ExtractedField).check(Schema.isMaxLength(64)),
  candidateLines: Schema.Array(ExtractedLine).check(Schema.isMaxLength(50)),
  diagnostics: Schema.Array(ExtractionDiagnostic).check(Schema.isMaxLength(64)),
  createdAt: Schema.String,
});

export const SupplierExtractionRequest = Schema.Struct({
  id: Accounting.Identifier,
  occurrenceId: Accounting.Identifier,
  generation: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
  originalHash: Accounting.Digest,
  originalBytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: maxSourceBytes })),
  engineRelease: ExtractionEngineRelease,
  attemptIdentity: Accounting.Digest,
  state: Schema.Literals(["ready", "completed", "unknown", "superseded", "cancelled"]),
  cancelVersion: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
  attemptsMade: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
  requestedBy: Accounting.Identifier,
  requestedAt: Schema.String,
  digest: Accounting.Digest,
});

export const RequestSupplierExtraction = Schema.Struct({
  engineRelease: ExtractionEngineRelease,
  selectedPages: Schema.Array(ExtractionPage).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  dataUsePolicy: ExtractionDataUsePolicy,
});

export const CancelSupplierExtraction = Schema.Struct({
  requestId: Accounting.Identifier,
});

// A merged field value is a bounded string or null, never a free JSON value: a
// number cannot be carried here, so a monetary encoding cannot reach a draft.
export const ExtractedValue = Schema.NullOr(Schema.String.check(Schema.isMaxLength(1000)));

export const MergeFieldState = Schema.Literals([
  "proposed_change",
  "unchanged",
  "convergent",
  "conflict",
  "retained_reviewed",
  "needs_review",
]);

export const MergedField = Schema.Struct({
  lineOrdinal: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 })),
  fieldKey: ExtractionFieldKey,
  state: MergeFieldState,
  base: ExtractedValue,
  current: ExtractedValue,
  suggestion: ExtractedValue,
  selected: ExtractedValue,
  evidenceLocators: Schema.Array(SourceLocator).check(Schema.isMaxLength(8)),
  detail: Schema.String.check(Schema.isMaxLength(64)),
});

export const MergedLine = Schema.Struct({
  candidateLineId: Accounting.Identifier,
  targetLineId: Schema.NullOr(Accounting.Identifier),
  disposition: Schema.Literals(["unmapped", "map_to_line"]),
  sourceLocators: Schema.Array(SourceLocator).check(Schema.isMaxLength(8)),
  state: MergeFieldState,
  detail: Schema.String.check(Schema.isMaxLength(64)),
});

export const MergeDiscrepancy = Schema.Struct({
  code: Label,
  lineOrdinal: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 })),
  fieldKey: Schema.String.check(Schema.isMaxLength(128)),
  detail: Schema.String.check(Schema.isMaxLength(200)),
});

// The reviewer's explicit disposition for one candidate line. An unmapped
// candidate stays a retained review item; two equal lines are mapped to two
// reviewed lines or are both retained, never silently merged into one. Extraction
// never synthesizes a new reviewed line: a line the reviewer wants is added through
// the existing draft revision, which stays that owner's authority.
export const ExtractionLineDecision = Schema.Struct({
  candidateLineId: Accounting.Identifier,
  disposition: Schema.Literals(["keep_reviewed", "map_to_line"]),
  targetLineId: Schema.NullOr(Accounting.Identifier),
});

export const ExtractionFieldDecision = Schema.Struct({
  lineOrdinal: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 })),
  fieldKey: ExtractionFieldKey,
  decisionKind: Schema.Literals(["accepted_suggestion", "retained_reviewed", "resolved_conflict"]),
  selectedValue: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1000))),
});

export const CommitSupplierExtractionReview = Schema.Struct({
  requestId: Accounting.Identifier,
  attemptId: Accounting.Identifier,
  expectedDraftRevision: Schema.NullOr(Commerce.Version),
  expectedDraftDigest: Schema.NullOr(Accounting.Digest),
  // Required only when the occurrence has no reviewed draft yet. Extraction never
  // invents a counterparty, an identity or an evidence reference, so the reviewer
  // supplies the base and the merge applies the chosen field values onto it.
  baseContent: Schema.NullOr(SupplierDrafts.SupplierDraftContent),
  reason: Accounting.Description,
  lines: Schema.Array(ExtractionLineDecision).check(Schema.isMaxLength(50)),
  fields: Schema.Array(ExtractionFieldDecision).check(Schema.isMaxLength(200)),
});

export const SupplierFieldDecisionRecord = Schema.Struct({
  id: Accounting.Identifier,
  draftId: Accounting.Identifier,
  draftRevision: Commerce.Version,
  lineOrdinal: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 })),
  fieldKey: ExtractionFieldKey,
  decisionKind: Schema.Literals(["accepted_suggestion", "retained_reviewed", "resolved_conflict"]),
  selectedValue: ExtractedValue,
  reviewer: Accounting.Identifier,
  recordedAt: Schema.String,
  digest: Accounting.Digest,
});

// The prepared review. It exposes the merged values and the exact discrepancy
// list; it writes nothing. A proposed total mismatch or a tax input the reviewer
// has not supplied is a blocker here, not a posting.
export const SupplierExtractionReviewPreparation = Schema.Struct({
  scope: Accounting.Scope,
  occurrenceId: Accounting.Identifier,
  request: SupplierExtractionRequest,
  attempt: SupplierExtractionAttempt,
  // The identity is null only while the occurrence has no reviewed draft; the
  // state itself is always present so a reviewer never has to guess.
  draft: Schema.Struct({
    id: Schema.NullOr(Accounting.Identifier),
    revision: Schema.NullOr(Commerce.Version),
    digest: Schema.NullOr(Accounting.Digest),
    state: Schema.Literals(["absent", "open", "accepted"]),
  }),
  fields: Schema.Array(MergedField).check(Schema.isMaxLength(400)),
  lines: Schema.Array(MergedLine).check(Schema.isMaxLength(50)),
  discrepancies: Schema.Array(MergeDiscrepancy).check(Schema.isMaxLength(200)),
  proposed: SupplierDrafts.SupplierDraftContent,
  proposedTotals: Schema.NullOr(Drafts.DraftTotals),
  proposedBlockers: Schema.Array(Drafts.DraftBlocker),
});

export const SupplierExtractionCorrectionCase = Schema.Struct({
  // The accepted economic document is named, never revised. Correcting it belongs
  // to the correction owner, not to extraction.
  draftId: Accounting.Identifier,
  acceptance: Schema.Literals(["accepted"]),
  requiredOwner: Schema.Literal("correction_review"),
  reason: Accounting.Description,
  fields: Schema.Array(MergedField).check(Schema.isMaxLength(400)),
});

export const SupplierExtractionReview = Schema.Struct({
  occurrenceId: Accounting.Identifier,
  outcome: Schema.Literals(["draft_created", "draft_revised", "correction_case"]),
  draft: Schema.NullOr(SupplierDrafts.SupplierInvoiceDraftRevision),
  correctionCase: Schema.NullOr(SupplierExtractionCorrectionCase),
  fieldDecisions: Schema.Array(SupplierFieldDecisionRecord).check(Schema.isMaxLength(200)),
});

export const SupplierExtractionState = Schema.Struct({
  scope: Accounting.Scope,
  occurrenceId: Accounting.Identifier,
  requests: Schema.Array(SupplierExtractionRequest).check(Schema.isMaxLength(20)),
  attempt: Schema.NullOr(SupplierExtractionAttempt),
  fieldDecisions: Schema.Array(SupplierFieldDecisionRecord).check(Schema.isMaxLength(200)),
});

export const SupplierExtractionRequestResult = Schema.Struct({
  request: SupplierExtractionRequest,
  occurrenceId: Accounting.Identifier,
});

export const SupplierExtractionCancelResult = Schema.Struct({
  request: SupplierExtractionRequest,
});

const path = "/v1/entities/:entityId/books/:bookId/commerce/supplier-inbox/:id/extraction";

export const SupplierExtractionApi = HttpApiGroup.make("supplierExtraction")
  .add(
    HttpApiEndpoint.post("requestSupplierExtraction", path, {
      params: Accounting.ChangePath,
      headers: Accounting.IdempotencyHeaders,
      payload: RequestSupplierExtraction.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: SupplierExtractionRequestResult,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("cancelSupplierExtraction", `${path}/:requestId/cancel`, {
      params: Schema.Struct({ ...Accounting.ChangePath.fields, requestId: Accounting.Identifier }),
      headers: Accounting.IdempotencyHeaders,
      payload: CancelSupplierExtraction.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: SupplierExtractionCancelResult,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getSupplierExtractionState", path, {
      params: Accounting.ChangePath,
      success: SupplierExtractionState,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("prepareSupplierExtractionReview", `${path}/:requestId/prepare`, {
      params: Schema.Struct({ ...Accounting.ChangePath.fields, requestId: Accounting.Identifier }),
      payload: Schema.Struct({ attemptId: Accounting.Identifier }).annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
      success: SupplierExtractionReviewPreparation,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("commitSupplierExtractionReview", `${path}/:requestId/review`, {
      params: Schema.Struct({ ...Accounting.ChangePath.fields, requestId: Accounting.Identifier }),
      headers: Accounting.IdempotencyHeaders,
      payload: CommitSupplierExtractionReview.annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
      success: SupplierExtractionReview,
      error: accountingErrors,
    }),
  );

// Extraction requests and human review are operator-only and stay out of the
// ordinary MCP catalogue. Reading the retained state and prepared suggestions is
// available to an agent; confirming a field is not.
export const SupplierExtractionCapabilities = {
  supplier_inbox_extraction_state: {
    description:
      "Read the bounded extraction requests, the retained attempt interpretation with its source locators and diagnostics, and the immutable human field decisions for one supplier inbox occurrence. Suggestions are unconfirmed evidence, not a reviewed fact. No extraction, review, acceptance or posting authority.",
    input: Schema.Struct({ scope: Accounting.Scope, occurrenceId: Accounting.Identifier }),
    output: SupplierExtractionState,
    readOnly: true,
  },
  supplier_inbox_extraction_review_preparation: {
    description:
      "Read the three-way merge of a retained extraction attempt against the current reviewed draft, with each field labelled unchanged, suggested, convergent, conflicting, reviewer-retained or needing review, plus the explicit discrepancy list and the proposed source totals. It writes nothing and applies nothing. No approval or posting authority.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      occurrenceId: Accounting.Identifier,
      requestId: Accounting.Identifier,
      attemptId: Accounting.Identifier,
    }),
    output: SupplierExtractionReviewPreparation,
    readOnly: true,
  },
};
