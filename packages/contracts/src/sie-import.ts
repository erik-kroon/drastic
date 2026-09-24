import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as A from "./accounting";
import * as Intake from "./source-intake";
import { accountingErrors } from "./accounting-errors";

const Label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const Record = Schema.Struct({
  ordinal: Schema.Int,
  line: Schema.Int,
  byteStart: Schema.Int,
  byteEnd: Schema.Int,
  tag: Schema.String,
  text: Schema.String,
  fields: Schema.Array(Schema.String),
  voucherOrdinal: Schema.NullOr(Schema.Int),
});
const Transaction = Schema.Struct({
  recordOrdinal: Schema.Int,
  kind: Schema.Literals(["TRANS", "RTRANS", "BTRANS"]),
  account: Schema.String,
  dimensions: Schema.String,
  amount: Schema.String,
});
const Voucher = Schema.Struct({
  ordinal: Schema.Int,
  series: Schema.String,
  number: Schema.String,
  date: Schema.String,
  recordOrdinal: Schema.Int,
  sourceReference: Schema.String,
  transactions: Schema.Array(Transaction),
});
const Control = Schema.Struct({
  kind: Schema.Literals(["IB", "UB", "RES"]),
  year: Schema.String,
  account: Schema.String,
  amount: Schema.String,
  recordOrdinal: Schema.Int,
});
const Diagnostic = Schema.Struct({
  code: Schema.String,
  severity: Schema.Literals(["error", "warning"]),
  line: Schema.Int,
  byteOffset: Schema.Int,
  message: Schema.String,
});
const Receipt = Intake.SourceOccurrence.fields.receipt;
export const SiePreview = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  occurrenceId: A.Identifier,
  ordinal: Schema.Int,
  profile: Schema.Literal("sie4_source_v1"),
  encoding: Schema.Literals(["utf-8", "windows-1252", "ibm437"]),
  sourceSha256: A.Digest,
  records: Schema.Array(Record),
  vouchers: Schema.Array(Voucher),
  controls: Schema.Array(Control),
  diagnostics: Schema.Array(Diagnostic),
  ready: Schema.Boolean,
  createdBy: A.Identifier,
  createdAt: Schema.String,
  digest: A.Digest,
  receipt: Receipt,
});
export const Mapping = Schema.Struct({
  sourceAccount: Schema.String.check(Schema.isPattern(/^[0-9]{4}$/)),
  accountId: A.Identifier,
});
export const SiePreviewInventory = Schema.Struct({
  scope: A.Scope,
  occurrenceId: A.Identifier,
  items: Schema.Array(
    Schema.Struct({
      id: A.Identifier,
      ordinal: Schema.Int,
      encoding: SiePreview.fields.encoding,
      ready: Schema.Boolean,
      createdAt: Schema.String,
    }),
  ).check(Schema.isMaxLength(50)),
});
export const OpeningControl = Schema.Struct({
  sourceAccount: Mapping.fields.sourceAccount,
  year: Schema.String.check(Schema.isPattern(/^-?[0-9]{1,4}$/)),
  independentOpeningMinor: A.SignedMinorUnits,
  independentClosingMinor: A.SignedMinorUnits,
  basis: Label,
});
export const HistoricalOpenItem = Schema.Struct({
  sourceIdentity: Label,
  sourceAccount: Mapping.fields.sourceAccount,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  originalMinor: A.SignedMinorUnits,
  outstandingMinor: A.SignedMinorUnits,
  asOf: A.AccountingDate,
  assertedState: Schema.Literals(["unpaid", "partly_paid", "unknown"]),
  detailAvailability: Schema.Literals(["source_asserted", "unreconstructable"]),
  basis: A.Description,
});
export const OpenItemControl = Schema.Struct({
  sourceAccount: Mapping.fields.sourceAccount,
  currency: HistoricalOpenItem.fields.currency,
  independentOutstandingMinor: A.SignedMinorUnits,
  basis: A.Description,
});
export const SealSiePlan = Schema.Struct({
  digest: A.Digest,
  mappings: Schema.Array(Mapping).check(Schema.isMaxLength(500)),
  openingControls: Schema.Array(OpeningControl).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(500),
  ),
  openItems: Schema.Array(HistoricalOpenItem).check(Schema.isMaxLength(500)),
  openItemControls: Schema.Array(OpenItemControl).check(Schema.isMaxLength(500)),
  rationale: A.Description,
  openingPolicy: Schema.Literal("unreconstructable_detail"),
  sourceKind: Schema.Literals(["synthetic", "reviewed_sie4"]),
});
export const SiePlan = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  previewId: A.Identifier,
  previewDigest: A.Digest,
  sourceSha256: A.Digest,
  input: SealSiePlan,
  voucherCount: Schema.Int,
  createdBy: A.Identifier,
  createdAt: Schema.String,
  financialAdmission: Schema.Literal("unsupported"),
  unreconstructableDetail: Schema.Literal(true),
  digest: A.Digest,
  receipt: Receipt,
});
export const SieRunStart = Schema.Struct({
  id: A.Identifier,
  planId: A.Identifier,
  planDigest: A.Digest,
  nextOrdinal: Schema.Int,
  fence: Schema.String,
  leaseUntil: Schema.NullOr(Schema.String),
  status: Schema.Literals(["running", "paused", "staged"]),
  financialAdmission: Schema.Literal("unsupported"),
});
export const SieChunk = Schema.Struct({
  runId: A.Identifier,
  planDigest: A.Digest,
  firstOrdinal: Schema.Int,
  lastOrdinal: Schema.Int,
  fence: Schema.String,
  voucherCount: Schema.Int,
  membershipDigest: A.Digest,
  receipt: Receipt,
});
export const SieRun = Schema.Struct({
  ...SieRunStart.fields,
  voucherCount: Schema.Int,
  chunks: Schema.Array(SieChunk),
});
export const SieFence = Schema.Struct({
  id: A.Identifier,
  nextOrdinal: Schema.Int,
  fence: Schema.String,
  leaseUntil: Schema.NullOr(Schema.String),
  status: Schema.Literals(["running", "paused", "staged"]),
});
const base = "/v1/entities/:entityId/books/:bookId";
const identified = { params: A.ChangePath, error: accountingErrors };
const mutation = { ...identified, headers: A.IdempotencyHeaders };
export const SieImportApi = HttpApiGroup.make("sieImport")
  .add(
    HttpApiEndpoint.get("listSieSourcePreviews", `${base}/source-occurrences/:id/sie-previews`, {
      ...identified,
      success: SiePreviewInventory,
    }),
  )
  .add(
    HttpApiEndpoint.post("captureSieSource", `${base}/source-occurrences/:id/sie-previews`, {
      ...mutation,
      payload: Schema.Struct({ encoding: Schema.Literals(["utf-8", "windows-1252", "ibm437"]) }),
      success: SiePreview,
    }),
  )
  .add(
    HttpApiEndpoint.get("getSieSource", `${base}/sie-previews/:id`, {
      ...identified,
      success: SiePreview,
    }),
  )
  .add(
    HttpApiEndpoint.post("sealSieSourcePlan", `${base}/sie-previews/:id/plans`, {
      ...mutation,
      payload: SealSiePlan,
      success: SiePlan,
    }),
  )
  .add(
    HttpApiEndpoint.get("getSieSourcePlan", `${base}/sie-plans/:id`, {
      ...identified,
      success: SiePlan,
    }),
  )
  .add(
    HttpApiEndpoint.post("startSieSourceRun", `${base}/sie-plans/:id/runs`, {
      ...mutation,
      payload: Schema.Struct({ digest: A.Digest }),
      success: SieRunStart,
    }),
  )
  .add(
    HttpApiEndpoint.get("getSieSourceRun", `${base}/sie-runs/:id`, {
      ...identified,
      success: SieRun,
    }),
  )
  .add(
    HttpApiEndpoint.post("advanceSieSourceRun", `${base}/sie-runs/:id/chunks`, {
      ...mutation,
      payload: Schema.Struct({
        fence: Schema.String,
        planDigest: A.Digest,
        firstOrdinal: Schema.Int,
      }),
      success: SieChunk,
    }),
  )
  .add(
    HttpApiEndpoint.post("reclaimSieSourceRun", `${base}/sie-runs/:id/lease`, {
      ...mutation,
      payload: Schema.Struct({ action: Schema.Literals(["pause", "resume"]) }),
      success: SieFence,
    }),
  );
