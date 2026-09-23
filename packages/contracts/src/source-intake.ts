import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as A from "./accounting";
import * as Bank from "./reconciliation";
import { accountingErrors } from "./accounting-errors";

const Label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const Amount = Bank.StatementSource.fields.openingMinor;
export const maxSourceBytes = 5 * 1024 * 1024;
export const SourceMediaType = Schema.Literals([
  "text/csv",
  "text/plain",
  "application/pdf",
  "application/json",
  "application/xml",
  "image/jpeg",
  "image/png",
  "application/octet-stream",
]);
export const RetainSource = Schema.Struct({
  sourceSystem: Label,
  sourceAccountId: Label,
  occurrenceKey: Label,
  sourceRevision: Label,
  filename: Label,
  mediaType: Schema.optional(SourceMediaType),
  contentBase64: Schema.String.check(
    Schema.isMinLength(4),
    Schema.isMaxLength(6990508),
    Schema.isPattern(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  ),
});
export const SourceOccurrence = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  sourceSystem: Label,
  sourceAccountId: Label,
  occurrenceKey: Label,
  sourceRevision: Label,
  filename: Label,
  sha256: A.Digest,
  byteLength: Schema.Int,
  mediaType: SourceMediaType,
  retainedBy: A.Identifier,
  retainedAt: Schema.String,
  receipt: Bank.CommandReceipt,
});
export const CsvMapping = Schema.Struct({
  profile: Schema.Literal("bank_csv_utf8_v1"),
  delimiter: Schema.Literals([",", ";", "\t"]),
  lineEnding: Schema.Literals(["lf", "crlf"]),
  dateColumn: Label,
  descriptionColumn: Label,
  amountColumn: Label,
  providerIdColumn: Schema.NullOr(Label),
  dateFormat: Schema.Literals(["YYYY-MM-DD", "DD/MM/YYYY"]),
  decimalSeparator: Schema.Literals([".", ","]),
  sign: Schema.Literals(["inflow_positive", "outflow_positive"]),
  accountId: A.Identifier,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  currencyScale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  startsOn: A.AccountingDate,
  endsOn: A.AccountingDate,
  openingMinor: Amount,
  closingMinor: Amount,
  completeness: Bank.StatementSource.fields.completeness,
});
export const CsvDiagnostic = Schema.Struct({
  severity: Schema.Literals(["error", "warning"]),
  code: Schema.String,
  recordOrdinal: Schema.NullOr(Schema.Int),
  line: Schema.NullOr(Schema.Int),
  byteOffset: Schema.NullOr(Schema.Int),
  message: Schema.String,
});
export const CsvRecord = Schema.Struct({
  recordOrdinal: Schema.Int,
  lineStart: Schema.Int,
  lineEnd: Schema.Int,
  byteStart: Schema.Int,
  byteEnd: Schema.Int,
  fields: Schema.Array(Schema.String),
});
export const IntakeDependencies = Schema.Struct({
  profileVersion: Schema.String,
  writerEpoch: Schema.String,
  accountVersion: Schema.NullOr(Schema.String),
  sourceRevision: Schema.String,
});
export const SourcePreview = Schema.Struct({
  id: A.Identifier,
  occurrenceId: A.Identifier,
  scope: A.Scope,
  version: Schema.Literal(1),
  sourceSha256: A.Digest,
  mapping: CsvMapping,
  dependencies: IntakeDependencies,
  structuralComplete: Schema.Boolean,
  hasBom: Schema.Boolean,
  records: Schema.Array(CsvRecord),
  rows: Schema.Array(Bank.BankRow),
  diagnostics: Schema.Array(CsvDiagnostic),
  ready: Schema.Boolean,
  movementMinor: A.SignedMinorUnits,
  statement: Schema.NullOr(Bank.StatementSource),
  createdBy: A.Identifier,
  createdAt: Schema.String,
  digest: A.Digest,
  receipt: Bank.CommandReceipt,
});
export const ApproveSourcePreview = Schema.Struct({
  digest: A.Digest,
  version: Schema.Literal(1),
  rationale: A.Description,
});
export const SourceApproval = Schema.Struct({
  ...ApproveSourcePreview.fields,
  id: A.Identifier,
  previewId: A.Identifier,
  actorId: A.Identifier,
  expiresAt: Schema.String,
  receipt: Bank.CommandReceipt,
});
export const AdmitSourcePreview = Schema.Struct({
  digest: A.Digest,
  version: Schema.Literal(1),
  approvalId: A.Identifier,
});
export const SourceAdmission = Schema.Struct({
  occurrenceId: A.Identifier,
  previewId: A.Identifier,
  approvalId: A.Identifier,
  digest: A.Digest,
  admittedAt: Schema.String,
  imported: Bank.StatementImportReceipt,
  receipt: Bank.CommandReceipt,
});
export const ReparseSourceCsv = Schema.Struct({
  digest: A.Digest,
  version: Schema.Literal(1),
  rationale: A.Description,
  mapping: CsvMapping,
});
export const SourceSupersession = Schema.Struct({
  occurrenceId: A.Identifier,
  previousPreviewId: A.Identifier,
  previousDigest: A.Digest,
  replacementPreviewId: A.Identifier,
  replacementDigest: A.Digest,
  rationale: A.Description,
  actorId: A.Identifier,
  createdAt: Schema.String,
  receipt: Bank.CommandReceipt,
});
export const SourceReparse = Schema.Struct({
  preview: SourcePreview,
  supersession: SourceSupersession,
});
export const SourceRevisionHistory = Schema.Struct({
  occurrenceId: A.Identifier,
  previews: Schema.Array(
    Schema.Struct({
      previewId: A.Identifier,
      digest: A.Digest,
      ordinal: Schema.Int,
      ready: Schema.Boolean,
      createdAt: Schema.String,
      createdBy: A.Identifier,
      diagnosticCount: Schema.Int,
      supersededByPreviewId: Schema.NullOr(A.Identifier),
    }),
  ),
  supersessions: Schema.Array(SourceSupersession),
  ownApprovals: Schema.Array(SourceApproval),
  admission: Schema.NullOr(SourceAdmission),
});
export const SourcePreviewView = Schema.Struct({
  supersededByPreviewId: Schema.optional(Schema.NullOr(A.Identifier)),
  preview: SourcePreview,
  approval: Schema.NullOr(SourceApproval),
  admission: Schema.NullOr(SourceAdmission),
  dependenciesCurrent: Schema.Boolean,
});
export const OccurrenceSummary = Schema.Struct({
  occurrence: SourceOccurrence,
  latestPreviewId: Schema.NullOr(A.Identifier),
  admission: Schema.NullOr(SourceAdmission),
});
export const SourceOccurrenceView = Schema.Struct({
  ...OccurrenceSummary.fields,
  contentBase64: Schema.String,
  previewIds: Schema.Array(A.Identifier),
});
export const SourceInventory = Schema.Struct({
  items: Schema.Array(OccurrenceSummary),
  nextCursor: Schema.NullOr(A.Identifier),
});
const base = "/v1/entities/:entityId/books/:bookId";
const scoped = { params: A.Scope, error: accountingErrors };
const identified = { params: A.ChangePath, error: accountingErrors };
const mutation = { ...scoped, headers: A.IdempotencyHeaders };
const identifiedMutation = { ...identified, headers: A.IdempotencyHeaders };
export const SourceIntakeApi = HttpApiGroup.make("sourceIntake").add(
  HttpApiEndpoint.post("retainSource", `${base}/source-occurrences`, {
    ...mutation,
    payload: RetainSource.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SourceOccurrence,
  }),
  HttpApiEndpoint.get("listSourceOccurrences", `${base}/source-occurrences`, {
    ...scoped,
    query: Schema.Struct({ cursor: Schema.optional(A.Identifier) }),
    success: SourceInventory,
  }),
  HttpApiEndpoint.get("getSourceOccurrence", `${base}/source-occurrences/:id`, {
    ...identified,
    success: SourceOccurrenceView,
  }),
  HttpApiEndpoint.post("previewSourceCsv", `${base}/source-occurrences/:id/previews`, {
    ...identifiedMutation,
    payload: CsvMapping.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SourcePreview,
  }),
  HttpApiEndpoint.post("reparseSourceCsv", `${base}/source-previews/:id/reparse`, {
    ...identifiedMutation,
    payload: ReparseSourceCsv.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SourceReparse,
  }),
  HttpApiEndpoint.get("getSourceRevisionHistory", `${base}/source-occurrences/:id/revisions`, {
    ...identified,
    success: SourceRevisionHistory,
  }),
  HttpApiEndpoint.get("getSourcePreview", `${base}/source-previews/:id`, {
    ...identified,
    success: SourcePreviewView,
  }),
  HttpApiEndpoint.post("approveSourcePreview", `${base}/source-previews/:id/approve`, {
    ...identifiedMutation,
    payload: ApproveSourcePreview.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SourceApproval,
  }),
  HttpApiEndpoint.post("admitSourcePreview", `${base}/source-previews/:id/admit`, {
    ...identifiedMutation,
    payload: AdmitSourcePreview.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SourceAdmission,
  }),
);

