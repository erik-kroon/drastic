import {
  recordSuggestion,
  citedSuggestions,
  recordDecision,
  type Comparison,
} from "../decision-provenance";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Extraction from "@open-erp/contracts/supplier-extraction";
import * as SupplierDrafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { DocumentOutputError } from "../../adapters/document-reading/azure";
import { DocumentReadingError, interpretDocument } from "./document-reading";
import { requireOriginalEvidence } from "./inbox";

import {
  objectStore,
  readRetainedObject,
  sourceDigest,
} from "../../adapters/storage/retained-objects";
import { readSealedDraft } from "../../db/posting-admission";
import * as DraftDb from "../../db/purchases/drafts";
import * as ExtractionDb from "../../db/purchases/extraction";
import * as InboxDb from "../../db/purchases/inbox";
import * as RetentionDb from "../../db/source-retention";
import { databaseFailure, withTransaction, type Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { admitRunnerActor } from "../preparation-jobs";
import { RequestEnvironment } from "../../runtime/environment";
import { digest, isoNow, newId, replay, saveCommand, sha256Hex } from "../posting";
import { calculateSupplierDraft } from "./draft-calculation";
import {
  createSupplierInvoiceDraftInTransaction,
  reviseSupplierInvoiceDraftInTransaction,
} from "./drafts";
import { isFieldKey, readNativeTextExtraction, type ExtractionPage } from "./extraction-engine";
import {
  contentDiscrepancies,
  isExactSelectedValue,
  mergeExtraction,
  type MergeSuggestion,
} from "./extraction-merge";
import * as Shared from "./shared";
import { authorize } from "../authority";

type Scope = typeof Accounting.Scope.Type;

type Json = Schema.Json;

type JsonObject = Schema.JsonObject;

const RequestResultSchema = Extraction.SupplierExtractionRequestResult;

const CancelResultSchema = Extraction.SupplierExtractionCancelResult;

const StateSchema = Extraction.SupplierExtractionState;

const PreparationSchema = Extraction.SupplierExtractionReviewPreparation;

const SupplierContentSchema = SupplierDrafts.SupplierDraftContent;

const ReviewSchema = Extraction.SupplierExtractionReview;

// The reviewed built-in engine release. It reads the retained original's own
// bytes: no provider, no model, no network and no financial tool is available to
// it. A new document vocabulary or a real vision provider is a new engine release,
// not a widening of this one.
export const nativeTextEngine = "native-text-v1";

const nativeTextMediaTypes = new Set([
  "text/csv",
  "text/plain",
  "application/json",
  "application/xml",
]);

const maximumPages = 200;

const maximumRequests = 1000;

const maximumAttempts = 50;

const extractionTables = [
  "books",
  "accounts",
  "periods",
  "evidence",
  "command_receipts",
  "intake_occurrences",
  "intake_contents",
  "intake_previews",
  "intake_admissions",
  "supplier_inbox",
  "supplier_extraction_attempts",
  "supplier_extraction_requests",
  "supplier_extraction_request_states",
  "supplier_field_decisions",
  "supplier_invoice_drafts",
  "supplier_invoice_draft_revisions",
  "commerce_counterparties",
  "commerce_counterparty_revisions",
  "commerce_invoices",
  "supplier_acceptance_reviews",
  "supplier_acceptances",
];

const extractionInserts = [
  "supplier_extraction_requests",
  "supplier_extraction_request_states",
  "supplier_field_decisions",
  "supplier_extraction_attempts",
  "supplier_inbox",
  "supplier_invoice_drafts",
  "supplier_invoice_draft_revisions",
  "command_receipts",
];

const extractionUpdates = ["supplier_extraction_request_states", "supplier_inbox"];

type CapturedDraft = {
  readonly id: string;
  readonly revision: string;
  readonly digest: string;
  readonly content: JsonObject;
};

type ReviewBasis = {
  readonly request: ExtractionDb.ExtractionRequestRow;
  readonly state: ExtractionDb.ExtractionStateRow;
  readonly occurrence: NonNullable<InboxDb.OccurrenceRow>;
  readonly attempt: { readonly id: string; readonly ordinal: number; readonly body: JsonObject };
  readonly current: CapturedDraft | null;
  readonly accepted: boolean;
  // Null only when the occurrence has no reviewed draft at all, so there is no
  // reviewed base to merge against. The preview reports that as required base
  // facts; it never invents supplier facts to fill the gap.
  readonly base: JsonObject | null;
};

// A read-only preview states no expectation about the draft, so it must not be
// handed an impossible null revision to compare against. A commit states the
// exact draft it previewed and every one of those comparisons is enforced.
type ReviewExpectations = {
  readonly enforced: boolean;
  readonly expectedRevision: string | null;
  readonly expectedDigest: string | null;
  readonly baseContent: JsonObject | null;
};

export const previewExpectations: ReviewExpectations = {
  enforced: false,
  expectedRevision: null,
  expectedDigest: null,
  baseContent: null,
};

function requireExtractionAccess(transaction: Transaction) {
  return Shared.requireTables(transaction, extractionTables, extractionInserts, extractionUpdates);
}

function integerField(value: JsonObject, key: string) {
  const found = value[key];

  return typeof found === "number" && Number.isInteger(found) && found >= 0 ? found : null;
}

function sourceLocators(value: JsonObject) {
  return Shared.arrayField(value, "sourceLocators").flatMap((item) => {
    const parsed = Schema.decodeUnknownOption(Extraction.SourceLocator)(item);

    return Option.isSome(parsed) ? [parsed.value] : [];
  });
}

// Selected pages must be non-overlapping, ascending and inside the retained
// original. A page the operator excluded can never back a suggestion.
function orderedPages(pages: ReadonlyArray<ExtractionPage>, byteLength: number) {
  if (pages.length < 1 || pages.length > maximumPages) return null;
  const sorted = [...pages].sort((left, right) => left.startByte - right.startByte);
  let previousEnd = 0;

  for (const page of sorted) {
    if (page.endByte <= page.startByte || page.endByte > byteLength) return null;

    if (page.startByte < previousEnd) return null;
    previousEnd = page.endByte;
  }

  return sorted;
}

function pageJson(pages: ReadonlyArray<ExtractionPage>) {
  return pages.map((page) => ({
    page: page.page,
    startByte: page.startByte,
    endByte: page.endByte,
  }));
}

function requestView(
  request: ExtractionDb.ExtractionRequestRow,
  state: ExtractionDb.ExtractionStateRow,
): JsonObject {
  return {
    id: request.id,
    occurrenceId: request.occurrenceId,
    generation: request.generation,
    originalHash: request.originalHash,
    originalBytes: Number(request.originalBytes),
    engineRelease: request.engineRelease,
    attemptIdentity: request.attemptIdentity,
    state: state.state,
    cancelVersion: state.cancelVersion,
    attemptsMade: state.attemptsMade,
    requestedBy: request.requestedBy,
    requestedAt: request.requestedAt,
    digest: Shared.textField(request.body, "digest") ?? "",
  };
}

// The attempt row serves two readers: the bounded inbox summary the existing view
// already decodes, and this structured reading with its source locators.
function attemptBody(
  attempt: { readonly id: string; readonly ordinal: number; readonly body: JsonObject },
  requestId: string,
): JsonObject {
  const structured: JsonObject = Object.assign({}, Shared.objectField(attempt.body, "extraction"));

  return Object.assign({}, structured, {
    requestId,
    attemptId: attempt.id,
    createdAt: attempt.body.createdAt,
    retainedOutputHash: attempt.body.retainedOutputHash,
    originalHashUnchanged: structured["originalHashUnchanged"] ?? true,
    diagnostics: structured["diagnostics"] ?? structured["extractionDiagnostics"] ?? [],
  });
}

function mergeSuggestions(body: JsonObject) {
  const suggestions: MergeSuggestion[] = [];
  const sparseDocument = Shared.textField(body, "engineRelease") === "azure-invoice-v1";

  for (const field of Shared.arrayField(body, "fields")) {
    if (!Shared.isJsonObject(field)) continue;
    const fieldKey = Shared.textField(field, "fieldKey");

    if (
      fieldKey === undefined ||
      !isFieldKey(fieldKey) ||
      (sparseDocument && field["proposedValue"] === null)
    )
      continue;
    suggestions.push({
      candidateLineId: null,
      fieldKey,
      proposedValue: field["proposedValue"] ?? null,
      sourceLocators: sourceLocators(field),
    });
  }

  for (const line of Shared.arrayField(body, "candidateLines")) {
    if (!Shared.isJsonObject(line)) continue;
    const candidateLineId = Shared.textField(line, "candidateLineId");

    if (candidateLineId === undefined) continue;

    for (const field of Shared.arrayField(line, "fields")) {
      if (!Shared.isJsonObject(field)) continue;
      const fieldKey = Shared.textField(field, "fieldKey");

      if (
        fieldKey === undefined ||
        !isFieldKey(fieldKey) ||
        (sparseDocument && field["proposedValue"] === null)
      )
        continue;
      suggestions.push({
        candidateLineId,
        fieldKey,
        proposedValue: field["proposedValue"] ?? null,
        sourceLocators: sourceLocators(field),
      });
    }
  }

  return suggestions;
}

function readCapturedDraft(transaction: Transaction, bookId: string, draftId: string) {
  return Effect.gen(function* () {
    const draft = (yield* DraftDb.readDraft(transaction, bookId, draftId))[0];

    if (!draft) return yield* failure("NotFound");

    const head = (yield* DraftDb.readHeadRevision(
      transaction,
      bookId,
      draftId,
      draft.currentRevision,
    ))[0];

    if (!head) return yield* failure("NotFound");

    return {
      id: draft.id,
      revision: draft.currentRevision,
      digest: Shared.textField(head.body, "digest") ?? "",
      content: Shared.objectField(head.body, "content"),
    } satisfies CapturedDraft;
  });
}

// A retained decision stores the exact scalar the reviewer chose for its own
// field, not an object keyed by field name, so it is read as that scalar.
function readRetainedDecisions(transaction: Transaction, bookId: string, draftId: string | null) {
  if (draftId === null) return Effect.succeed([] as const);

  return ExtractionDb.readFieldDecisionsForDraft(transaction, bookId, draftId).pipe(
    Effect.map((rows) =>
      rows.map((row) => ({
        lineOrdinal: row.lineOrdinal,
        fieldKey: row.fieldKey,
        decisionKind: row.decisionKind,
        baseValue: row.body["baseValue"] ?? null,
        selectedValue: row.body["selectedValue"] ?? null,
      })),
    ),
  );
}

function attemptIdentityKey(bookId: string, requestId: string) {
  return Effect.map(sha256Hex(`${bookId}:${requestId}`), (hex) => `exr_${hex.slice(0, 60)}`);
}

export const requestSupplierExtraction = Effect.fn("purchases.extraction.request")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly occurrenceId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Extraction.RequestSupplierExtraction.Type;
  },
) {
  const documentReaderAvailable = Boolean((yield* RequestEnvironment).bindings.DOCUMENT_READER);

  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireExtractionAccess(transaction);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = yield* Shared.readBook(transaction, command.scope.bookId);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "request_supplier_extraction",
        principal.actorId,
        {
          occurrenceId: command.occurrenceId,
          input: yield* Shared.toJsonObject(command.input),
        } satisfies JsonObject,
        RequestResultSchema,
      );

      if (request.previous) return request.previous;
      yield* Shared.requireNativeCommerceProfile(book.profile, book.authority);

      if (command.input.engineRelease === "azure-invoice-v1" && !documentReaderAvailable) {
        return yield* failure("Unavailable");
      }

      if (
        command.input.engineRelease === "azure-invoice-v1" &&
        (book.currency !== "SEK" || book.currencyScale !== 2)
      )
        return yield* failure("UnsupportedProfile");

      const entry = (yield* InboxDb.readInboxForUpdate(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
      ))[0];

      if (!entry) return yield* failure("NotFound");

      const occurrence = (yield* InboxDb.readOccurrence(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
      ))[0];

      if (!occurrence) return yield* failure("NotFound");

      const originalHash = Shared.textField(occurrence.body, "sha256");
      const originalBytes = integerField(occurrence.body, "byteLength");

      if (originalHash === undefined || originalBytes === null || originalBytes < 1) {
        return yield* failure("InvalidJournal");
      }

      const pages =
        command.input.engineRelease === nativeTextEngine
          ? orderedPages(command.input.selectedPages, originalBytes)
          : [];

      if (
        command.input.engineRelease === "azure-invoice-v1" &&
        !["application/pdf", "image/jpeg", "image/png"].includes(
          Shared.textField(occurrence.body, "mediaType") ?? "",
        )
      )
        return yield* failure("UnsupportedProfile");

      if (pages === null) return yield* failure("InvalidJournal");

      const count = (yield* ExtractionDb.readExtractionRequestGeneration(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
      ))[0]!.total;

      if (count >= maximumRequests) return yield* failure("InvalidJournal");

      const generation = count + 1;

      const base =
        entry.draftId === null
          ? null
          : yield* readCapturedDraft(transaction, command.scope.bookId, entry.draftId);

      // The selected page list is an array; the object-only encoder cannot hold it.
      const selection = yield* digest(yield* Shared.toJson(pageJson(pages)));

      const attemptIdentity = `sha256:${yield* sha256Hex(
        `${command.scope.bookId}:${command.occurrenceId}:${originalHash}:${command.input.engineRelease}:${selection}`,
      )}`;

      const requestId = newId("supplier_extraction_request");
      const requestedAt = yield* isoNow(transaction);

      // The stored body is complete before it is hashed, and the digest covers the
      // body without it. Hashing a placeholder digest field instead would be a
      // different document from the one the table verifies.
      const unsigned = {
        id: requestId,
        occurrenceId: command.occurrenceId,
        generation,
        engineRelease: command.input.engineRelease,
        originalHash,
        originalBytes,
        attemptIdentity,
        dataUsePolicy: command.input.dataUsePolicy,
        selectedPages: pageJson(pages),
        baseDraftId: base === null ? null : base.id,
        baseRevision: base === null ? null : base.revision,
        baseDigest: base === null ? null : base.digest,
        requestedBy: principal.actorId,
        requestedAt,
      } satisfies JsonObject;

      const body = Object.assign({}, unsigned, { digest: yield* digest(unsigned) });

      yield* ExtractionDb.insertExtractionRequest(transaction, {
        bookId: command.scope.bookId,
        id: requestId,
        occurrenceId: command.occurrenceId,
        generation,
        originalHash,
        originalBytes: String(originalBytes),
        engineRelease: command.input.engineRelease,
        attemptIdentity,
        requestedBy: principal.actorId,
        requestedAt,
        digest: Shared.textField(body, "digest") ?? "",
        body,
      });
      yield* ExtractionDb.insertExtractionState(transaction, {
        bookId: command.scope.bookId,
        requestId,
        state: "ready",
        cancelVersion: 0,
        attemptsMade: 0,
      });
      yield* ExtractionDb.supersedeReadyRequests(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
        generation,
      );

      const result = yield* Shared.decode(RequestResultSchema, {
        occurrenceId: command.occurrenceId,
        request: requestView(
          {
            id: requestId,
            occurrenceId: command.occurrenceId,
            generation,
            originalHash,
            originalBytes: String(originalBytes),
            engineRelease: command.input.engineRelease,
            attemptIdentity,
            requestedBy: principal.actorId,
            requestedAt,
            body,
          },
          { requestId, state: "ready", cancelVersion: 0, attemptsMade: 0 },
        ),
      });

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "request_supplier_extraction",
        principal.actorId,
        yield* Shared.toJsonObject(result),
      );

      return result;
    }),
  );
});

