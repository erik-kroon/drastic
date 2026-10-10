import { runBookCommandWithReceipt } from "../book-commands";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Sync from "@open-erp/contracts/bank-sync-windows";
import {
  appendPage as appendWindowPage,
  claimWindow as compileWindowClaim,
  publishGeneration as compileWindowPublication,
  replayPublication as compileWindowReplay,
  restartAfterMutation as compileWindowRestart,
  type SyncGeneration,
  type SyncPage,
} from "@open-erp/domain/bank-sync-windows";
import * as SyncWindows from "@open-erp/domain/bank-sync-windows";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { digest } from "../json";
import { newId } from "../identifiers";
import { replay, saveCommand } from "../command-receipts";
import { sha256Hex } from "../hashing";
import * as ConnectorDb from "../../db/banking/connector";
import * as BankDb from "../../db/banking/shared";
import * as SyncDb from "../../db/banking/sync-windows";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;

type Json = Schema.Json;

type JsonObject = Schema.JsonObject;

// A claim, a page append and a publication are three short transactions. The
// provider call lives in the persistent Bun job outside all three, so no
// connection or transaction is ever held across an HTTP request.
const windowTables = [
  "books",
  "accounts",
  "bank_connector_consents",
  "bank_sync_streams",
  "bank_sync_generations",
  "bank_sync_pages",
  "bank_sync_candidates",
  "bank_sync_publications",
  "intake_contents",
  "command_receipts",
];

const windowInserts = [
  "bank_sync_streams",
  "bank_sync_generations",
  "bank_sync_pages",
  "bank_sync_candidates",
  "bank_sync_publications",
  "intake_contents",
  "command_receipts",
];

const windowUpdates = ["bank_sync_streams"];

const windowColumns = [
  "bank_sync_streams.published_cursor",
  "bank_sync_streams.publication_version",
  "bank_sync_streams.current_generation_id",
  "bank_sync_streams.fence",
  "bank_sync_streams.lease_until",
];

// A bounded window. A resumed claim keeps its base cursor and staged pages, so
// the bound is what stops a stream that never reaches a terminal page from
// growing a generation without limit.
const defaultMaximumPages = 200;

const maximumRestarts = 3;

const leaseMilliseconds = 300_000;

const maximumRawBytes = 65536;

// A leaf refusal becomes the repository's typed failure vocabulary, with the
// leaf's own message retained as the cause. One generic "invalid journal" for
// every case would hide which bound actually refused. The map is closed over
// the leaf's own failure codes, so a new leaf code cannot fall through to a
// generic refusal without this failing to compile.
const refusalFailure = {
  SyncBusy: "ApprovalRequired",
  ConsentInvalid: "ApprovalRequired",
  MappingChanged: "StaleDependency",
  StaleFence: "StaleDependency",
  VersionMoved: "StaleDependency",
  CursorMoved: "StaleDependency",
  GapInPages: "InvalidJournal",
  ChainBroken: "InvalidJournal",
  UnterminatedWindow: "InvalidJournal",
  DigestMismatch: "IdempotencyConflict",
  PageConflict: "IdempotencyConflict",
  MutationRestartExhausted: "ApprovalRequired",
  IdempotencyConflict: "IdempotencyConflict",
  AlreadyPublished: "AlreadyPosted",
  NonPositiveCount: "IdempotencyConflict",
} satisfies Record<SyncWindows.SyncFailureCode, typeof Accounting.FailureCode.Type>;

// The leaf's own failure type, so a refusal code this owner does not map is a
// compile error rather than a silent default.
type LeafRefusal = { readonly code: SyncWindows.SyncFailureCode; readonly message: string };

function refuse(outcome: LeafRefusal) {
  return failure(refusalFailure[outcome.code], outcome.message);
}

function checked<A>(value: Result.Result<A, LeafRefusal>) {
  return Effect.gen(function* () {
    if (Result.isFailure(value)) return yield* refuse(value.failure);

    return value.success;
  });
}

