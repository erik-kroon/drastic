import * as Accounting from "@open-erp/contracts/accounting";
import * as Extraction from "@open-erp/contracts/supplier-extraction";
import * as SupplierDrafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

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
  readonly base: JsonObject;
};

function requireExtractionAccess(transaction: Transaction) {
  return Shared.requireTables(transaction, extractionTables, extractionInserts, extractionUpdates);
}

function integerField(value: JsonObject, key: string) {
  const found = value[key];

  return typeof found === "number" && Number.isInteger(found) && found >= 0 ? found : null;
}

function stringList(value: JsonObject, key: string) {
  return Shared.arrayField(value, key).filter((item): item is string => typeof item === "string");
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
    createdAt: Shared.textField(structured, "createdAt") ?? "",
  });
}

function mergeSuggestions(body: JsonObject) {
  const suggestions: MergeSuggestion[] = [];

  for (const field of Shared.arrayField(body, "fields")) {
    if (!Shared.isJsonObject(field)) continue;
    const fieldKey = Shared.textField(field, "fieldKey");

    if (fieldKey === undefined || !isFieldKey(fieldKey)) continue;
    suggestions.push({
      candidateLineId: null,
      fieldKey,
      proposedValue: field["proposedValue"] ?? null,
      sourceLocators: stringList(field, "sourceLocators"),
    });
  }

  for (const line of Shared.arrayField(body, "candidateLines")) {
    if (!Shared.isJsonObject(line)) continue;
    const candidateLineId = Shared.textField(line, "candidateLineId");

    if (candidateLineId === undefined) continue;

    for (const field of Shared.arrayField(line, "fields")) {
      if (!Shared.isJsonObject(field)) continue;
      const fieldKey = Shared.textField(field, "fieldKey");

      if (fieldKey === undefined || !isFieldKey(fieldKey)) continue;
      suggestions.push({
        candidateLineId,
        fieldKey,
        proposedValue: field["proposedValue"] ?? null,
        sourceLocators: stringList(field, "sourceLocators"),
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

function readRetainedDecisions(transaction: Transaction, bookId: string, draftId: string | null) {
  if (draftId === null) return Effect.succeed([] as const);

  return ExtractionDb.readFieldDecisionsForDraft(transaction, bookId, draftId).pipe(
    Effect.map((rows) =>
      rows.map((row) => ({
        lineOrdinal: row.lineOrdinal,
        fieldKey: row.fieldKey,
        decisionKind: row.decisionKind,
        baseValue: Shared.objectField(row.body, "baseValue")[row.fieldKey] ?? null,
        selectedValue: Shared.objectField(row.body, "selectedValue")[row.fieldKey] ?? null,
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

      if (command.input.engineRelease !== nativeTextEngine) {
        return yield* failure("UnsupportedProfile");
      }

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

      const pages = orderedPages(command.input.selectedPages, originalBytes);

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

      const selection = yield* digest(yield* Shared.toJsonObject(pageJson(pages)));

      const attemptIdentity = `sha256:${yield* sha256Hex(
        `${command.scope.bookId}:${command.occurrenceId}:${originalHash}:${nativeTextEngine}:${selection}`,
      )}`;

      const requestId = newId("supplier_extraction_request");
      const requestedAt = yield* isoNow(transaction);

      const sealed = Object.assign(
        {},
        {
          id: requestId,
          occurrenceId: command.occurrenceId,
          generation,
          engineRelease: nativeTextEngine,
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
        },
        { digest: "" },
      ) satisfies JsonObject;

      const body = Object.assign({}, sealed, { digest: yield* digest(sealed) });

      yield* ExtractionDb.insertExtractionRequest(transaction, {
        bookId: command.scope.bookId,
        id: requestId,
        occurrenceId: command.occurrenceId,
        generation,
        originalHash,
        originalBytes: String(originalBytes),
        engineRelease: nativeTextEngine,
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
            engineRelease: nativeTextEngine,
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

      const target = (yield* ExtractionDb.readExtractionRequestForUpdate(
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
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
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

      return yield* Shared.decode(StateSchema, {
        scope: command.scope,
        occurrenceId: command.occurrenceId,
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
// basis. Preparation and commit share it so they cannot disagree about the base.
function readReviewBasis(
  transaction: Transaction,
  bookId: string,
  occurrenceId: string,
  requestId: string,
  attemptId: string,
  expectedRevision: string | null,
  expectedDigest: string | null,
  baseContent: JsonObject | null,
) {
  return Effect.gen(function* () {
    const entry = (yield* InboxDb.readInboxForUpdate(transaction, bookId, occurrenceId))[0];

    if (!entry) return yield* failure("NotFound");

    const request = (yield* ExtractionDb.readExtractionRequestForUpdate(
      transaction,
      bookId,
      requestId,
    ))[0];

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

    const attempt = (yield* ExtractionDb.readAttemptForRequest(
      transaction,
      bookId,
      requestId,
    )).find((row) => row.id === attemptId);

    if (!attempt) return yield* failure("NotFound");

    const current =
      entry.draftId === null ? null : yield* readCapturedDraft(transaction, bookId, entry.draftId);

    const accepted =
      current !== null &&
      (yield* readSealedDraft(transaction, bookId, current.id, "supplier")).length > 0;

    if (current === null && expectedRevision !== null) return yield* failure("StaleDependency");

    if (
      current !== null &&
      (current.revision !== expectedRevision || current.digest !== expectedDigest)
    ) {
      return yield* failure("StaleDependency");
    }

    if (current === null && baseContent === null) return yield* failure("InvalidJournal");

    const capturedBaseDraftId = Shared.textField(request.body, "baseDraftId");
    let base: JsonObject;

    if (capturedBaseDraftId === undefined) {
      base = yield* Shared.toJsonObject(baseContent);
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

export const prepareSupplierExtractionReview = Effect.fn("purchases.extraction.prepare")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly occurrenceId: string;
    readonly requestId: string;
    readonly attemptId: string;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction) =>
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
        null,
        null,
        null,
      );

      const retained = yield* readRetainedDecisions(
        transaction,
        command.scope.bookId,
        basis.current === null ? null : basis.current.id,
      );

      const currentContent = basis.current === null ? basis.base : basis.current.content;

      const merge = proposalState(basis.base, currentContent, basis.attempt.body, [], retained);

      const uncalculated = contentDiscrepancies(merge.proposed);
      const discrepancies = [...merge.discrepancies, ...uncalculated];

      const calculated =
        uncalculated.length === 0
          ? yield* calculateSupplierDraft(transaction, command.scope.bookId, book, merge.proposed)
          : null;

      return yield* Shared.decode(PreparationSchema, {
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
        proposed: basis.current === null ? null : merge.proposed,
        proposedTotals: calculated === null ? null : Shared.objectField(calculated, "totals"),
        proposedBlockers: calculated === null ? [] : Shared.arrayField(calculated, "blockers"),
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

    for (const [ordinal, field] of chosen.entries()) {
      const merged = merge.fields.find(
        (candidate) =>
          candidate.lineOrdinal === field.lineOrdinal && candidate.fieldKey === field.fieldKey,
      );

      const id = newId("supplier_field_decision");

      const sealed = Object.assign(
        {},
        {
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
        },
        { digest: "", recordedAt: "" },
      ) satisfies JsonObject;

      const body = Object.assign({}, sealed, {
        recordedAt: yield* isoNow(transaction),
        digest: yield* digest(sealed),
      });

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
        command.input.expectedDraftRevision,
        command.input.expectedDraftDigest,
        baseContent,
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
        basis.attempt.body,
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

      const draft = yield* basis.current === null
        ? createSupplierInvoiceDraftInTransaction(transaction, principal, {
            scope: command.scope,
            idempotencyKey: command.idempotencyKey,
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
              idempotencyKey: command.idempotencyKey,
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
function readOriginalText(
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

    return yield* Effect.try({
      try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
      catch: () => failure("InvalidJournal"),
    });
  });
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

function settleRequest(bookId: string, requestId: string, state: string) {
  return withTransaction((transaction) =>
    ExtractionDb.completeExtractionRequest(transaction, bookId, requestId, state).pipe(
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
  const captured = yield* withTransaction((transaction) =>
    Effect.gen(function* () {
      yield* requireExtractionAccess(transaction);

      const request = (yield* ExtractionDb.readExtractionRequestForUpdate(
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
        request,
        state,
        occurrence,
        content,
        existing:
          (yield* ExtractionDb.readAttemptForRequest(transaction, scope.bookId, requestId))[0] ??
          null,
      };
    }).pipe(Effect.mapError(databaseFailure)),
  );

  if (captured.existing !== null) {
    yield* settleRequest(scope.bookId, requestId, "completed");

    return "completed";
  }

  if (captured.state.state !== "ready") return captured.state.state;

  const pages = requestPages(captured.request);

  if (pages === null) {
    yield* settleRequest(scope.bookId, requestId, "unknown");

    return "unknown";
  }

  const byteLength = Number(captured.request.originalBytes);

  const book = yield* withTransaction((transaction) =>
    Shared.PurchaseDb.lockBook(transaction, scope.bookId, "share").pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined ? failure("Forbidden") : Effect.succeed(rows[0]!),
      ),
      Effect.mapError(databaseFailure),
    ),
  );

  const mediaType = Shared.textField(captured.occurrence.body, "mediaType") ?? "";

  const outcome = yield* readOriginalText(
    captured.content,
    captured.request.originalHash,
    byteLength,
  ).pipe(
    Effect.map((text) => runNativeEngine(text, mediaType, book.currencyScale, pages, byteLength)),
    // A provider timeout, an undecodable original or a missing retained object is
    // an extraction outcome, not a reason to delete the original.
    Effect.orElseSucceed(() => failedReading("original_not_extractable", "")),
  );

  return yield* publishExtraction(scope, requestId, captured.state.cancelVersion, outcome);
});

function publishExtraction(
  scope: Scope,
  requestId: string,
  cancelVersion: number,
  outcome: ExtractedReading,
) {
  return withTransaction((transaction) =>
    Effect.gen(function* () {
      yield* requireExtractionAccess(transaction);

      const request = (yield* ExtractionDb.readExtractionRequestForUpdate(
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

      const interpretation = {
        result: outcome.result,
        engineRelease: nativeTextEngine,
        sourceHash: request.originalHash,
        originalHashUnchanged: true,
        textDigest: outcome.textDigest,
        textByteLength: outcome.textByteLength,
        fields: outcome.fields,
        candidateLines: outcome.candidateLines,
        extractionDiagnostics: outcome.diagnostics,
      } satisfies JsonObject;

      const retainedOutputHash = yield* digest(yield* Shared.toJsonObject(interpretation));

      const attemptId = newId("supplier_extraction");
      const createdAt = yield* isoNow(transaction);

      const body = {
        id: attemptId,
        occurrenceId: request.occurrenceId,
        ordinal,
        createdBy: request.requestedBy,
        createdAt,
        parserVersion: nativeTextEngine,
        status: outcome.result,
        suggestions: [],
        diagnostics: outcome.diagnostics
          .map((entry) => Shared.textField(entry, "code") ?? "")
          .slice(0, 50),
        requestId,
        engineRelease: nativeTextEngine,
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
        yield* Shared.toJsonObject(attemptBody({ id: attemptId, ordinal, body }, requestId)),
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
        yield* admitRunnerActor(transaction, token);
        yield* requireExtractionAccess(transaction);

        return yield* ExtractionDb.claimReadyExtractionRequests(transaction);
      }).pipe(Effect.mapError(databaseFailure)),
    );
  },
);