export const cancelSupplierExtraction = Effect.fn("purchases.extraction.cancel")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly occurrenceId: string;
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Extraction.CancelSupplierExtraction.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireExtractionAccess(transaction);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = yield* Shared.readBook(transaction, command.scope.bookId);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "cancel_supplier_extraction",
        principal.actorId,
        {
          occurrenceId: command.occurrenceId,
          requestId: command.requestId,
          input: yield* Shared.toJsonObject(command.input),
        } satisfies JsonObject,
        CancelResultSchema,
      );

      if (request.previous) return request.previous;
      yield* Shared.requireNativeCommerceProfile(book.profile, book.authority);

      const entry = (yield* InboxDb.readInboxForUpdate(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
      ))[0];

      if (!entry) return yield* failure("NotFound");

      const target = (yield* ExtractionDb.readExtractionRequest(
        transaction,
        command.scope.bookId,
        command.requestId,
      ))[0];

      if (!target || target.occurrenceId !== command.occurrenceId) {
        return yield* failure("NotFound");
      }

      const state = (yield* ExtractionDb.readExtractionState(
        transaction,
        command.scope.bookId,
        command.requestId,
      ))[0];

      if (!state) return yield* failure("InternalError");

      // A recorded attempt is retained evidence. Cancelling discards publication
      // of a new result; it never erases a recorded one.
      if (state.state !== "ready") return yield* failure("StaleDependency");

      yield* ExtractionDb.cancelExtractionRequest(
        transaction,
        command.scope.bookId,
        command.requestId,
      );

      const result = yield* Shared.decode(CancelResultSchema, {
        request: requestView(target, {
          requestId: command.requestId,
          state: "cancelled",
          cancelVersion: state.cancelVersion + 1,
          attemptsMade: state.attemptsMade,
        }),
      });

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "cancel_supplier_extraction",
        principal.actorId,
        yield* Shared.toJsonObject(result),
      );

      return result;
    }),
  );
});