function leaseIsHeld(leaseUntil: string | null, at: number) {
  return leaseUntil !== null && Date.parse(leaseUntil) > at;
}

// The mutation paths take the consent row for update so the claim, the page
// and the publication each see one current consent. The read path must not:
// a shared-lock read cannot take a row lock, so it uses the plain read.
// The read path must not take a row lock: a shared-lock read cannot. It uses
// the connector owner's plain consent read instead.
function readConsentShared(transaction: Transaction, bookId: string, consentId: string) {
  return ConnectorDb.readConsent(transaction, bookId, consentId).pipe(
    Effect.flatMap((rows) => {
      const consent = rows[0];

      return consent ? Effect.succeed(consent) : failure("NotFound");
    }),
  );
}

// The mutation paths take the consent row for update so the claim, the page
// and the publication each see exactly one current consent.
function readConsent(transaction: Transaction, bookId: string, consentId: string) {
  return ConnectorDb.readConsentForUpdate(transaction, bookId, consentId).pipe(
    Effect.flatMap((rows) => {
      const consent = rows[0];

      return consent ? Effect.succeed(consent) : failure("NotFound");
    }),
  );
}

// A claim requires a currently valid consent and an account that is still
// active. Both are read from retained rows, never supplied: a caller cannot
// assert that the consent it names is still good.
function consentAdmitsWindow(
  transaction: Transaction,
  bookId: string,
  consent: ConnectorDb.ConsentRow,
) {
  return Effect.gen(function* () {
    if (consent.revokedAt !== null) return false;

    const account = (yield* BankDb.readAccount(transaction, bookId, consent.accountId))[0];

    return account?.active === true;
  });
}

// The fence lives on the stream pointer, not on the immutable generation row.
// A resumed generation is therefore valid under the stream's *current* fence,
// and a worker presenting a superseded one is refused by the leaf.
function generationOf(row: SyncDb.GenerationRow, currentFence: string): SyncGeneration {
  return {
    id: row.id,
    streamId: row.streamId,
    baseCursor: row.baseCursor,
    basePublicationVersion: row.basePublicationVersion,
    attemptNumber: row.attemptNumber,
    fence: currentFence,
  };
}

function pageOf(row: SyncDb.PageRow): SyncPage {
  return {
    generationId: row.generationId,
    ordinal: String(row.ordinal),
    requestCursor: row.requestCursor,
    nextCursor: row.nextCursor,
    hasMore: row.hasMore,
    rawDigest: row.rawDigest,
    normalizedChangesDigest: row.normalizedChangesDigest,
    recordCount: String(row.recordCount),
    chainedDigest: row.chainedDigest,
  };
}

function pageBody(page: SyncPage, replayed: boolean, restarted: string | null): JsonObject {
  return {
    generationId: page.generationId,
    ordinal: Number(page.ordinal),
    requestCursor: page.requestCursor,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    rawDigest: page.rawDigest,
    normalizedChangesDigest: page.normalizedChangesDigest,
    recordCount: Number(page.recordCount),
    chainedDigest: page.chainedDigest,
    replayed,
    restarted,
  } satisfies JsonObject;
}

// The exact normalized change list, canonicalised. Publication later compares
// this digest against the staged candidate rows, so a page cannot commit to
// one change list and stage another.
function changesDigest(changes: ReadonlyArray<Sync.SyncChangeInput>) {
  return digest({
    changes: changes.map((change) => ({
      kind: change.kind,
      sourceId: change.sourceId,
      rawLocator: change.rawLocator,
    })),
  } satisfies JsonObject);
}

function chainedDigestOf(previous: string, page: Omit<SyncPage, "chainedDigest">) {
  return digest({
    previous,
    generationId: page.generationId,
    ordinal: page.ordinal,
    requestCursor: page.requestCursor,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    rawDigest: page.rawDigest,
    normalizedChangesDigest: page.normalizedChangesDigest,
    recordCount: page.recordCount,
  } satisfies JsonObject);
}