// Approval and admission are operator-only REST actions, not ordinary MCP tools.
export const SourceIntakeCapabilities = {
  source_retain: {
    description:
      "Retain original file bytes and explicit source occurrence identity. Files above 64 KiB and non-CSV documents require configured object storage. Does not import observations or post.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      input: RetainSource,
    }),
    output: SourceOccurrence,
    readOnly: false,
  },
  source_list_occurrences: {
    description:
      "List observed source occurrences and durable admissions. This is not required-source inventory or proof of completeness.",
    input: Schema.Struct({ scope: A.Scope, cursor: Schema.optional(A.Identifier) }),
    output: SourceInventory,
    readOnly: true,
  },
  source_get_occurrence: {
    description:
      "Retrieve retained original bytes, immutable preview IDs and admission receipt within a book.",
    input: Schema.Struct({ scope: A.Scope, occurrenceId: A.Identifier }),
    output: SourceOccurrenceView,
    readOnly: true,
  },
  source_preview_csv: {
    description:
      "Retain a bounded UTF-8 CSV interpretation with reviewed mapping and row diagnostics. Never posts or admits observations.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      occurrenceId: A.Identifier,
      input: CsvMapping,
    }),
    output: SourcePreview,
    readOnly: false,
  },
  source_reparse_csv: {
    description:
      "Reparse retained CSV bytes and explicitly supersede one unadmitted preview and its reviews. Retains all diagnostics; does not approve, admit or post.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      previewId: A.Identifier,
      input: ReparseSourceCsv,
    }),
    output: SourceReparse,
    readOnly: false,
  },
  source_get_revision_history: {
    description:
      "Recover an occurrence's immutable preview lineage, diagnostic counts, own review history and admission. Historical approvals are not current authority.",
    input: Schema.Struct({ scope: A.Scope, occurrenceId: A.Identifier }),
    output: SourceRevisionHistory,
    readOnly: true,
  },
  source_get_preview: {
    description:
      "Read an immutable CSV preview, current dependency status, own approval and durable admission receipt.",
    input: Schema.Struct({ scope: A.Scope, previewId: A.Identifier }),
    output: SourcePreviewView,
    readOnly: true,
  },
};