export const getSupplierExtractionState = Effect.fn("purchases.extraction.state")(function* (
  token: string,
  command: { readonly scope: Scope; readonly occurrenceId: string },
) {
  const documentReaderAvailable = Boolean((yield* RequestEnvironment).bindings.DOCUMENT_READER);

  return yield* Shared.withBook(token, command.scope, false, "share", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, extractionTables);

      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];

      if (!book) return yield* failure("Forbidden");

      const entry = (yield* InboxDb.readInbox(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
      ))[0];

      if (!entry) return yield* failure("NotFound");

      if (
        (yield* InboxDb.readOccurrence(transaction, command.scope.bookId, command.occurrenceId))
          .length === 0
      ) {
        return yield* failure("NotFound");
      }

      const requests = yield* ExtractionDb.readExtractionRequests(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
      );

      const latest = requests[0];

      const attempts =
        latest === undefined
          ? []
          : yield* ExtractionDb.readAttemptForRequest(transaction, command.scope.bookId, latest.id);

      const attempt = attempts[attempts.length - 1];

      const decisions =
        entry.draftId === null
          ? []
          : yield* ExtractionDb.readFieldDecisionsForDraft(
              transaction,
              command.scope.bookId,
              entry.draftId,
            );

      let suggestionRecordId: string | null = null;

      if (
        latest &&
        attempt &&
        Shared.textField(attemptBody(attempt, latest.id), "result") === "succeeded"
      ) {
        const basis = yield* readReviewBasis(
          transaction,
          command.scope.bookId,
          command.occurrenceId,
          latest.id,
          attempt.id,
          previewExpectations,
        );

        const retained = yield* readRetainedDecisions(
          transaction,
          command.scope.bookId,
          basis.current?.id ?? null,
        );

        const merge = proposalState(
          basis.base ?? {},
          basis.current?.content ?? basis.base ?? {},
          attemptBody(attempt, latest.id),
          [],
          retained,
        );

        const fields = yield* Schema.decodeUnknownEffect(Schema.Array(Extraction.MergedField))(
          merge.fields,
        ).pipe(Effect.mapError(() => failure("InternalError")));

        suggestionRecordId = yield* recordSuggestion(
          transaction,
          command.scope.bookId,
          principal,
          {
            kind: "extraction_attempt",
            occurrenceId: command.occurrenceId,
            requestId: latest.id,
            attemptId: attempt.id,
            draftId: basis.current?.id ?? null,
            revision: basis.current?.revision ?? null,
          },
          {
            source: "extraction",
            version: "extraction_merge_v1",
            options: fields
              .filter((field) => field.suggestion !== null)
              .map((field) => ({
                lineOrdinal: field.lineOrdinal,
                fieldKey: field.fieldKey,
                value: field.suggestion,
              })),
          },
        );
      }

      return yield* Shared.decode(StateSchema, {
        suggestionRecordId,
        currencyScale: book.currencyScale,
        scope: command.scope,
        occurrenceId: command.occurrenceId,
        documentReaderAvailable,
        requests: requests.map((row) =>
          requestView(row, {
            requestId: row.id,
            state: row.state,
            cancelVersion: row.cancelVersion,
            attemptsMade: row.attemptsMade,
          }),
        ),
        attempt:
          latest === undefined || attempt === undefined ? null : attemptBody(attempt, latest.id),
        fieldDecisions: decisions.map((row) => row.body),
      });
    }),
  );
});

// One consistent read of the exact request, attempt, occurrence, draft and merge
// basis. Preparation and commit share it so they cannot disagree about the base;
// only the commit enforces the caller's draft expectations.
function readReviewBasis(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
  requestId: string,
  attemptId: string,
  expectations: ReviewExpectations,
) {
  return Effect.gen(function* () {
    const entry = (yield* InboxDb.readInboxForUpdate(transaction, bookId, occurrenceId))[0];

    if (!entry) return yield* failure("NotFound");

    const request = (yield* ExtractionDb.readExtractionRequest(transaction, bookId, requestId))[0];

    if (!request || request.occurrenceId !== occurrenceId) return yield* failure("NotFound");

    const latest = (yield* ExtractionDb.readLatestExtractionRequest(
      transaction,
      bookId,
      occurrenceId,
    ))[0];

    if (!latest || latest.generation !== request.generation) {
      return yield* failure("StaleDependency");
    }

    const state = (yield* ExtractionDb.readExtractionState(transaction, bookId, requestId))[0];

    if (!state) return yield* failure("InternalError");

    const occurrence = (yield* InboxDb.readOccurrence(transaction, bookId, occurrenceId))[0];

    if (!occurrence) return yield* failure("NotFound");

    if (Shared.textField(occurrence.body, "sha256") !== request.originalHash) {
      return yield* failure("StaleDependency");
    }

    const attempts = yield* ExtractionDb.readAttemptForRequest(transaction, bookId, requestId);
    const attempt = attempts.find((row) => row.id === attemptId);

    if (!attempt) return yield* failure("NotFound");

    // A review is submitted against the attempt that was previewed. Once a later
    // attempt exists for the same request, the earlier one is no longer the
    // evidence a reviewer saw, so it cannot carry a submission.
    if (attempts[attempts.length - 1]?.id !== attempt.id) {
      return yield* failure("StaleDependency");
    }

    const current =
      entry.draftId === null ? null : yield* readCapturedDraft(transaction, bookId, entry.draftId);

    const accepted =
      current !== null &&
      (yield* readSealedDraft(transaction, bookId, current.id, "supplier")).length > 0;

    if (expectations.enforced) {
      if (current === null && expectations.expectedRevision !== null) {
        return yield* failure("StaleDependency");
      }

      if (
        current !== null &&
        (current.revision !== expectations.expectedRevision ||
          current.digest !== expectations.expectedDigest)
      ) {
        return yield* failure("StaleDependency");
      }

      if (current === null && expectations.baseContent === null) {
        return yield* failure("InvalidJournal");
      }
    }

    const capturedBaseDraftId = Shared.textField(request.body, "baseDraftId");
    let base: JsonObject | null = null;

    if (capturedBaseDraftId === undefined) {
      base = expectations.baseContent;
    } else if (current !== null && current.id === capturedBaseDraftId) {
      const capturedRevision = Shared.textField(request.body, "baseRevision") ?? current.revision;

      const revision = (yield* DraftDb.readRevision(
        transaction,
        bookId,
        current.id,
        capturedRevision,
      ))[0];

      if (!revision) return yield* failure("StaleDependency");
      base = Shared.objectField(revision.body, "content");
    } else {
      return yield* failure("StaleDependency");
    }

    return {
      request,
      state,
      occurrence,
      attempt,
      current,
      accepted,
      base,
    } satisfies ReviewBasis;
  });
}