function manifestDigestOf(pages: ReadonlyArray<SyncPage>) {
  return digest({
    pages: pages.map((page) => ({
      ordinal: page.ordinal,
      requestCursor: page.requestCursor,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      rawDigest: page.rawDigest,
      normalizedChangesDigest: page.normalizedChangesDigest,
      recordCount: page.recordCount,
      chainedDigest: page.chainedDigest,
    })),
  } satisfies JsonObject);
}

function claimBody(
  stream: SyncDb.StreamRow,
  generation: SyncGeneration,
  resumed: boolean,
  requestCursor: string,
  retainedPageCount: number,
  leaseUntil: string,
  actorId: string,
  key: string,
): JsonObject {
  return {
    streamId: stream.id,
    consentId: stream.consentId,
    generationId: generation.id,
    baseCursor: generation.baseCursor,
    basePublicationVersion: generation.basePublicationVersion,
    attemptNumber: generation.attemptNumber,
    fence: generation.fence,
    resumed,
    requestCursor,
    retainedPageCount,
    leaseUntil,
    publicationVersion: stream.publicationVersion,
    publishedCursor: stream.publishedCursor,
    receipt: Shared.receipt(key, "claim_bank_sync_window", actorId),
  } satisfies JsonObject;
}

function publicationBody(
  row: SyncDb.PublicationRow,
  publicationVersion: string,
  actorId: string,
  key: string,
): JsonObject {
  return {
    publicationId: row.id,
    generationId: row.generationId,
    streamId: row.streamId,
    fromVersion: row.fromVersion,
    baseCursor: row.baseCursor,
    finalCursor: row.finalCursor,
    pageCount: String(row.pageCount),
    changeCount: String(row.changeCount),
    manifestDigest: row.manifestDigest,
    coversHistory: row.coversHistory,
    publicationVersion,
    publishedCursor: row.finalCursor,
    receipt: Shared.receipt(key, "publish_bank_sync_generation", actorId),
  } satisfies JsonObject;
}

