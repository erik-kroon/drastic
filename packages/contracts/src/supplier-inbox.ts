import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as A from "./accounting";
import * as Source from "./source-intake";
import * as Draft from "./supplier-invoice-drafts";
import { accountingErrors } from "./accounting-errors";

const Label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

const Suggestion = Schema.Struct({
  field: Label,
  value: Schema.String.check(Schema.isMaxLength(2000)),
  sourceLocation: Label,
  confidence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
});

export const RegisterSupplierInbox = Schema.Struct({
  occurrenceId: A.Identifier,
  channel: Schema.Literals(["upload", "email"]),
  messageIdentity: Schema.NullOr(Label),
});

export const RecordSupplierExtraction = Schema.Struct({
  parserVersion: Label,
  status: Schema.Literals(["failed", "suggested"]),
  suggestions: Schema.Array(Suggestion).check(Schema.isMaxLength(50)),
  diagnostics: Schema.Array(Label).check(Schema.isMaxLength(50)),
});

// One recorded extraction interpretation. The four `RecordSupplierExtraction`
// fields stay the summary a caller-recorded attempt carries; a built-in engine
// attempt adds its request identity, verified source hash and exact result, and
// its field-level reading is read through the extraction state resource.
export const ExtractionAttempt = Schema.Struct({
  ...RecordSupplierExtraction.fields,
  status: Schema.Literals(["failed", "suggested", "succeeded", "rejected_output", "unknown"]),
  id: A.Identifier,
  occurrenceId: A.Identifier,
  ordinal: Schema.Int,
  createdBy: A.Identifier,
  createdAt: Schema.String,
  requestId: Schema.optional(A.Identifier),
  engineRelease: Schema.optional(Label),
  sourceHash: Schema.optional(A.Digest),
  textDigest: Schema.optional(Schema.NullOr(A.Digest)),
  textByteLength: Schema.optional(Schema.Int),
  retainedOutputHash: Schema.optional(A.Digest),
});

export const SupplierIntakeProvenance = Schema.Struct({
  channel: Schema.Literals(["email", "bulk", "drive", "dropbox"]),
  sourceAccountId: Label,
  envelopeId: Schema.NullOr(Label),
  folderId: Schema.NullOr(Label),
  fileId: Label,
  revision: Label,
});

export const SupplierInboxView = Schema.Struct({
  occurrence: Source.OccurrenceSummary,
  intakeProvenance: Schema.NullOr(SupplierIntakeProvenance),
  channel: RegisterSupplierInbox.fields.channel,
  messageIdentity: Schema.NullOr(Label),
  draftId: Schema.NullOr(A.Identifier),
  reviewReason: Schema.NullOr(A.Description),
  reviewAttemptId: Schema.NullOr(A.Identifier),
  attempts: Schema.Array(ExtractionAttempt).check(Schema.isMaxLength(50)),
});

export const SupplierInboxPage = Schema.Struct({
  items: Schema.Array(SupplierInboxView).check(Schema.isMaxLength(20)),
  nextCursor: Schema.NullOr(A.Identifier),
});

export const ReviewSupplierInbox = Schema.Struct({
  draft: Draft.CreateSupplierInvoiceDraft,
  reviewReason: A.Description,
  reviewAttemptId: Schema.NullOr(A.Identifier),
});

export const SupplierInboxReview = Schema.Struct({
  inbox: SupplierInboxView,
  draft: Draft.SupplierInvoiceDraftRevision,
});

export const SupplierInboxCapabilities = {
  supplier_inbox_list: {
    description: "Read a bounded book-scoped supplier inbox page without fetching original bytes.",
    input: Schema.Struct({ scope: A.Scope, cursor: Schema.optional(A.Identifier) }),
    output: SupplierInboxPage,
    readOnly: true,
  },
  supplier_inbox_get: {
    description:
      "Read one supplier inbox occurrence, extraction attempts and retained review reason without fetching original bytes.",
    input: Schema.Struct({ scope: A.Scope, occurrenceId: A.Identifier }),
    output: SupplierInboxView,
    readOnly: true,
  },
};

export const IntakeItem = Schema.Struct({
  fileId: Label,
  revision: Label,
  filename: Label,
  mediaType: Source.SourceMediaType,
  contentBase64: Source.RetainSource.fields.contentBase64,
});

export const IntakeBatch = Schema.Struct({
  channel: Schema.Literals(["email", "bulk"]),
  sourceAccountId: Label,
  destination: Schema.NullOr(Label),
  envelopeId: Schema.NullOr(Label),
  items: Schema.Array(IntakeItem).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
});

export const CloudIntake = Schema.Struct({
  provider: Schema.Literals(["drive", "dropbox"]),
  sourceAccountId: Label,
  folderId: Label,
  cursor: Schema.NullOr(Label),
});

export const IntakeItemOutcome = Schema.Struct({
  fileId: Label,
  revision: Label,
  status: Schema.Literals(["retained", "duplicate", "refused", "unknown", "expired"]),
  occurrenceId: Schema.NullOr(A.Identifier),
  reason: Schema.NullOr(Schema.String),
});

export const IntakeBatchResult = Schema.Struct({
  destination: Label,
  state: Schema.Literals(["completed", "unknown"]),
  items: Schema.Array(IntakeItemOutcome),
  nextCursor: Schema.NullOr(Label),
});

export const ForwardingDestination = Schema.Struct({ address: Label });

const path = "/v1/entities/:entityId/books/:bookId/commerce/supplier-inbox";

export const SupplierInboxApi = HttpApiGroup.make("supplierInbox")
  .add(
    HttpApiEndpoint.get("getIntakeDestination", `${path}/intake-destination`, {
      params: A.Scope,
      success: ForwardingDestination,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("acquireIntakeBatch", `${path}/intake-batches`, {
      params: A.Scope,
      headers: A.IdempotencyHeaders,
      payload: IntakeBatch,
      success: IntakeBatchResult,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("acquireCloudIntake", `${path}/cloud-imports`, {
      params: A.Scope,
      headers: A.IdempotencyHeaders,
      payload: CloudIntake,
      success: IntakeBatchResult,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("listSupplierInboxes", path, {
      params: A.Scope,
      query: Schema.Struct({ cursor: Schema.optional(A.Identifier) }),
      success: SupplierInboxPage,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("registerSupplierInbox", path, {
      params: A.Scope,
      headers: A.IdempotencyHeaders,
      payload: RegisterSupplierInbox,
      success: SupplierInboxView,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getSupplierInbox", `${path}/:id`, {
      params: A.ChangePath,
      success: SupplierInboxView,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("recordSupplierExtraction", `${path}/:id/extractions`, {
      params: A.ChangePath,
      headers: A.IdempotencyHeaders,
      payload: RecordSupplierExtraction,
      success: SupplierInboxView,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("reviewSupplierInbox", `${path}/:id/review`, {
      params: A.ChangePath,
      headers: A.IdempotencyHeaders,
      payload: ReviewSupplierInbox,
      success: SupplierInboxReview,
      error: accountingErrors,
    }),
  );