function proposalState(
  base: JsonObject,
  current: JsonObject,
  body: JsonObject,
  lineMapping: ReadonlyArray<{
    readonly candidateLineId: string;
    readonly targetLineId: string | null;
  }>,
  retained: ReadonlyArray<{
    readonly lineOrdinal: number;
    readonly fieldKey: string;
    readonly decisionKind: string;
    readonly baseValue: Json;
    readonly selectedValue: Json;
  }>,
) {
  const candidateLineIds: string[] = [];

  for (const line of Shared.arrayField(body, "candidateLines")) {
    if (!Shared.isJsonObject(line)) continue;
    const candidateLineId = Shared.textField(line, "candidateLineId");

    if (candidateLineId !== undefined) candidateLineIds.push(candidateLineId);
  }

  return mergeExtraction({
    base,
    current,
    candidateLineIds,
    suggestions: mergeSuggestions(body),
    lineMapping,
    retainedDecisions: retained,
  });
}

export const studySupplierExtractionDiagnostics = Effect.fn("purchases.extraction.diagnostics")(
  function* (
    token: string,
    command: {
      readonly scope: Scope;
      readonly occurrenceId: string;
      readonly requestId: string;
      readonly idempotencyKey: string;
      readonly input: typeof Extraction.RequestSupplierDiagnosticStudy.Type;
    },
  ) {
    return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
      Effect.gen(function* () {
        yield* requireExtractionAccess(transaction);

        const replayed = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "study_supplier_extraction_diagnostics",
          principal.actorId,
          {
            occurrenceId: command.occurrenceId,
            requestId: command.requestId,
            input: yield* Shared.toJsonObject(command.input),
          },
          Extraction.SupplierDiagnosticStudy,
        );

        if (replayed.previous) return replayed.previous;

        const basis = yield* readReviewBasis(
          transaction,
          command.scope.bookId,
          command.occurrenceId,
          command.requestId,
          command.input.attemptId,
          previewExpectations,
        );

        const attempt = yield* Shared.decode(
          Extraction.SupplierExtractionAttempt,
          attemptBody(basis.attempt, command.requestId),
        );

        const diagnostics: Array<typeof Extraction.ExtractionDiagnostic.Type> = [];

        if (command.input.mode === "shadow") {
          diagnostics.push(...attempt.diagnostics);

          const merge = proposalState(
            basis.base ?? {},
            basis.current?.content ?? {},
            attemptBody(basis.attempt, command.requestId),
            [],
            [],
          );

          for (const field of merge.fields) {
            diagnostics.push({
              code: `shadow_${field.state}`,
              lineOrdinal: field.lineOrdinal,
              fieldKey: field.fieldKey,
              detail: "Diagnostic comparison only. No suggestion or reviewed fact was changed.",
            });
          }

          if (basis.current === null)
            diagnostics.push({
              code: "shadow_no_reviewed_draft",
              lineOrdinal: 0,
              fieldKey: "",
              detail: "No reviewed draft exists. Agreement with a human-reviewed value is unknown.",
            });
        }

        const result = yield* Shared.decode(Extraction.SupplierDiagnosticStudy, {
          scope: command.scope,
          occurrenceId: command.occurrenceId,
          requestId: command.requestId,
          attemptId: attempt.attemptId,
          sourceHash: attempt.sourceHash,
          mode: command.input.mode,
          draftId: basis.current?.id ?? null,
          draftRevision: basis.current?.revision ?? null,
          draftDigest: basis.current?.digest ?? null,
          diagnostics,
          createdAt: yield* isoNow(transaction),
        });

        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          replayed.expected,
          "study_supplier_extraction_diagnostics",
          principal.actorId,
          yield* Shared.toJsonObject(result),
        );

        return result;
      }),
    );
  },
);

// The base facts extraction has no vocabulary for. With no reviewed draft there
// is nothing to merge against, so the preview names what a reviewer must supply
// instead of inventing a counterparty, an identity or an evidence reference.
const requiredBaseFacts = [
  "counterpartyId",
  "counterpartyRevision",
  "supplier",
  "buyer",
  "sourceEvidenceId",
  "currency",
  "currencyScale",
  "lines[].id",
] as const;

export const prepareSupplierExtractionReview = Effect.fn("purchases.extraction.prepare")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly occurrenceId: string;
    readonly requestId: string;
    readonly attemptId: string;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireExtractionAccess(transaction);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = yield* Shared.readBook(transaction, command.scope.bookId);
      yield* Shared.requireNativeCommerceProfile(book.profile, book.authority);

      const basis = yield* readReviewBasis(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
        command.requestId,
        command.attemptId,
        previewExpectations,
      );

      const retained = yield* readRetainedDecisions(
        transaction,
        command.scope.bookId,
        basis.current === null ? null : basis.current.id,
      );

      // Without a reviewed base there is no reviewed value to compare against, so
      // the merge runs against an absent base and the preview reports that.
      const hasBase = basis.base !== null;

      const currentContent = basis.current === null ? (basis.base ?? {}) : basis.current.content;

      const merge = proposalState(
        basis.base ?? {},
        currentContent,
        attemptBody(basis.attempt, command.requestId),
        [],
        retained,
      );

      const uncalculated = contentDiscrepancies(merge.proposed);
      const discrepancies = [...merge.discrepancies, ...uncalculated];

      const calculated =
        hasBase && uncalculated.length === 0
          ? yield* calculateSupplierDraft(transaction, command.scope.bookId, book, merge.proposed)
          : null;

      const preparedFields = yield* Schema.decodeUnknownEffect(
        Schema.Array(Extraction.MergedField),
      )(merge.fields).pipe(Effect.mapError(() => failure("InternalError")));

      const suggestionRecordId = yield* recordSuggestion(
        transaction,
        command.scope.bookId,
        principal,
        {
          kind: "extraction_attempt",
          occurrenceId: command.occurrenceId,
          requestId: command.requestId,
          attemptId: command.attemptId,
          draftId: basis.current?.id ?? null,
          revision: basis.current?.revision ?? null,
        },
        {
          source: "extraction",
          version: "extraction_merge_v1",
          options: preparedFields
            .filter((field) => field.suggestion !== null)
            .map((field) => ({
              lineOrdinal: field.lineOrdinal,
              fieldKey: field.fieldKey,
              value: field.suggestion,
            })),
        },
      );

      return yield* Shared.decode(PreparationSchema, {
        suggestionRecordId,
        currencyScale: book.currencyScale,
        scope: command.scope,
        occurrenceId: command.occurrenceId,
        request: requestView(basis.request, basis.state),
        attempt: attemptBody(basis.attempt, command.requestId),
        draft: {
          id: basis.current === null ? null : basis.current.id,
          revision: basis.current === null ? null : basis.current.revision,
          digest: basis.current === null ? null : basis.current.digest,
          state: basis.current === null ? "absent" : basis.accepted ? "accepted" : "open",
        },
        fields: merge.fields,
        lines: merge.lines,
        discrepancies,
        proposed: hasBase ? merge.proposed : null,
        proposedTotals: calculated === null ? null : Shared.objectField(calculated, "totals"),
        proposedBlockers: calculated === null ? [] : Shared.arrayField(calculated, "blockers"),
        requiredBaseFacts: hasBase ? [] : [...requiredBaseFacts],
      });
    }),
  );
});

type ChosenField = {
  readonly lineOrdinal: number;
  readonly fieldKey: string;
  readonly decisionKind: string;
  readonly selected: Json;
};

type ChosenReview = {
  readonly content: JsonObject;
  readonly selected: ReadonlyArray<ChosenField>;
};

function writeField(content: JsonObject, lineOrdinal: number, fieldKey: string, value: Json) {
  if (lineOrdinal === 0) {
    return Object.assign({}, content, { [fieldKey]: value });
  }

  const lines = content.lines;

  if (!Array.isArray(lines)) return content;

  const next = lines.map((line, index) => {
    if (index !== lineOrdinal - 1) return line;

    const base = Shared.isJsonObject(line) ? line : {};

    return Object.assign({}, base, { [fieldKey]: value });
  });

  return Object.assign({}, content, { lines: next });
}

