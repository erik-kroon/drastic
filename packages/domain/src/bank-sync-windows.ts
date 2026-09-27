import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Digest, Identifier } from "./values";
import { MinorUnits } from "./money";

// Pure sync-window math for one bank connector stream.
// NEXT-09 leaf: provider page interpretation and complete-generation
// publication validation. No HTTP, no storage, no credentials: the
// application owns the short claim/page/publication transactions, the
// persistent Bun job owns remote calls, and the existing connector owner
// keeps consent, batch and record intake. A bound failure is an error
// rather than a partial or overwritten publication.

export const SyncFailureCode = Schema.Literals([
  "SyncBusy",
  "ConsentInvalid",
  "MappingChanged",
  "StaleFence",
  "VersionMoved",
  "CursorMoved",
  "GapInPages",
  "ChainBroken",
  "UnterminatedWindow",
  "DigestMismatch",
  "PageConflict",
  "MutationRestartExhausted",
  "IdempotencyConflict",
  "AlreadyPublished",
  "NonPositiveCount",
]);

export type SyncFailureCode = typeof SyncFailureCode.Type;

export const SyncFailure = Schema.Struct({
  code: SyncFailureCode,
  message: Description,
});

export type SyncFailure = typeof SyncFailure.Type;

export type Checked<A> = Result.Result<A, SyncFailure>;

function fail(code: SyncFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

export const ProviderCursor = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));

export const ChangeKind = Schema.Literals(["added", "modified", "removed"]);

export type ChangeKind = typeof ChangeKind.Type;

export const CandidateChange = Schema.Struct({
  generationId: Identifier,
  pageOrdinal: MinorUnits,
  recordOrdinal: MinorUnits,
  kind: ChangeKind,
  sourceId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  rawLocator: Identifier,
});

export type CandidateChange = typeof CandidateChange.Type;

export const SyncPage = Schema.Struct({
  generationId: Identifier,
  ordinal: MinorUnits,
  requestCursor: ProviderCursor,
  nextCursor: ProviderCursor,
  hasMore: Schema.Boolean,
  rawDigest: Digest,
  normalizedChangesDigest: Digest,
  recordCount: MinorUnits,
  chainedDigest: Digest,
});

export type SyncPage = typeof SyncPage.Type;

export const SyncGeneration = Schema.Struct({
  id: Identifier,
  streamId: Identifier,
  baseCursor: ProviderCursor,
  basePublicationVersion: MinorUnits,
  attemptNumber: MinorUnits,
  fence: MinorUnits,
});

export type SyncGeneration = typeof SyncGeneration.Type;

export const ClaimInput = Schema.Struct({
  streamId: Identifier,
  publishedCursor: ProviderCursor,
  publicationVersion: MinorUnits,
  fence: MinorUnits,
  consentValid: Schema.Boolean,
  streamMappingUnchanged: Schema.Boolean,
  activeLeaseUnexpired: Schema.Boolean,
  incompleteGeneration: Schema.NullOr(SyncGeneration),
  commandKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});

export type ClaimInput = typeof ClaimInput.Type;

export const WindowClaim = Schema.Struct({
  generation: SyncGeneration,
  fence: MinorUnits,
  resumed: Schema.Boolean,
  commandKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});

export type WindowClaim = typeof WindowClaim.Type;

function nextMinor(value: string) {
  return (BigInt(value) + 1n).toString();
}

// A claim never calls the provider. It fences the stream and either resumes
// the incomplete generation with its base cursor and staged pages or starts
// a fresh generation at the published cursor.
export function claimWindow(input: ClaimInput): Checked<WindowClaim> {
  if (!input.consentValid) {
    return fail("ConsentInvalid", "The stream consent is not currently valid.");
  }

  if (!input.streamMappingUnchanged) {
    return fail("MappingChanged", "The stream or account mapping changed since admission.");
  }

  if (input.activeLeaseUnexpired) {
    return fail("SyncBusy", "Another unexpired lease holds this stream.");
  }

  const fence = nextMinor(input.fence);
  const resumed = input.incompleteGeneration;

  if (resumed !== null) {
    return Result.succeed({
      generation: { ...resumed, fence },
      fence,
      resumed: true,
      commandKey: input.commandKey,
    });
  }

  return Result.succeed({
    generation: {
      id: `gen-${input.commandKey}`,
      streamId: input.streamId,
      baseCursor: input.publishedCursor,
      basePublicationVersion: input.publicationVersion,
      attemptNumber: "0",
      fence,
    },
    fence,
    resumed: false,
    commandKey: input.commandKey,
  });
}