export const claimSyncWindow = Effect.fn("banking.sync.claimWindow")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: Sync.ClaimSyncWindow;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, windowTables, windowInserts, windowUpdates);
      yield* Shared.requireColumns(transaction, windowColumns);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "update"))[0];

      if (!book) return yield* failure("Forbidden");

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "claim_bank_sync_window",
        principal.actorId,
        yield* Shared.toJsonObject(command.input),
        Sync.WindowClaimState,
      );

      if (request.previous) return request.previous;

      const consent = yield* readConsent(
        transaction,
        command.scope.bookId,
        command.input.consentId,
      );

      if (!(yield* consentAdmitsWindow(transaction, command.scope.bookId, consent))) {
        return yield* failure("ApprovalRequired");
      }

      const streamId = `syncstream_${consent.id.replace(/^connectorconsent_?/, "")}`;
      yield* SyncDb.insertStream(transaction, {
        bookId: command.scope.bookId,
        id: streamId,
        consentId: consent.id,
      });
      const locked = (yield* SyncDb.lockStream(transaction, command.scope.bookId, consent.id))[0];

      if (!locked) return yield* failure("InternalError");

      const incomplete = (yield* SyncDb.readIncompleteGeneration(
        transaction,
        command.scope.bookId,
        locked.id,
      ))[0];

      const claim = yield* checked(
        compileWindowClaim({
          streamId: locked.id,
          publishedCursor: locked.publishedCursor,
          publicationVersion: locked.publicationVersion,
          fence: locked.fence,
          consentValid: consent.revokedAt === null,
          streamMappingUnchanged: true,
          // An unexpired lease blocks a second claimant only while there is
          // something to protect. Once the stream's generation has published,
          // the previous window is finished and its lease no longer holds
          // anything: blocking the next window on it would strand the stream
          // until the lease timed out. An expired one is taken over by bumping
          // the fence, so the previous worker's own appends and publication
          // refuse rather than interleave.
          activeLeaseUnexpired:
            incomplete !== undefined && leaseIsHeld(locked.leaseUntil, Date.now()),
          incompleteGeneration:
            incomplete === undefined ? null : generationOf(incomplete, locked.fence),
          commandKey: command.idempotencyKey,
        }),
      );

      const pages =
        claim.resumed && incomplete !== undefined
          ? yield* SyncDb.readPages(transaction, command.scope.bookId, incomplete.id)
          : [];

      if (pages.length > (command.input.maximumPages ?? defaultMaximumPages)) {
        return yield* failure("ApprovalRequired");
      }

      const leaseUntil = new Date(Date.now() + leaseMilliseconds).toISOString();

      yield* SyncDb.claimStream(transaction, {
        bookId: command.scope.bookId,
        streamId: locked.id,
        fence: claim.fence,
        leaseUntil,
      });

      if (claim.resumed && incomplete !== undefined) {
        // A resumed window keeps its base cursor and its staged pages. Only the
        // fence moves, and it moves on the stream pointer.

        yield* SyncDb.setCurrentGeneration(transaction, {
          bookId: command.scope.bookId,
          streamId: locked.id,
          generationId: incomplete.id,
        });
      } else {
        yield* SyncDb.insertGeneration(transaction, {
          bookId: command.scope.bookId,
          id: claim.generation.id,
          streamId: locked.id,
          baseCursor: claim.generation.baseCursor,
          basePublicationVersion: claim.generation.basePublicationVersion,
          attemptNumber: claim.generation.attemptNumber,
          fence: claim.generation.fence,
        });
        yield* SyncDb.setCurrentGeneration(transaction, {
          bookId: command.scope.bookId,
          streamId: locked.id,
          generationId: claim.generation.id,
        });
      }

      // The next page must be requested from the last retained page's next
      // cursor, or the generation's base cursor when nothing is staged yet. It
      // is derived from retained rows, never taken from the request.
      const requestCursor =
        pages.length > 0
          ? (pages[pages.length - 1]?.nextCursor ?? claim.generation.baseCursor)
          : claim.generation.baseCursor;

      const body = claimBody(
        { ...locked, fence: claim.fence },
        claim.generation,
        claim.resumed,
        requestCursor,
        pages.length,
        leaseUntil,
        principal.actorId,
        command.idempotencyKey,
      );

      const state = yield* Shared.decode(Sync.WindowClaimState, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "claim_bank_sync_window",
        principal.actorId,
        yield* Shared.toJsonObject(state),
      );

      return state;
    }),
  );
});