// The reviewer's decisions are validated against the merge before anything is
// written. Every conflicting or unresolved field must carry an explicit decision,
// a money value must already be an exact minor-integer string, and a retained
// decision must actually retain the current reviewed value.
function applyDecisions(
  currentContent: JsonObject,
  merge: ReturnType<typeof mergeExtraction>,
  lines: ReadonlyArray<typeof Extraction.ExtractionLineDecision.Type>,
  fields: ReadonlyArray<typeof Extraction.ExtractionFieldDecision.Type>,
): ChosenReview | null {
  const currentLines = Array.isArray(currentContent.lines) ? currentContent.lines : [];

  const knownLineIds = new Set(
    currentLines.flatMap((line) => (Shared.isJsonObject(line) ? [line["id"]] : [])),
  );

  const knownCandidates = new Set(merge.lines.map((line) => line.candidateLineId));
  const claimed = new Set<string>();

  for (const decision of lines) {
    if (!knownCandidates.has(decision.candidateLineId)) return null;

    if (decision.disposition === "keep_reviewed") {
      if (decision.targetLineId !== null) return null;
      continue;
    }

    if (decision.targetLineId === null || !knownLineIds.has(decision.targetLineId)) {
      return null;
    }

    if (claimed.has(decision.targetLineId)) return null;
    claimed.add(decision.targetLineId);
  }

  const decided = new Set<string>();
  const selected: ChosenField[] = [];

  for (const decision of fields) {
    const key = `${decision.lineOrdinal}:${decision.fieldKey}`;

    if (decided.has(key)) return null;
    decided.add(key);

    const merged = merge.fields.find(
      (field) => field.lineOrdinal === decision.lineOrdinal && field.fieldKey === decision.fieldKey,
    );

    if (!merged) return null;

    if (!isExactSelectedValue(decision.fieldKey, decision.selectedValue)) return null;

    if (decision.decisionKind === "retained_reviewed") {
      if (!Shared.sameJson(decision.selectedValue, merged.current)) return null;
    } else if (decision.decisionKind === "accepted_suggestion") {
      if (merged.state !== "proposed_change" && merged.state !== "convergent") return null;

      if (!Shared.sameJson(decision.selectedValue, merged.suggestion)) return null;
    } else if (merged.state !== "conflict" && merged.state !== "needs_review") {
      return null;
    }

    selected.push({
      lineOrdinal: decision.lineOrdinal,
      fieldKey: decision.fieldKey,
      decisionKind: decision.decisionKind,
      selected: decision.selectedValue,
    });
  }

  const unresolved = merge.fields.filter(
    (field) => field.state === "conflict" || field.state === "needs_review",
  );

  for (const field of unresolved) {
    if (!decided.has(`${field.lineOrdinal}:${field.fieldKey}`)) return null;
  }

  let content = currentContent;

  for (const field of selected) {
    content = writeField(content, field.lineOrdinal, field.fieldKey, field.selected);
  }

  return { content, selected };
}

function appendFieldDecisions(
  transaction: Transaction,
  scope: Scope,
  occurrenceId: string,
  requestId: string,
  attemptId: string,
  draftId: string,
  draftRevision: string,
  reason: string,
  merge: ReturnType<typeof mergeExtraction>,
  chosen: ReadonlyArray<ChosenField>,
  reviewer: string,
) {
  return Effect.gen(function* () {
    const records: JsonObject[] = [];
    // One review is recorded at one instant, so every decision in it carries the
    // same final timestamp and is hashed over that final value.
    const recordedAt = yield* isoNow(transaction);

    for (const [ordinal, field] of chosen.entries()) {
      const merged = merge.fields.find(
        (candidate) =>
          candidate.lineOrdinal === field.lineOrdinal && candidate.fieldKey === field.fieldKey,
      );

      const id = newId("supplier_field_decision");

      // The body is complete before it is hashed, and the digest covers the body
      // without it: the table verifies exactly these bytes.
      const unsigned = {
        id,
        occurrenceId,
        requestId,
        attemptId,
        draftId,
        draftRevision,
        lineOrdinal: field.lineOrdinal,
        fieldKey: field.fieldKey,
        decisionKind: field.decisionKind,
        reviewer,
        ordinal: ordinal + 1,
        reason,
        baseValue: merged?.base ?? null,
        currentValue: merged?.current ?? null,
        suggestionValue: merged?.suggestion ?? null,
        selectedValue: field.selected,
        evidenceLocators: merged?.evidenceLocators ?? [],
        recordedAt,
      } satisfies JsonObject;

      const body = Object.assign({}, unsigned, { digest: yield* digest(unsigned) });

      yield* ExtractionDb.insertFieldDecision(transaction, {
        bookId: scope.bookId,
        id,
        occurrenceId,
        requestId,
        attemptId,
        draftId,
        draftRevision,
        lineOrdinal: field.lineOrdinal,
        fieldKey: field.fieldKey,
        decisionKind: field.decisionKind,
        reviewer,
        digest: Shared.textField(body, "digest") ?? "",
        body,
      });
      records.push(body);
    }

    return records;
  });
}

export const commitSupplierExtractionReview = Effect.fn("purchases.extraction.review")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly occurrenceId: string;
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Extraction.CommitSupplierExtractionReview.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireExtractionAccess(transaction);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = yield* Shared.readBook(transaction, command.scope.bookId);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "commit_supplier_extraction_review",
        principal.actorId,
        {
          occurrenceId: command.occurrenceId,
          requestId: command.requestId,
          input: yield* Shared.toJsonObject(command.input),
        } satisfies JsonObject,
        ReviewSchema,
      );

      if (request.previous) return request.previous;
      yield* Shared.requireNativeCommerceProfile(book.profile, book.authority);

      const baseContent =
        command.input.baseContent === null
          ? null
          : yield* Shared.toJsonObject(command.input.baseContent);

      const basis = yield* readReviewBasis(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
        command.requestId,
        command.input.attemptId,
        {
          enforced: true,
          expectedRevision: command.input.expectedDraftRevision,
          expectedDigest: command.input.expectedDraftDigest,
          baseContent,
        },
      );

      if (basis.base === null) return yield* failure("InvalidJournal");

      const subject = {
        kind: "extraction_attempt" as const,
        occurrenceId: command.occurrenceId,
        requestId: command.requestId,
        attemptId: command.input.attemptId,
        draftId: basis.current?.id ?? null,
        revision: basis.current?.revision ?? null,
      };

      const exposure = yield* citedSuggestions(
        transaction,
        command.scope.bookId,
        principal,
        [subject],
        command.input.presentedSuggestionIds ?? [],
      );

      const retained = yield* readRetainedDecisions(
        transaction,
        command.scope.bookId,
        basis.current === null ? null : basis.current.id,
      );

      const currentContent = basis.current === null ? basis.base : basis.current.content;

      const merge = proposalState(
        basis.base,
        currentContent,
        attemptBody(basis.attempt, command.requestId),
        command.input.lines.map((line) => ({
          candidateLineId: line.candidateLineId,
          targetLineId: line.targetLineId,
        })),
        retained,
      );

      const chosen = applyDecisions(
        currentContent,
        merge,
        command.input.lines,
        command.input.fields,
      );

      if (chosen === null) return yield* failure("InvalidJournal");

      if (contentDiscrepancies(chosen.content).length > 0) {
        return yield* failure("InvalidJournal");
      }

      const reviewed = yield* Shared.decode(SupplierContentSchema, chosen.content);

      yield* requireOriginalEvidence(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
        reviewed.sourceEvidenceId,
      );

      const draft = yield* basis.current === null
        ? createSupplierInvoiceDraftInTransaction(transaction, principal, {
            scope: command.scope,
            idempotencyKey: newId("supplier_draft"),
            input: {
              draftKey: `ap_${(yield* sha256Hex(`${command.scope.bookId}:${command.occurrenceId}`)).slice(0, 60)}`,
              content: reviewed,
            },
          })
        : basis.accepted
          ? Effect.succeed(null)
          : reviseSupplierInvoiceDraftInTransaction(transaction, principal, {
              scope: command.scope,
              draftId: basis.current.id,
              idempotencyKey: newId("supplier_revision"),
              input: {
                expectedRevision: basis.current.revision,
                expectedDigest: basis.current.digest,
                reason: command.input.reason,
                content: reviewed,
              },
            });

      let outcome: "draft_created" | "draft_revised" | "correction_case" = "correction_case";
      let boundDraftId: string;
      let boundRevision: string;

      if (draft === null) {
        const current = basis.current;

        if (current === null) return yield* failure("InternalError");
        boundDraftId = current.id;
        boundRevision = current.revision;
        yield* InboxDb.bindDraft(
          transaction,
          command.scope.bookId,
          command.occurrenceId,
          current.id,
          command.input.reason,
          command.input.attemptId,
        );
      } else {
        const created = yield* Shared.toJsonObject(draft);

        boundDraftId = Shared.textField(created, "id") ?? "";
        boundRevision = Shared.textField(created, "revision") ?? "";

        if (boundDraftId === "" || boundRevision === "") {
          return yield* failure("InternalError");
        }

        outcome = basis.current === null ? "draft_created" : "draft_revised";

        if (basis.current === null) {
          yield* InboxDb.bindDraft(
            transaction,
            command.scope.bookId,
            command.occurrenceId,
            boundDraftId,
            command.input.reason,
            command.input.attemptId,
          );
        }
      }

      const records = yield* appendFieldDecisions(
        transaction,
        command.scope,
        command.occurrenceId,
        command.requestId,
        command.input.attemptId,
        boundDraftId,
        boundRevision,
        command.input.reason,
        merge,
        chosen.selected,
        principal.actorId,
      );

      const fieldRecords = yield* Schema.decodeUnknownEffect(
        Schema.Array(Extraction.SupplierFieldDecisionRecord),
      )(records).pipe(Effect.mapError(() => failure("InternalError")));

      for (const record of fieldRecords) {
        const comparisons: Comparison[] = exposure.records.map((suggestion) => {
          const option =
            suggestion.ranked.source === "extraction"
              ? suggestion.ranked.options.find(
                  (field) =>
                    field.lineOrdinal === record.lineOrdinal && field.fieldKey === record.fieldKey,
                )
              : undefined;

          return {
            coverage: "complete",
            comparison:
              option === undefined
                ? "not_comparable"
                : option.value === record.selectedValue
                  ? "unchanged"
                  : "changed",
            dimensions: { lineOrdinal: record.lineOrdinal, fieldKey: record.fieldKey },
          };
        });

        yield* recordDecision(transaction, {
          bookId: command.scope.bookId,
          actorId: principal.actorId,
          kind: "extraction_field",
          id: record.id,
          subject: yield* Shared.toJsonObject(subject),
          selected: yield* Shared.toJsonObject({
            ...record,
            bookCommitSequence: book.committedSequence,
          }),
          exposure: {
            ...exposure,
            uncited:
              exposure.uncited ||
              (record.decisionKind === "accepted_suggestion" && exposure.records.length === 0),
          },
          comparisons,
        });
      }

      const result = yield* Shared.decode(ReviewSchema, {
        occurrenceId: command.occurrenceId,
        outcome,
        draft,
        correctionCase:
          outcome === "correction_case"
            ? {
                draftId: boundDraftId,
                acceptance: "accepted",
                requiredOwner: "correction_review",
                reason: command.input.reason,
                fields: merge.fields,
              }
            : null,
        fieldDecisions: records,
      });

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "commit_supplier_extraction_review",
        principal.actorId,
        yield* Shared.toJsonObject(result),
      );

      return result;
    }),
  );
});