export const AppendPageInput = Schema.Struct({
  generation: SyncGeneration,
  fence: MinorUnits,
  leaseValid: Schema.Boolean,
  retainedPages: Schema.Array(SyncPage),
  page: SyncPage,
});

export type AppendPageInput = typeof AppendPageInput.Type;

// Appending checks fence, generation, expected ordinal and cursor. An
// identical retained page replays; a different raw response for a saved
// page conflicts and never overwrites retained evidence.
export function appendPage(input: AppendPageInput): Checked<SyncPage> {
  if (!input.leaseValid) {
    return fail("StaleFence", "The window lease is no longer valid.");
  }

  if (input.page.generationId !== input.generation.id) {
    return fail("StaleFence", "The page belongs to a different generation.");
  }

  if (input.generation.fence !== input.fence) {
    return fail("StaleFence", "The page was prepared under a superseded fence.");
  }

  const expectedOrdinal = BigInt(input.retainedPages.length);
  const ordinal = BigInt(input.page.ordinal);

  if (ordinal < expectedOrdinal) {
    const retained = input.retainedPages[Number(ordinal)];

    if (
      retained !== undefined &&
      retained.rawDigest === input.page.rawDigest &&
      retained.nextCursor === input.page.nextCursor
    ) {
      return Result.succeed(retained);
    }

    return fail(
      "PageConflict",
      "A different raw response for an already saved page cannot overwrite it.",
    );
  }

  if (ordinal > expectedOrdinal) {
    return fail("GapInPages", "Pages must be appended in contiguous ordinal order.");
  }

  const expectedCursor =
    input.retainedPages.length === 0
      ? input.generation.baseCursor
      : input.retainedPages[input.retainedPages.length - 1]?.nextCursor;

  if (input.page.requestCursor !== expectedCursor) {
    return fail("ChainBroken", "The page request cursor does not continue the retained chain.");
  }

  return Result.succeed(input.page);
}

export const MutationInput = Schema.Struct({
  streamId: Identifier,
  publishedCursor: ProviderCursor,
  publicationVersion: MinorUnits,
  fence: MinorUnits,
  attemptNumber: MinorUnits,
  maximumRestarts: MinorUnits,
  commandKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});

export type MutationInput = typeof MutationInput.Type;

// A provider mutation during pagination abandons the current generation and
// begins a new one at the published cursor captured for this window: the
// same original base, never the failed page cursor, an empty cursor or now.
export function restartAfterMutation(input: MutationInput): Checked<SyncGeneration> {
  const attempt = BigInt(input.attemptNumber);
  const maximum = BigInt(input.maximumRestarts);

  if (attempt + 1n > maximum) {
    return fail(
      "MutationRestartExhausted",
      "The bounded mutation-restart budget for this window is exhausted.",
    );
  }

  return Result.succeed({
    id: `gen-${input.commandKey}-r${(attempt + 1n).toString()}`,
    streamId: input.streamId,
    baseCursor: input.publishedCursor,
    basePublicationVersion: input.publicationVersion,
    attemptNumber: (attempt + 1n).toString(),
    fence: input.fence,
  });
}

export const PublishInput = Schema.Struct({
  generation: SyncGeneration,
  fence: MinorUnits,
  leaseValid: Schema.Boolean,
  consentValid: Schema.Boolean,
  currentPublicationVersion: MinorUnits,
  currentPublishedCursor: ProviderCursor,
  pages: Schema.Array(SyncPage),
  candidateCount: MinorUnits,
  manifestDigest: Digest,
  commandKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});

export type PublishInput = typeof PublishInput.Type;

export const GenerationPublication = Schema.Struct({
  generationId: Identifier,
  streamId: Identifier,
  fromVersion: MinorUnits,
  baseCursor: ProviderCursor,
  finalCursor: ProviderCursor,
  pageCount: MinorUnits,
  changeCount: MinorUnits,
  manifestDigest: Digest,
  coversHistory: Schema.Boolean,
  commandKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});

export type GenerationPublication = typeof GenerationPublication.Type;

