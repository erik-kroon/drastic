import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import * as Bank from "./reconciliation";
import { accountingErrors as errors } from "./accounting-errors";

// NEXT-09 owner contract: complete provider sync windows, extending the
// existing bank connector owner.
//
// A connector delivery used to advance a cursor page by page with nothing
// recording where the window began. A crashed run could not be resumed, and
// a partial page chain was indistinguishable from a complete one. This
// surface makes the window the unit: a claim fences the stream and either
// resumes the incomplete generation or starts one at the published cursor, a
// page append retains the exact bytes under the current fence, and a
// publication marks one complete generation visible.
//
// Three refusals are the point of the design rather than a limitation of it.
// A superseded fence cannot append or publish, so a slow worker cannot
// overwrite a newer claim. A publication whose base version or base cursor
// moved refuses, so a generation begun against a different base never
// publishes. And a different raw response for an already retained page
// conflicts instead of overwriting that evidence.
//
// The provider call itself is never here. Claim, page and publication are
// short transactions with no remote call inside them; the persistent Bun job
// owns the HTTP call and the loop, and hands back retained bytes.

// A provider cursor is opaque, and the empty string is a real value: the first
// request of a stream's very first window has no cursor yet. The contract
// carries it verbatim rather than a sentinel, because a sentinel would collide
// with a provider that legitimately issues that token.
const Cursor = Schema.String.check(Schema.isMaxLength(256));

const Ref = Accounting.Identifier;

const ChangeKind = Schema.Literals(["added", "modified", "removed"]);

export const ClaimSyncWindow = Schema.Struct({
  consentId: Ref,
  // A claim resumes an incomplete generation when one exists. This bound is
  // what stops a resumed window from claiming a new attempt on every restart.
  maximumPages: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
});

export type ClaimSyncWindow = typeof ClaimSyncWindow.Type;

export const WindowClaimState = Schema.Struct({
  streamId: Ref,
  consentId: Ref,
  generationId: Ref,
  baseCursor: Cursor,
  basePublicationVersion: Accounting.MinorUnits,
  attemptNumber: Accounting.MinorUnits,
  fence: Accounting.MinorUnits,
  resumed: Schema.Boolean,
  // Where the next page must be requested from, derived from the last
  // retained page rather than supplied by the caller.
  requestCursor: Cursor,
  retainedPageCount: Schema.Int,
  leaseUntil: Schema.String,
  publicationVersion: Accounting.MinorUnits,
  publishedCursor: Cursor,
  receipt: Bank.CommandReceipt,
});

export type WindowClaimState = typeof WindowClaimState.Type;

export const SyncChangeInput = Schema.Struct({
  kind: ChangeKind,
  sourceId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  rawLocator: Ref,
});

export type SyncChangeInput = typeof SyncChangeInput.Type;

export const AppendSyncPage = Schema.Struct({
  generationId: Ref,
  fence: Accounting.MinorUnits,
  // The ordinal this page was fetched for. A worker that crashed after the
  // page was retained re-offers the same ordinal, and the leaf decides
  // replay versus conflict from the retained digests rather than the owner
  // guessing which page was meant.
  ordinal: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 199 })),
  requestCursor: Cursor,
  nextCursor: Cursor,
  hasMore: Schema.Boolean,
  // The exact provider response, retained as content before this call. The
  // owner never trusts a digest the caller states about bytes it holds.
  raw: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(65536)),
  changes: Schema.Array(SyncChangeInput).check(Schema.isMaxLength(20)),
  // A provider mutation during pagination abandons this generation and starts
  // a new one at the published cursor captured for this window. It is never
  // the failed page cursor, an empty cursor or "now".
  mutationDuringPagination: Schema.optional(Schema.Boolean),
});

export type AppendSyncPage = typeof AppendSyncPage.Type;

export const RetainedSyncPage = Schema.Struct({
  generationId: Ref,
  ordinal: Schema.Int,
  requestCursor: Cursor,
  nextCursor: Cursor,
  hasMore: Schema.Boolean,
  rawDigest: Accounting.Digest,
  normalizedChangesDigest: Accounting.Digest,
  recordCount: Schema.Int,
  chainedDigest: Accounting.Digest,
  // A page that was already retained and re-offered verbatim recovers itself
  // instead of being staged twice.
  replayed: Schema.Boolean,
  // A mutation restart abandons the generation and opens a new one at the
  // published cursor. The staged pages of the abandoned generation are kept as
  // evidence and are never published.
  restarted: Schema.NullOr(Ref),
});

export type RetainedSyncPage = typeof RetainedSyncPage.Type;

// Publication names the fence the caller believes it holds. Without it a
// superseded worker could publish over a newer claim, which is the one thing
// the fence exists to prevent.
export const PublishSyncGeneration = Schema.Struct({
  generationId: Ref,
  fence: Accounting.MinorUnits,
});