type ExtractedReading = {
  readonly result: "succeeded" | "rejected_output" | "failed" | "unknown";
  readonly textDigest: string | null;
  readonly textByteLength: number;
  readonly fields: ReadonlyArray<JsonObject>;
  readonly candidateLines: ReadonlyArray<JsonObject>;
  readonly diagnostics: ReadonlyArray<JsonObject>;
  readonly document?: typeof Extraction.DocumentReadingEvidence.Type;
};

function fieldJson(
  lineOrdinal: number,
  fieldKey: string,
  value: string | null,
  locators: ReadonlyArray<string>,
) {
  return {
    lineOrdinal,
    fieldKey,
    proposedValue: value,
    sourceLocators: [...locators],
  } satisfies JsonObject;
}

// The engine runs on the retained original's own bytes, outside every financial
// lock. Its retained hash and length are verified before a single byte is read as
// text, and a failure is an extraction outcome, not a reason to delete anything.
function readOriginalBytes(
  content: RetentionDb.ContentRow,
  expectedHash: string,
  expectedBytes: number,
) {
  return Effect.gen(function* () {
    if (content.byteLength !== expectedBytes) return yield* failure("MissingEvidence");

    const bytes =
      content.content === null
        ? yield* readRetainedObject(yield* objectStore, {
            objectKey: content.objectKey ?? "",
            sha256: expectedHash,
            byteLength: expectedBytes,
          })
        : content.content;

    if (bytes.byteLength !== expectedBytes) return yield* failure("MissingEvidence");
    const verified = yield* sourceDigest(bytes);

    if (verified !== expectedHash) return yield* failure("MissingEvidence");

    return bytes;
  });
}

// A storage or decode failure is an extraction outcome, not a reason to delete the
// original. The specific reason is kept: an unavailable store, a missing or
// unverifiable object and an undecodable original are different facts, and
// collapsing them into one code would hide a configuration problem.
const readingFailureCodes = new Map<typeof Accounting.FailureCode.Type, string>([
  ["MissingEvidence", "retained_object_missing_or_unverified"],
  ["Unavailable", "retained_object_store_unavailable"],
  ["InvalidJournal", "original_not_decodable_text"],
]);

function readingFailureCode(error: unknown) {
  if (error instanceof Accounting.AccountingError) {
    return readingFailureCodes.get(error.code) ?? "original_not_extractable";
  }

  return "original_not_extractable";
}

function failedReading(code: string, detail: string): ExtractedReading {
  return {
    result: "failed",
    textDigest: null,
    textByteLength: 0,
    fields: [],
    candidateLines: [],
    diagnostics: [{ code, lineOrdinal: 0, fieldKey: "", detail }],
  };
}

function runNativeEngine(
  text: string,
  mediaType: string,
  currencyScale: number,
  pages: ReadonlyArray<ExtractionPage>,
  byteLength: number,
): ExtractedReading {
  if (!nativeTextMediaTypes.has(mediaType)) {
    return failedReading("media_type_not_supported", mediaType);
  }

  const extraction = readNativeTextExtraction(text, {
    currencyScale,
    selectedPages: pages,
    byteLength,
  });

  return {
    result: extraction.result,
    textDigest: null,
    textByteLength: byteLength,
    fields: extraction.fields.map((field) =>
      fieldJson(field.lineOrdinal, field.fieldKey, field.proposedValue, field.sourceLocators),
    ),
    candidateLines: extraction.candidateLines.map((line) => ({
      candidateLineId: line.candidateLineId,
      sourceLocators: [...line.sourceLocators],
      fields: line.fields.map((field) =>
        fieldJson(field.lineOrdinal, field.fieldKey, field.proposedValue, field.sourceLocators),
      ),
      content: line.content,
    })),
    diagnostics: extraction.diagnostics.map((entry) => ({
      code: entry.code,
      lineOrdinal: entry.lineOrdinal,
      fieldKey: entry.fieldKey,
      detail: entry.detail,
    })),
  };
}

function settleRequest(token: string, scope: Scope, requestId: string, state: string) {
  return Shared.withBook(token, scope, false, "update", (transaction) =>
    ExtractionDb.completeExtractionRequest(transaction, scope.bookId, requestId, state).pipe(
      Effect.asVoid,
      Effect.mapError(databaseFailure),
    ),
  );
}

function requestPages(request: ExtractionDb.ExtractionRequestRow) {
  return orderedPages(
    Shared.arrayField(request.body, "selectedPages").flatMap((page) => {
      if (!Shared.isJsonObject(page)) return [];
      const startByte = integerField(page, "startByte");
      const endByte = integerField(page, "endByte");
      const number = integerField(page, "page");

      if (startByte === null || endByte === null || number === null || number < 1) return [];

      return [{ page: number, startByte, endByte }];
    }),
    Number(request.originalBytes),
  );
}