export const appendSyncPage = Effect.fn("banking.sync.appendPage")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: Sync.AppendSyncPage;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, windowTables, windowInserts, windowUpdates);
      yield* Shared.requireColumns(transaction, windowColumns);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "update"))[0];

      if (!book) return yield* failure("Forbidden");

      return yield* runBookCommandWithReceipt(
        transaction,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: "append_bank_sync_page",
          actorId: principal.actorId,
          input: yield* Shared.toJsonObject(command.input),
        },
        Sync.RetainedSyncPage,
        Effect.gen(function* () {
          const input = command.input;
          const rawBytes = Shared.byteLength(input.raw);

          if (rawBytes < 1 || rawBytes > maximumRawBytes) return yield* failure("InvalidJournal");

          const generation = (yield* SyncDb.readGeneration(
            transaction,
            command.scope.bookId,
            input.generationId,
          ))[0];

          if (!generation) return yield* failure("NotFound");

          const claimed = (yield* SyncDb.lockStreamByGeneration(
            transaction,
            command.scope.bookId,
            generation.streamId,
          ))[0];

          if (!claimed) return yield* failure("InternalError");

          const consent = yield* readConsent(transaction, command.scope.bookId, claimed.consentId);

          // Consent revocation blocks new pages. It does not erase the pages
          // already retained, and it does not delete a staged generation.
          if (consent.revokedAt !== null) return yield* failure("ApprovalRequired");

          const retained = yield* SyncDb.readPages(
            transaction,
            command.scope.bookId,
            generation.id,
          );

          // The raw digest is computed from the bytes actually held here, so a
          // caller cannot assert a digest about content it does not prove. The
          // ordinal is the caller's, so a re-offer after a crash reaches the leaf
          // as a replay rather than being guessed at.
          const proposed: Omit<SyncPage, "chainedDigest"> = {
            generationId: generation.id,
            ordinal: String(input.ordinal),
            requestCursor: input.requestCursor,
            nextCursor: input.nextCursor,
            hasMore: input.hasMore,
            rawDigest: `sha256:${yield* sha256Hex(input.raw)}`,
            normalizedChangesDigest: yield* changesDigest(input.changes),
            recordCount: String(input.changes.length),
          };

          // The chain digest links to the page this one follows, which is the
          // retained page before this ordinal, not simply the newest one.
          const prior = input.ordinal > 0 ? retained[input.ordinal - 1] : undefined;

          const page: SyncPage = {
            ...proposed,
            chainedDigest: yield* chainedDigestOf(
              prior?.chainedDigest ?? proposed.rawDigest,
              proposed,
            ),
          };

          // The leaf decides everything about this page: contiguous ordinal, the
          // exact cursor chain, replay of an identical retained page, and refusal
          // of a different raw response for one already retained. The owner never
          // overwrites that evidence and never resolves the case itself.
          const appended = yield* checked(
            appendWindowPage({
              generation: generationOf(generation, claimed.fence),
              fence: input.fence,
              leaseValid: leaseIsHeld(claimed.leaseUntil, Date.now()),
              retainedPages: retained.map(pageOf),
              page,
            }),
          );

          const replayed = input.ordinal < retained.length;

          if (!replayed) {
            // A terminal page that neither moved the cursor nor reported no
            // changes is not a provider answer the chain can express.

            if (
              !appended.hasMore &&
              appended.nextCursor === appended.requestCursor &&
              appended.recordCount !== "0"
            ) {
              return yield* failure("InvalidJournal");
            }

            yield* SyncDb.insertContent(transaction, {
              bookId: command.scope.bookId,
              sha256: appended.rawDigest,
              bytes: input.raw,
            });
            yield* SyncDb.insertPage(transaction, {
              bookId: command.scope.bookId,
              generationId: generation.id,
              ordinal: Number(appended.ordinal),
              requestCursor: appended.requestCursor,
              nextCursor: appended.nextCursor,
              hasMore: appended.hasMore,
              rawDigest: appended.rawDigest,
              rawByteLength: rawBytes,
              normalizedChangesDigest: appended.normalizedChangesDigest,
              recordCount: Number(appended.recordCount),
              chainedDigest: appended.chainedDigest,
            });

            if (input.changes.length > 0) {
              yield* SyncDb.insertCandidates(transaction, {
                bookId: command.scope.bookId,
                generationId: generation.id,
                pageOrdinal: Number(appended.ordinal),
                candidates: input.changes.map((change) => ({
                  kind: change.kind,
                  sourceId: change.sourceId,
                  rawLocator: change.rawLocator,
                })),
              });
            }
          }

          let restarted: string | null = null;

          if (input.mutationDuringPagination === true) {
            // A provider mutation during pagination abandons this generation and
            // begins a new one at the published cursor captured for this window:
            // the same original base, never the failed page cursor.

            const next = yield* checked(
              compileWindowRestart({
                streamId: claimed.id,
                publishedCursor: claimed.publishedCursor,
                publicationVersion: claimed.publicationVersion,
                fence: claimed.fence,
                attemptNumber: generation.attemptNumber,
                maximumRestarts: String(maximumRestarts),
                commandKey: command.idempotencyKey,
              }),
            );

            yield* SyncDb.insertGeneration(transaction, {
              bookId: command.scope.bookId,
              id: next.id,
              streamId: claimed.id,
              baseCursor: next.baseCursor,
              basePublicationVersion: next.basePublicationVersion,
              attemptNumber: next.attemptNumber,
              fence: next.fence,
            });
            yield* SyncDb.setCurrentGeneration(transaction, {
              bookId: command.scope.bookId,
              streamId: claimed.id,
              generationId: next.id,
            });
            restarted = next.id;
          }

          const pageResult = yield* Shared.decode(
            Sync.RetainedSyncPage,
            pageBody(appended, replayed, restarted),
          );

          return { receipt: yield* Shared.toJsonObject(pageResult), result: pageResult };
        }),
      );
    }),
  );
});