export type PublishSyncGeneration = typeof PublishSyncGeneration.Type;

export const WindowPublication = Schema.Struct({
  publicationId: Ref,
  generationId: Ref,
  streamId: Ref,
  fromVersion: Accounting.MinorUnits,
  baseCursor: Cursor,
  finalCursor: Cursor,
  // The leaf returns exact counts as canonical integer strings, so they are
  // never widened to a JavaScript number on the way out.
  pageCount: Accounting.MinorUnits,
  changeCount: Accounting.MinorUnits,
  manifestDigest: Accounting.Digest,
  // False for a window whose cursor never moved. An unchanged cursor is a
  // real provider answer, and it never claims historical coverage.
  coversHistory: Schema.Boolean,
  publicationVersion: Accounting.MinorUnits,
  publishedCursor: Cursor,
  receipt: Bank.CommandReceipt,
});

export type WindowPublication = typeof WindowPublication.Type;

// What an agent or operator asks for. Only the consent is named; the window
// state is derived from retained rows, never supplied.
export const ReadSyncWindow = Schema.Struct({
  consentId: Ref,
});

export type ReadSyncWindow = typeof ReadSyncWindow.Type;

// The derived answer. A staged generation without its publication marker is
// reported as staged only, never as a reviewed bank observation.
export const SyncWindowState = Schema.Struct({
  consentId: Ref,
  streamId: Schema.NullOr(Ref),
  publishedCursor: Schema.NullOr(Cursor),
  publicationVersion: Accounting.MinorUnits,
  fence: Accounting.MinorUnits,
  currentGenerationId: Schema.NullOr(Ref),
  leaseUntil: Schema.NullOr(Schema.String),
  // An incomplete generation is resumable, with the exact cursor its next page
  // must request from.
  resumable: Schema.NullOr(
    Schema.Struct({
      generationId: Ref,
      baseCursor: Cursor,
      attemptNumber: Accounting.MinorUnits,
      requestCursor: Cursor,
      retainedPageCount: Schema.Int,
      pageEvidenceTruncated: Schema.Boolean,
    }),
  ),
  published: Schema.Array(
    Schema.Struct({
      publicationId: Ref,
      generationId: Ref,
      fromVersion: Accounting.MinorUnits,
      finalCursor: Cursor,
      pageCount: Schema.Int,
      changeCount: Schema.Int,
      coversHistory: Schema.Boolean,
      publishedAt: Schema.String,
    }),
  ).check(Schema.isMaxLength(20)),
  // The retained pages of the current generation, with the exact chain.
  retainedPages: Schema.Array(
    Schema.Struct({
      ordinal: Schema.Int,
      requestCursor: Cursor,
      nextCursor: Cursor,
      hasMore: Schema.Boolean,
      recordCount: Schema.Int,
      rawDigest: Accounting.Digest,
      rawByteLength: Schema.Int,
      chainedDigest: Accounting.Digest,
    }),
  ).check(Schema.isMaxLength(200)),
  // No publication marker means the staged changes are not canonical. A
  // reader must never see them as a statement.
  canonical: Schema.Boolean,
  acknowledgement: Schema.Literals([
    "published_generation",
    "staged_only_no_publication_marker",
    "no_generation",
  ]),
});

export type SyncWindowState = typeof SyncWindowState.Type;

const path = "/v1/entities/:entityId/books/:bookId/banking/sync-windows";

export const BankSyncWindowsApi = HttpApiGroup.make("bankSyncWindows")
  .add(
    HttpApiEndpoint.post("claimSyncWindow", path, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: ClaimSyncWindow.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: WindowClaimState,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("appendSyncPage", `${path}/pages`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: AppendSyncPage.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: RetainedSyncPage,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("publishSyncGeneration", `${path}/publications`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: PublishSyncGeneration.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: WindowPublication,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("readSyncWindow", `${path}/state`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: ReadSyncWindow.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: SyncWindowState,
      error: errors,
    }),
  );

// Agent surface. Read-only: an agent may ask what a connector stream has
// actually published and whether a window is resumable. It may not claim a
// window, stage a page or publish a generation, because those are the claims
// that decide what becomes a reviewed bank observation, and a lease is not
// something a second agent process may take.
export const BankSyncWindowsCapabilities = {
  banking_read_sync_window: {
    description:
      "Read one bank connector stream's sync window state: the published cursor and its version, the publication markers with their page and change counts, whether historical coverage is claimed, the retained page chain of a resumable generation, and whether the staged changes are canonical. A generation without a publication marker is reported as staged only.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: ReadSyncWindow,
    }),
    output: SyncWindowState,
    readOnly: true,
  },
};