// The handler the effect-mq runner calls. It re-resolves the current request and
// its cancellation fence inside the publication transaction and never publishes a
// result for a superseded or cancelled generation.
export const runSupplierExtraction = Effect.fn("purchases.extraction.run")(function* (
  scope: Scope,
  requestId: string,
) {
  const { bindings } = yield* RequestEnvironment;
  const token = bindings.OPENERP_PREPARATION_TOKEN;

  if (!token) return yield* failure("Unavailable");

  const captured = yield* Shared.withBook(token, scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* authorize(principal, "run_supplier_extraction");
      yield* requireExtractionAccess(transaction);
      const book = yield* Shared.readBook(transaction, scope.bookId);
      yield* Shared.requireNativeCommerceProfile(book.profile, book.authority);

      const request = (yield* ExtractionDb.readExtractionRequest(
        transaction,
        scope.bookId,
        requestId,
      ))[0];

      if (!request) return yield* failure("NotFound");

      const state = (yield* ExtractionDb.readExtractionState(
        transaction,
        scope.bookId,
        requestId,
      ))[0];

      if (!state) return yield* failure("InternalError");

      if (state.state !== "ready") return { terminal: state.state };

      const existing = (yield* ExtractionDb.readAttemptForRequest(
        transaction,
        scope.bookId,
        requestId,
      ))[0];

      if (existing) {
        yield* ExtractionDb.completeExtractionRequest(
          transaction,
          scope.bookId,
          requestId,
          "completed",
        );

        return { terminal: "completed" };
      }

      const occurrence = (yield* InboxDb.readOccurrence(
        transaction,
        scope.bookId,
        request.occurrenceId,
      ))[0];

      if (!occurrence) return yield* failure("NotFound");

      const content = (yield* RetentionDb.readExternalContent(
        transaction,
        scope.bookId,
        request.originalHash,
      ))[0];

      if (!content) return yield* failure("MissingEvidence");

      return {
        terminal: null,
        book,
        request,
        state,
        occurrence,
        content,
      };
    }).pipe(Effect.mapError(databaseFailure)),
  );

  if (captured.terminal !== null) return captured.terminal;

  const pages =
    captured.request.engineRelease === nativeTextEngine ? requestPages(captured.request) : [];

  if (pages === null) {
    yield* settleRequest(token, scope, requestId, "unknown");

    return "unknown";
  }

  const byteLength = Number(captured.request.originalBytes);

  const mediaType = Shared.textField(captured.occurrence.body, "mediaType") ?? "";

  if (captured.request.engineRelease === "azure-invoice-v1") {
    const outcome = yield* runDocumentReader(
      token,
      scope,
      captured.request,
      captured.content,
      mediaType,
    );

    if (outcome === null) return "ready";

    return yield* publishExtraction(token, scope, requestId, captured.state.cancelVersion, outcome);
  }

  const outcome = yield* readOriginalBytes(
    captured.content,
    captured.request.originalHash,
    byteLength,
  ).pipe(
    Effect.flatMap((bytes) =>
      Effect.try({
        try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
        catch: () =>
          new Accounting.AccountingError({
            code: "InvalidJournal",
            message: "Original is not valid UTF-8.",
          }),
      }),
    ),
    Effect.map((text) =>
      runNativeEngine(text, mediaType, captured.book.currencyScale, pages, byteLength),
    ),
    Effect.catch((error) => Effect.succeed(failedReading(readingFailureCode(error), ""))),
  );

  return yield* publishExtraction(token, scope, requestId, captured.state.cancelVersion, outcome);
});

function publishExtraction(
  token: string,
  scope: Scope,
  requestId: string,
  cancelVersion: number,
  outcome: ExtractedReading,
) {
  return Shared.withBook(token, scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* authorize(principal, "publish_supplier_extraction");
      yield* requireExtractionAccess(transaction);
      const book = yield* Shared.readBook(transaction, scope.bookId);
      yield* Shared.requireNativeCommerceProfile(book.profile, book.authority);

      const request = (yield* ExtractionDb.readExtractionRequest(
        transaction,
        scope.bookId,
        requestId,
      ))[0];

      if (!request) return yield* failure("NotFound");

      const state = (yield* ExtractionDb.readExtractionState(
        transaction,
        scope.bookId,
        requestId,
      ))[0];

      if (!state) return yield* failure("InternalError");

      // Recovery: one recorded result identity per request. A redelivered job
      // converges on the retained attempt instead of appending a second one.
      if (
        (yield* ExtractionDb.readAttemptForRequest(transaction, scope.bookId, requestId)).length > 0
      ) {
        return "completed";
      }

      const latest = (yield* ExtractionDb.readLatestExtractionRequest(
        transaction,
        scope.bookId,
        request.occurrenceId,
      ))[0];

      if (!latest || latest.generation !== request.generation) return "superseded";

      if (state.state !== "ready" || state.cancelVersion !== cancelVersion) return "cancelled";

      const occurrence = (yield* InboxDb.readOccurrence(
        transaction,
        scope.bookId,
        request.occurrenceId,
      ))[0];

      if (!occurrence || Shared.textField(occurrence.body, "sha256") !== request.originalHash) {
        return yield* failure("StaleDependency");
      }

      const ordinal =
        (yield* InboxDb.readAttemptCount(transaction, scope.bookId, request.occurrenceId))[0]!
          .total + 1;

      if (ordinal > maximumAttempts) return yield* failure("InvalidJournal");

      const interpreted: JsonObject = {
        result: outcome.result,
        engineRelease: request.engineRelease,
        originalHashUnchanged: true,
        sourceHash: request.originalHash,
        textDigest: outcome.textDigest,
        textByteLength: outcome.textByteLength,
        fields: request.body["dataUsePolicy"] === "retain_diagnostics" ? [] : outcome.fields,
        candidateLines:
          request.body["dataUsePolicy"] === "retain_diagnostics" ? [] : outcome.candidateLines,
        diagnostics: outcome.diagnostics,
      } satisfies JsonObject;

      const interpretation = outcome.document
        ? Object.assign({}, interpreted, { document: yield* Shared.toJsonObject(outcome.document) })
        : interpreted;

      const retainedOutputHash = yield* digest(yield* Shared.toJsonObject(interpretation));

      const attemptId = newId("supplier_extraction");
      const createdAt = yield* isoNow(transaction);

      const body = {
        id: attemptId,
        occurrenceId: request.occurrenceId,
        ordinal,
        createdBy: principal.actorId,
        createdAt,
        parserVersion: request.engineRelease,
        status: outcome.result,
        suggestions: [],
        diagnostics: outcome.diagnostics
          .map((entry) => Shared.textField(entry, "code") ?? "")
          .slice(0, 50),
        requestId,
        engineRelease: request.engineRelease,
        originalHashUnchanged: true,
        sourceHash: request.originalHash,
        textDigest: outcome.textDigest,
        textByteLength: outcome.textByteLength,
        retainedOutputHash,
        extraction: interpretation,
      } satisfies JsonObject;

      if (Shared.byteLength(JSON.stringify(body)) > 65536) {
        return yield* failure("InvalidJournal");
      }

      const key = yield* attemptIdentityKey(scope.bookId, requestId);

      const previous = yield* replay(
        transaction,
        scope,
        key,
        "run_supplier_extraction",
        request.requestedBy,
        { requestId, sourceHash: request.originalHash } satisfies JsonObject,
        Extraction.SupplierExtractionAttempt,
      );

      if (previous.previous) return "completed";

      const result = yield* Shared.decode(
        Extraction.SupplierExtractionAttempt,
        attemptBody({ id: attemptId, ordinal, body }, requestId),
      );

      yield* InboxDb.insertAttempt(transaction, {
        bookId: scope.bookId,
        id: attemptId,
        occurrenceId: request.occurrenceId,
        ordinal,
        body,
      });
      yield* ExtractionDb.completeExtractionRequest(
        transaction,
        scope.bookId,
        requestId,
        "completed",
      );
      yield* saveCommand(
        transaction,
        scope,
        key,
        previous.expected,
        "run_supplier_extraction",
        request.requestedBy,
        yield* Shared.toJsonObject(result),
      );

      return "completed";
    }).pipe(Effect.mapError(databaseFailure)),
  );
}

// Durable dispatch. The admitted request row is the application-owned intent; the
// effect-mq runner owns queue scheduling, claims and retries. A redelivered job
// converges on the one recorded result identity for its request.
export const claimPendingSupplierExtractions = Effect.fn("purchases.extraction.claimPending")(
  function* (token: string) {
    return yield* withTransaction((transaction) =>
      Effect.gen(function* () {
        const actorId = yield* admitRunnerActor(transaction, token);
        yield* requireExtractionAccess(transaction);

        return yield* ExtractionDb.claimReadyExtractionRequests(transaction, actorId);
      }).pipe(Effect.mapError(databaseFailure)),
    );
  },
);