export const publishSyncGeneration = Effect.fn("banking.sync.publishGeneration")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: Sync.PublishSyncGeneration;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, windowTables, windowInserts, windowUpdates);
      yield* Shared.requireColumns(transaction, windowColumns);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "update"))[0];

      if (!book) return yield* failure("Forbidden");

      // A crash after the marker commit is answered from the receipt, so the
      // same command returns its own publication instead of minting a second.
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "publish_bank_sync_generation",
        principal.actorId,
        yield* Shared.toJsonObject(command.input),
        Sync.WindowPublication,
      );

      if (request.previous) return request.previous;

      const generation = (yield* SyncDb.readGeneration(
        transaction,
        command.scope.bookId,
        command.input.generationId,
      ))[0];

      if (!generation) return yield* failure("NotFound");

      const claimed = (yield* SyncDb.lockStreamByGeneration(
        transaction,
        command.scope.bookId,
        generation.streamId,
      ))[0];

      if (!claimed) return yield* failure("InternalError");

      const consent = yield* readConsent(transaction, command.scope.bookId, claimed.consentId);
      const pages = yield* SyncDb.readPages(transaction, command.scope.bookId, generation.id);
      const compiled = pages.map(pageOf);

      // A generation that already carries a marker is answered before any
      // publication is compiled. After a successful publication the stream's
      // published cursor has moved, so re-deriving a publication from the
      // retained pages would refuse a state that in fact already succeeded.
      // Only the original command recovers it, and only with its own manifest.
      const existing = (yield* SyncDb.readPublicationByGeneration(
        transaction,
        command.scope.bookId,
        generation.id,
      ))[0];

      if (existing) {
        // The leaf decides whether this command may recover the marker: the
        // same key with the same manifest, and nothing else.
        yield* checked(
          compileWindowReplay({
            existingCommandKey: existing.commandKey,
            commandKey: command.idempotencyKey,
            existingManifestDigest: existing.manifestDigest,
            manifestDigest: yield* manifestDigestOf(compiled),
            existingPublication: {
              generationId: existing.generationId,
              streamId: existing.streamId,
              fromVersion: existing.fromVersion,
              baseCursor: existing.baseCursor,
              finalCursor: existing.finalCursor,
              pageCount: String(existing.pageCount),
              changeCount: String(existing.changeCount),
              manifestDigest: existing.manifestDigest,
              coversHistory: existing.coversHistory,
              commandKey: existing.commandKey,
            },
          }),
        );

        const body = publicationBody(
          existing,
          // The version this publication produced, recovered from the version
          // it moved from rather than read from the stream, which may have
          // advanced again since.
          (BigInt(existing.fromVersion) + 1n).toString(),
          principal.actorId,
          command.idempotencyKey,
        );

        const replayed = yield* Shared.decode(Sync.WindowPublication, body);

        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "publish_bank_sync_generation",
          principal.actorId,
          body,
        );

        return replayed;
      }

      const candidateCount = (yield* SyncDb.readCandidateCount(
        transaction,
        command.scope.bookId,
        generation.id,
      ))[0]?.count;

      if (candidateCount === undefined) return yield* failure("InternalError");

      // Every retained page must still hash to what it committed to. The
      // digest is recomputed here from the staged candidate rows rather than
      // read back from the page row, so this is a real check: a generation
      // whose staged rows no longer match the page that retained them refuses
      // rather than publishing a manifest that describes nothing.
      const staged = new Map<number, ReadonlyArray<SyncDb.CandidateRow>>();

      for (const row of yield* SyncDb.readCandidatesByPage(
        transaction,
        command.scope.bookId,
        generation.id,
      )) {
        const rows = staged.get(row.pageOrdinal) ?? [];
        staged.set(row.pageOrdinal, [...rows, row]);
      }

      for (const row of pages) {
        // The change kind comes back as text. It is decoded against the leaf's
        // own vocabulary here rather than cast, so an unexpected value in a
        // retained row refuses the publication instead of silently hashing to
        // a digest nobody can interpret.
        const rows = (staged.get(row.ordinal) ?? []).map((candidate) => ({
          kind: Schema.decodeUnknownSync(SyncWindows.ChangeKind)(candidate.kind),
          sourceId: candidate.sourceId,
          rawLocator: candidate.rawLocator,
        }));

        const recomputed = yield* changesDigest(rows);

        if (recomputed !== row.normalizedChangesDigest) {
          return yield* failure("IdempotencyConflict");
        }
      }

      const manifest = yield* manifestDigestOf(compiled);

      const publication = yield* checked(
        compileWindowPublication({
          generation: generationOf(generation, claimed.fence),
          // The caller's own fence, not the stream's current one. A worker
          // superseded since its claim presents a fence the stream has moved
          // past, and the leaf refuses it here rather than letting a late
          // handler publish over a newer claim.
          fence: command.input.fence,
          leaseValid: leaseIsHeld(claimed.leaseUntil, Date.now()),
          consentValid: consent.revokedAt === null,
          currentPublicationVersion: claimed.publicationVersion,
          currentPublishedCursor: claimed.publishedCursor,
          pages: compiled,
          candidateCount,
          manifestDigest: manifest,
          commandKey: command.idempotencyKey,
        }),
      );

      // A generation that already carries a marker is only ever replayed for
      // the identical command and manifest. A different key or a different
      // manifest refuses, so one generation can never be published twice.

      const id = newId("syncpublication");
      yield* SyncDb.insertPublication(transaction, {
        bookId: command.scope.bookId,
        id,
        generationId: generation.id,
        streamId: claimed.id,
        fromVersion: publication.fromVersion,
        baseCursor: publication.baseCursor,
        finalCursor: publication.finalCursor,
        pageCount: Number(publication.pageCount),
        changeCount: Number(publication.changeCount),
        manifestDigest: publication.manifestDigest,
        coversHistory: publication.coversHistory,
        commandKey: command.idempotencyKey,
      });

      // The published cursor moves in the same transaction as the marker, and
      // only from the exact base this generation began at.
      // The published cursor moves in the same transaction as the marker, and
      // only from the exact base this generation began at, under the fence the
      // caller proved. A guarded update that matches nothing means a claim or
      // a publication landed in between, so the cursor does not move and the
      // whole transaction rolls back rather than leaving a marker nothing
      // published.
      const advanced = yield* SyncDb.publishStream(transaction, {
        bookId: command.scope.bookId,
        streamId: claimed.id,
        expectedVersion: claimed.publicationVersion,
        expectedFence: command.input.fence,
        publicationVersion: (BigInt(claimed.publicationVersion) + 1n).toString(),
        publishedCursor: publication.finalCursor,
        generationId: generation.id,
      });

      if ((advanced[0]?.moved ?? "0") !== "1") {
        return yield* failure("StaleDependency");
      }

      const marked = (yield* SyncDb.readPublicationByGeneration(
        transaction,
        command.scope.bookId,
        generation.id,
      ))[0];

      if (!marked) return yield* failure("InternalError");

      const body = publicationBody(
        marked,
        (BigInt(claimed.publicationVersion) + 1n).toString(),
        principal.actorId,
        command.idempotencyKey,
      );

      const result = yield* Shared.decode(Sync.WindowPublication, body);

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "publish_bank_sync_generation",
        principal.actorId,
        body,
      );

      return result;
    }),
  );
});