// Publication validates the complete generation: current fence, lease and
// consent, exact base versions, contiguous pages, the exact cursor chain, a
// terminal page with hasMore=false, and agreement of the acknowledged
// manifests and candidate counts. An unchanged-cursor empty window publishes
// a zero-change marker that covers only the window, never history.
export function publishGeneration(input: PublishInput): Checked<GenerationPublication> {
  if (!input.leaseValid) {
    return fail("StaleFence", "The window lease is no longer valid at publication.");
  }

  if (input.fence !== input.generation.fence) {
    return fail("StaleFence", "A superseded fence cannot publish over a newer claim.");
  }

  if (!input.consentValid) {
    return fail("ConsentInvalid", "Consent revocation blocks publication of new pages.");
  }

  if (input.currentPublicationVersion !== input.generation.basePublicationVersion) {
    return fail("VersionMoved", "The publication version moved since the generation began.");
  }

  if (input.currentPublishedCursor !== input.generation.baseCursor) {
    return fail("CursorMoved", "The published cursor moved since the generation began.");
  }

  if (input.pages.length === 0) {
    return fail("GapInPages", "A publication needs at least one retained page.");
  }

  let expectedCursor = input.generation.baseCursor;
  let records = 0n;

  for (let index = 0; index < input.pages.length; index += 1) {
    const page = input.pages[index];

    if (page === undefined) {
      return fail("GapInPages", "A retained page is missing from the generation.");
    }

    if (BigInt(page.ordinal) !== BigInt(index)) {
      return fail("GapInPages", "Retained pages are not contiguous from ordinal zero.");
    }

    if (page.generationId !== input.generation.id) {
      return fail("StaleFence", "A retained page belongs to a different generation.");
    }

    if (page.requestCursor !== expectedCursor) {
      return fail("ChainBroken", "The retained cursor chain does not link exactly.");
    }

    records += BigInt(page.recordCount);
    expectedCursor = page.nextCursor;

    const terminal = index === input.pages.length - 1;

    if (!terminal && page.hasMore !== true) {
      return fail("ChainBroken", "A non-terminal page must carry hasMore=true.");
    }

    if (terminal && page.hasMore !== false) {
      return fail("UnterminatedWindow", "The terminal page must carry hasMore=false.");
    }
  }

  if (records !== BigInt(input.candidateCount)) {
    return fail(
      "DigestMismatch",
      "The retained page records do not agree with the candidate count.",
    );
  }

  const terminal = input.pages[input.pages.length - 1];

  if (terminal === undefined) {
    return fail("DigestMismatch", "The terminal page carries no acknowledged manifest.");
  }

  const unchanged = expectedCursor === input.generation.baseCursor;

  return Result.succeed({
    generationId: input.generation.id,
    streamId: input.generation.streamId,
    fromVersion: input.generation.basePublicationVersion,
    baseCursor: input.generation.baseCursor,
    finalCursor: expectedCursor,
    pageCount: input.pages.length.toString(),
    changeCount: records.toString(),
    manifestDigest: input.manifestDigest,
    coversHistory: !unchanged,
    commandKey: input.commandKey,
  });
}

export const ReplayPublicationInput = Schema.Struct({
  existingCommandKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  commandKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  existingManifestDigest: Digest,
  manifestDigest: Digest,
  existingPublication: GenerationPublication,
});

export type ReplayPublicationInput = typeof ReplayPublicationInput.Type;

// A crash after the marker commit recovers the same receipt through the
// original command: same key and manifest replays, anything else refuses.
export function replayPublication(input: ReplayPublicationInput): Checked<GenerationPublication> {
  if (input.commandKey !== input.existingCommandKey) {
    return fail(
      "AlreadyPublished",
      "A different key cannot publish a generation that already has a marker.",
    );
  }

  if (input.manifestDigest !== input.existingManifestDigest) {
    return fail(
      "IdempotencyConflict",
      "The same command key carries a different publication manifest.",
    );
  }

  return Result.succeed(input.existingPublication);
}

export const PageDigestCheck = Schema.Struct({
  acknowledgedManifests: Schema.Array(Digest),
  candidateDigests: Schema.Array(Digest),
});

export type PageDigestCheck = typeof PageDigestCheck.Type;

// Every acknowledged content manifest must have its candidate digest; a
// count match alone does not prove agreement.
export function assertManifestAgreement(input: PageDigestCheck): Checked<PageDigestCheck> {
  if (input.acknowledgedManifests.length !== input.candidateDigests.length) {
    return fail(
      "NonPositiveCount",
      "Acknowledged manifests and candidate digests disagree in number.",
    );
  }

  const candidates = new Set(input.candidateDigests);

  for (const manifest of input.acknowledgedManifests) {
    if (!candidates.has(manifest)) {
      return fail("DigestMismatch", "An acknowledged manifest has no matching candidate digest.");
    }
  }

  return Result.succeed(input);
}