/**
 * A request whose delivery is exhausted stops being claimed.
 *
 * The runner could not determine the outcome, so the request settles to
 * `unknown`: an existing reviewed state that means exactly that, and not
 * `completed`, which would claim a reading nobody observed. Settling removes the
 * row from the `ready` predicate its claim query selects, which also stops the
 * dispatch counter that would otherwise grow into its ceiling and stop the claim
 * transaction for every other request in the installation.
 *
 * The state row is only moved out of `ready`, so a handler that is still working
 * on this request cannot be overwritten here, and a request that already reached a
 * terminal state is left alone.
 */
export const stopFailedExtractionDelivery = Effect.fn("purchases.extraction.stopFailedDelivery")(
  function* (payload: { requestId: string; scope: Scope }) {
    const { bindings } = yield* RequestEnvironment;
    const token = bindings.OPENERP_PREPARATION_TOKEN;

    if (!token) return yield* failure("Unavailable");

    return yield* Shared.withBook(token, payload.scope, false, "update", (transaction, principal) =>
      Effect.gen(function* () {
        yield* authorize(principal, "stop_supplier_extraction_delivery");
        yield* requireExtractionAccess(transaction);

        yield* ExtractionDb.completeExtractionRequest(
          transaction,
          payload.scope.bookId,
          payload.requestId,
          "unknown",
        );
      }).pipe(Effect.mapError(databaseFailure)),
    );
  },
);

function runDocumentReader(
  token: string,
  scope: Scope,
  request: ExtractionDb.ExtractionRequestRow,
  content: RetentionDb.ContentRow,
  mediaType: string,
) {
  return Effect.gen(function* () {
    const reader = (yield* RequestEnvironment).bindings.DOCUMENT_READER;

    if (!reader)
      return failedReading("document_reader_disabled", "Document reading is not enabled.");

    const bytes = yield* readOriginalBytes(
      content,
      request.originalHash,
      Number(request.originalBytes),
    );

    const inspector = (yield* RequestEnvironment).bindings.DOCUMENT_INSPECTOR;

    if (!inspector)
      return failedReading(
        "inspection_isolation_unavailable",
        "Isolated document inspection is unavailable.",
      );

    const inspection = yield* Effect.tryPromise({
      try: () => inspector(bytes, mediaType),
      catch: (error) => (error instanceof Error ? error.message : "inspection_failed"),
    }).pipe(Effect.result);

    if (Result.isFailure(inspection)) {
      if (inspection.failure === "inspection_capacity") return null;

      return failedReading(
        inspection.failure,
        "Inspection could not complete. Review the retained original manually. An earlier reader submission may exist.",
      );
    }

    const physicalPages = inspection.success.pages.length;

    const claimed = yield* Shared.withBook(token, scope, false, "update", (transaction) =>
      Effect.gen(function* () {
        const book = yield* Shared.readBook(transaction, scope.bookId);
        yield* Shared.requireNativeCommerceProfile(book.profile, book.authority);

        const state = (yield* ExtractionDb.readExtractionState(
          transaction,
          scope.bookId,
          request.id,
        ))[0];

        const latest = (yield* ExtractionDb.readLatestExtractionRequest(
          transaction,
          scope.bookId,
          request.occurrenceId,
        ))[0];

        if (state?.state !== "ready" || latest?.id !== request.id) return null;

        return yield* ExtractionDb.claimDocumentOperation(
          transaction,
          scope.bookId,
          request.id,
          reader.identity,
        );
      }).pipe(Effect.mapError(databaseFailure)),
    );

    if (claimed === null) return null;

    let operation: string;

    if (claimed.length > 0) {
      const submitted = yield* Effect.tryPromise(() => reader.submit(bytes)).pipe(Effect.option);

      if (Option.isNone(submitted))
        return {
          ...failedReading(
            "submission_unknown",
            "The reader may have received the document. This request will not be sent again.",
          ),
          result: "unknown" as const,
        };
      operation = submitted.value;
      yield* Shared.withBook(token, scope, false, "update", (transaction) =>
        ExtractionDb.saveDocumentOperation(transaction, scope.bookId, request.id, operation).pipe(
          Effect.mapError(databaseFailure),
        ),
      );
    } else {
      const stored = yield* Shared.withBook(token, scope, false, "share", (transaction) =>
        ExtractionDb.readDocumentOperation(transaction, scope.bookId, request.id).pipe(
          Effect.mapError(databaseFailure),
        ),
      );

      const previous = stored[0];

      // A concurrent submit or a crash after disclosure is never a reason to POST again.
      if (!previous?.operationUrl) {
        return previous?.dispatchExpired
          ? {
              ...failedReading(
                "submission_unknown",
                "No operation receipt was retained. This request will not be sent again.",
              ),
              result: "unknown" as const,
            }
          : null;
      }

      if (previous.readerIdentity !== reader.identity)
        return failedReading(
          "reader_configuration_changed",
          "The original reader configuration is required to resume.",
        );
      operation = previous.operationUrl;
    }

    const polled = yield* Effect.tryPromise({
      try: () => reader.poll(operation),
      catch: (error) =>
        error instanceof DocumentOutputError
          ? ("invalid_output" as const)
          : ("poll_unavailable" as const),
    }).pipe(Effect.result);

    if (Result.isFailure(polled))
      return polled.failure === "invalid_output"
        ? {
            ...failedReading(
              "reader_output_rejected",
              "The response was not bounded, unambiguous JSON.",
            ),
            result: "rejected_output" as const,
          }
        : null;

    const status = Schema.decodeUnknownOption(Schema.Struct({ status: Schema.String }))(
      polled.success,
    );

    if (Option.isSome(status) && ["running", "notStarted"].includes(status.value.status))
      return null;

    if (Option.isSome(status) && status.value.status === "failed")
      return failedReading(
        "provider_failed",
        "The document reader reported a failure. The original remains available.",
      );

    return yield* Effect.try({
      try: () => {
        const parsed = interpretDocument(polled.success, physicalPages, inspection.success);

        if (Shared.byteLength(JSON.stringify(parsed)) > 48000)
          throw new DocumentReadingError("reader_retained_size");

        return parsed;
      },
      catch: (error) =>
        error instanceof DocumentReadingError
          ? error
          : new DocumentReadingError("reader_output_schema"),
    }).pipe(
      Effect.flatMap((parsed) =>
        Effect.gen(function* () {
          return {
            result: "succeeded" as const,
            textDigest: `sha256:${yield* sha256Hex(parsed.document.transcript)}`,
            textByteLength: new TextEncoder().encode(parsed.document.transcript).length,
            fields: yield* Schema.encodeEffect(Schema.Array(Extraction.ExtractedField))(
              parsed.fields,
            ).pipe(
              Effect.flatMap(Shared.toJson),
              Effect.map((values) =>
                Array.isArray(values) ? values.filter(Shared.isJsonObject) : [],
              ),
            ),
            candidateLines: yield* Schema.encodeEffect(Schema.Array(Extraction.ExtractedLine))(
              parsed.candidateLines,
            ).pipe(
              Effect.flatMap(Shared.toJson),
              Effect.map((values) =>
                Array.isArray(values) ? values.filter(Shared.isJsonObject) : [],
              ),
            ),
            diagnostics: parsed.diagnostics,
            document: parsed.document,
          } satisfies ExtractedReading;
        }),
      ),
      Effect.catch((error) => {
        const rejected = failedReading(
          "reader_output_rejected",
          "The response could not be matched to bounded page evidence.",
        );

        return Effect.succeed({
          ...rejected,
          diagnostics: [
            ...rejected.diagnostics,
            {
              code: error instanceof DocumentReadingError ? error.code : "reader_output_schema",
              lineOrdinal: 0,
              fieldKey: "",
              detail:
                "The reader response failed this evidence or capacity check. Review the original manually.",
            },
          ],
          result: "rejected_output" as const,
        });
      }),
    );
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(
        failedReading(
          "document_reading_failed",
          "The retained original could not be read within this document profile.",
        ),
      ),
    ),
  );
}