function arrayOf(value: Json | undefined) {
  return Array.isArray(value) ? value : [];
}

function objectOf(value: Json | undefined) {
  return Shared.isJsonObject(value) ? value : {};
}

function text(value: Json | undefined) {
  return typeof value === "string" ? value : "";
}

function count(value: Json | undefined) {
  return typeof value === "number" ? value : 0;
}

function flag(value: Json | undefined) {
  return value === true;
}

export const readSyncWindow = Effect.fn("banking.sync.readWindow")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: Sync.ReadSyncWindow;
  },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, windowTables);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];

      if (!book) return yield* failure("Forbidden");

      yield* readConsentShared(transaction, command.scope.bookId, command.input.consentId);

      const state = (yield* SyncDb.readWindowState(
        transaction,
        command.scope.bookId,
        command.input.consentId,
      ))[0];

      if (!state) {
        return yield* Shared.decode(Sync.SyncWindowState, {
          consentId: command.input.consentId,
          streamId: null,
          publishedCursor: null,
          publicationVersion: "0",
          fence: "0",
          currentGenerationId: null,
          leaseUntil: null,
          resumable: null,
          published: [],
          retainedPages: [],
          canonical: false,
          acknowledgement: "no_generation",
        } satisfies JsonObject);
      }

      const pages = arrayOf(state.pages).map(objectOf);

      const published = arrayOf(state.published).map(objectOf);

      const resumable =
        state.generationId === null
          ? null
          : {
              generationId: state.generationId,
              baseCursor: state.baseCursor ?? "",
              attemptNumber: state.attemptNumber ?? "0",
              // Where a resumed window must request its next page from: the
              // last retained page's next cursor, else the generation's base.
              requestCursor:
                text(pages[pages.length - 1]?.["nextCursor"]) === ""
                  ? (state.baseCursor ?? "")
                  : text(pages[pages.length - 1]?.["nextCursor"]),
              retainedPageCount: state.retainedPageCount,
              pageEvidenceTruncated: state.retainedPageCount > defaultMaximumPages,
            };

      try {
        return yield* Shared.decode(Sync.SyncWindowState, {
          consentId: command.input.consentId,
          streamId: state.streamId,
          publishedCursor: state.publishedCursor === "" ? null : state.publishedCursor,
          publicationVersion: state.publicationVersion,
          fence: state.fence,
          currentGenerationId: state.currentGenerationId,
          leaseUntil: state.leaseUntil,
          resumable,
          published: published.map((entry) => ({
            publicationId: text(entry["publicationId"]),
            generationId: text(entry["generationId"]),
            fromVersion: text(entry["fromVersion"]),
            finalCursor: text(entry["finalCursor"]),
            pageCount: count(entry["pageCount"]),
            changeCount: count(entry["changeCount"]),
            coversHistory: flag(entry["coversHistory"]),
            publishedAt: text(entry["publishedAt"]),
          })),
          retainedPages: pages.map((page) => ({
            ordinal: count(page["ordinal"]),
            requestCursor: text(page["requestCursor"]),
            nextCursor: text(page["nextCursor"]),
            hasMore: flag(page["hasMore"]),
            recordCount: count(page["recordCount"]),
            rawDigest: text(page["rawDigest"]),
            rawByteLength: count(page["rawByteLength"]),
            chainedDigest: text(page["chainedDigest"]),
          })),
          // A staged generation without its marker is not a bank observation.
          // The read says so rather than presenting candidates as canonical.
          canonical: state.generationId === null,
          acknowledgement:
            state.generationId === null
              ? published.length > 0
                ? "published_generation"
                : "no_generation"
              : "staged_only_no_publication_marker",
        } satisfies JsonObject);
      } catch (error) {
        return yield* failure("InternalError", `STATE_DECODE ${String(error)}`);
      }
    }),
  );
});
