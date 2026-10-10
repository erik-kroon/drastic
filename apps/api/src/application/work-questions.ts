import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Workspace from "@open-erp/contracts/workspace";
import type { Transaction } from "../db/transaction";
import * as Db from "../db/work-questions";
import * as WorkspaceDb from "../db/workspace";
import { readCandidateSource } from "../db/banking/candidates";
import { RequestEnvironment } from "../runtime/environment";
import { failure } from "./failures";
import { digest } from "./json";
import { isoNow, replay, saveCommand } from "./command-receipts";
import { newId } from "./identifiers";
import {
  decode,
  requireInsertAccess,
  requireTableAccess,
  toJsonObject,
  withBook,
} from "./commerce/support";
import {
  readSourceBytesInTransaction,
  readSourceOccurrenceInTransaction,
} from "./source-retention";

type Scope = typeof Accounting.Scope.Type;

type Target = typeof Workspace.QuestionTarget.Type;

type Root = typeof Workspace.QuestionRoot.Type;

type Owner = (typeof Workspace.WorkQuestionsView.Type)["owner"];

type Question = typeof Workspace.WorkQuestion.Type;

type Attachment = typeof Workspace.QuestionAttachment.Type;

const maximumQuestions = 50;

const maximumRevisions = 50;

function questionText(value: string) {
  const text = value.trim();

  return text.length > 0 ? Effect.succeed(text) : failure("InvalidJournal");
}

const readTables = [
  ...WorkspaceDb.workspaceTables,
  ...Db.questionTables,
  "bank_statements",
  "bank_observations",
  "bank_sources",
  "bank_active_matches",
  "bank_active_allocation_legs",
  "evidence",
  "accounts",
];

const Anchor = Schema.Struct({
  id: Workspace.WorkQuestion.fields.id,
  scope: Accounting.Scope,
  root: Workspace.QuestionRoot,
  kind: Workspace.WorkQuestion.fields.kind,
  question: Workspace.WorkQuestion.fields.question,
  askedBy: Accounting.Identifier,
  requestedFrom: Accounting.Identifier,
  createdAt: Schema.String,
});

function root(scope: Scope, kind: Root["kind"], recordId: string, rowOrdinal: number | null): Root {
  return {
    kind,
    recordId,
    rowOrdinal,
    key: `${scope.entityId}/${scope.bookId}/${kind}/${recordId}/${rowOrdinal ?? ""}`,
  };
}

function supplierOwner(tx: Transaction, scope: Scope, draftId: string) {
  return Effect.gen(function* () {
    const row = (yield* Db.readSupplierLineage(tx, scope.bookId, draftId))[0];

    if (!row) return yield* failure("NotFound");

    if (row.occurrenceIds.length > 1) return yield* failure("InternalError");
    const occurrenceId = row.occurrenceIds[0];

    const taskRoot = occurrenceId
      ? root(scope, "document", occurrenceId, null)
      : root(scope, "supplier", draftId, null);

    const owner: Owner =
      row.reviewPlanId && row.reviewPlanDigest
        ? {
            target: { kind: "journal", recordId: row.reviewPlanId },
            revision: row.reviewPlanDigest,
            completed: row.completed,
          }
        : {
            target: { kind: "supplier", recordId: draftId },
            revision: row.digest,
            completed: row.completed,
          };

    return { root: taskRoot, owner };
  });
}

function documentOwner(tx: Transaction, scope: Scope, occurrenceId: string) {
  return Effect.gen(function* () {
    const lineage = (yield* Db.readDocumentLineage(tx, scope.bookId, occurrenceId))[0];

    if (!lineage) return yield* failure("NotFound");

    if (lineage.draftId) return yield* supplierOwner(tx, scope, lineage.draftId);

    const observed = (yield* WorkspaceDb.readQuestionAttentionOwner(
      tx,
      scope.bookId,
      "document",
      occurrenceId,
    ))[0];

    if (!observed) return yield* failure("NotFound");

    return {
      root: root(scope, "document", occurrenceId, null),
      owner: {
        target: { kind: "document" as const, recordId: occurrenceId },
        revision: observed.revision,
        completed: observed.state === "completed",
      },
    };
  });
}

function bankOwner(tx: Transaction, scope: Scope, target: Extract<Target, { kind: "bank" }>) {
  return Effect.gen(function* () {
    const row = (yield* readCandidateSource(
      tx,
      scope.bookId,
      target.recordId,
      target.rowOrdinal,
    ))[0];

    if (!row) return yield* failure("NotFound");

    const revision = yield* digest(
      yield* toJsonObject({
        statementId: row.statementId,
        rowOrdinal: row.rowOrdinal,
        sourceRevision: row.sourceRevision,
        evidenceId: row.evidenceId,
        evidenceSha256: row.evidenceSha256,
        amountMinor: row.amountMinor,
        allocatedMinor: row.allocatedMinor,
      }),
    );

    return {
      root: root(scope, "bank", target.recordId, target.rowOrdinal),
      owner: { target, revision, completed: row.amountMinor === row.allocatedMinor },
    };
  });
}

export function resolveQuestionOwner(tx: Transaction, scope: Scope, target: Target) {
  return Effect.gen(function* () {
    if (target.kind === "document") return yield* documentOwner(tx, scope, target.recordId);

    if (target.kind === "supplier") return yield* supplierOwner(tx, scope, target.recordId);

    if (target.kind === "bank") return yield* bankOwner(tx, scope, target);
    const review = (yield* Db.readNativeReviewDraft(tx, scope.bookId, target.recordId))[0];

    if (!review) return yield* failure("NotFound");

    return yield* supplierOwner(tx, scope, review.draftId);
  });
}

function requireQuestionAccess(tx: Transaction, write: boolean) {
  return Effect.gen(function* () {
    yield* requireTableAccess(tx, readTables, false);

    if (write) yield* requireInsertAccess(tx, [...Db.questionTables, "command_receipts"]);
  });
}

export function questionSummary(tx: Transaction, scope: Scope, target: Target) {
  return Effect.gen(function* () {
    yield* requireQuestionAccess(tx, false);
    const resolved = yield* resolveQuestionOwner(tx, scope, target);
    const counts = (yield* Db.readQuestionSummary(tx, scope.bookId, resolved.root.key))[0];

    if (!counts) return yield* failure("InternalError");

    if (counts.total > maximumQuestions) return yield* failure("Unavailable");

    return {
      root: resolved.root,
      summary: {
        unresolved: counts.unresolved,
        open: counts.open,
        answered: counts.answered,
        waitingOn: counts.waitingOn,
      } satisfies typeof Workspace.QuestionSummary.Type,
    };
  });
}

export function requireResolvedSupplierQuestions(tx: Transaction, scope: Scope, draftId: string) {
  return Effect.gen(function* () {
    const questions = yield* questionSummary(tx, scope, { kind: "supplier", recordId: draftId });

    if (questions.summary.unresolved > 0) return yield* failure("MissingEvidence");
  });
}

function inspectContent(bytes: Uint8Array, mediaType: string) {
  if (["application/pdf", "image/png", "image/jpeg"].includes(mediaType))
    return Effect.flatMap(RequestEnvironment, ({ bindings }) =>
      Effect.tryPromise({
        try: () =>
          bindings.DOCUMENT_INSPECTOR
            ? bindings.DOCUMENT_INSPECTOR(bytes, mediaType)
            : Promise.reject(new Error("inspection_isolation_unavailable")),
        catch: (error) => (error instanceof Error ? error.message : "inspection_failed"),
      }).pipe(
        Effect.as("readable" as const),
        Effect.orElseSucceed((code) =>
          [
            "document_invalid",
            "pdf_signature",
            "image_profile",
            "page_limit",
            "document_size",
          ].includes(code)
            ? ("unreadable" as const)
            : ("unavailable" as const),
        ),
      ),
    );

  if (["text/plain", "text/csv", "application/json", "application/xml"].includes(mediaType))
    return Effect.try({
      try: () =>
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes).trim().length > 0,
      catch: () => "unreadable" as const,
    }).pipe(
      Effect.map((valid) => (valid ? ("readable" as const) : ("unreadable" as const))),
      Effect.orElseSucceed(() => "unreadable" as const),
    );

  return Effect.succeed("unreadable" as const);
}

function inspectAttachment(
  tx: Transaction,
  scope: Scope,
  reference: typeof Workspace.QuestionAttachmentReference.Type,
) {
  return Effect.gen(function* () {
    const occurrence = yield* readSourceOccurrenceInTransaction(tx, scope, reference.occurrenceId);

    if (occurrence.sha256 !== reference.sha256) return yield* failure("MissingEvidence");

    const availability = yield* readSourceBytesInTransaction(
      tx,
      scope,
      reference.occurrenceId,
    ).pipe(
      Effect.flatMap((source) => inspectContent(source.bytes, source.occurrence.mediaType)),
      Effect.orElseSucceed(() => "unavailable" as const),
    );

    return {
      occurrenceId: occurrence.id,
      sha256: occurrence.sha256,
      filename: occurrence.filename,
      mediaType: occurrence.mediaType,
      byteLength: occurrence.byteLength,
      availability,
    } satisfies Attachment;
  });
}

function readQuestion(tx: Transaction, scope: Scope, questionId: string) {
  return Effect.gen(function* () {
    const row = (yield* Db.readQuestionAnchor(tx, scope.bookId, questionId))[0];

    if (!row) return yield* failure("NotFound");
    const anchor = yield* decode(Anchor, row.body);

    if (anchor.scope.entityId !== scope.entityId || anchor.scope.bookId !== scope.bookId)
      return yield* failure("InternalError");
    const revisions = yield* Db.readQuestionRevisions(tx, scope.bookId, questionId);

    if (revisions.length < 1 || revisions.length > maximumRevisions)
      return yield* failure("Unavailable");

    const events = yield* Effect.forEach(revisions, (revision) =>
      decode(Workspace.QuestionEvent, revision.body),
    );

    if (events.some((event, index) => event.revision !== index + 1))
      return yield* failure("InternalError");
    const latest = revisions.at(-1);
    const lastEvent = events.at(-1);

    if (!latest || !lastEvent) return yield* failure("InternalError");

    return yield* decode(Workspace.WorkQuestion, {
      ...anchor,
      state: latest.state,
      revision: lastEvent.revision,
      waitingOn: latest.waitingOn,
      events,
    });
  });
}

function currentQuestionAttachments(question: Question) {
  return (
    question.events.findLast((event) => event.action === "answered" && event.attachments.length > 0)
      ?.attachments ?? []
  );
}

function cachedAttachment(
  tx: Transaction,
  scope: Scope,
  attachment: Attachment,
  cache: Map<string, Attachment>,
) {
  return Effect.gen(function* () {
    const key = `${attachment.occurrenceId}/${attachment.sha256}`;
    const existing = cache.get(key);

    if (existing) return existing;

    const inspected = yield* inspectAttachment(tx, scope, attachment).pipe(
      Effect.orElseSucceed(() => ({ ...attachment, availability: "unavailable" as const })),
    );

    cache.set(key, inspected);

    return inspected;
  });
}

function requireAttachmentBudget(
  tx: Transaction,
  scope: Scope,
  taskRoot: Root,
  attachments: readonly Attachment[],
) {
  return Effect.gen(function* () {
    const retained = yield* Db.readRootAttachments(tx, scope.bookId, taskRoot.key);
    const sizes = new Map(retained.map((item) => [item.occurrenceId, item.byteLength]));

    for (const attachment of attachments) sizes.set(attachment.occurrenceId, attachment.byteLength);

    if (
      sizes.size > 10 ||
      Array.from(sizes.values()).reduce((total, size) => total + size, 0) > 10 * 1024 * 1024
    )
      return yield* failure("Unavailable");
  });
}

function availableQuestion(
  tx: Transaction,
  scope: Scope,
  question: Question,
  cache: Map<string, Attachment>,
) {
  return Effect.gen(function* () {
    const events = yield* Effect.forEach(question.events, (event) =>
      Effect.gen(function* () {
        const attachments = yield* Effect.forEach(event.attachments, (attachment) =>
          cachedAttachment(tx, scope, attachment, cache),
        );

        return { ...event, attachments };
      }),
    );

    return { ...question, events };
  });
}

function checkedOwner(tx: Transaction, scope: Scope, target: Target, expectedRevision: string) {
  return Effect.gen(function* () {
    const resolved = yield* resolveQuestionOwner(tx, scope, target);

    if (resolved.owner.revision !== expectedRevision) return yield* failure("StaleDependency");

    return resolved;
  });
}

function checkedQuestion(question: Question, taskRoot: Root, expectedRevision: number) {
  return Effect.gen(function* () {
    if (question.root.key !== taskRoot.key) return yield* failure("NotFound");

    if (question.revision !== expectedRevision) return yield* failure("StaleDependency");

    if (question.revision >= maximumRevisions) return yield* failure("Unavailable");

    if (question.state === "closed") return yield* failure("StaleDependency");
  });
}

function appendEvent(
  tx: Transaction,
  scope: Scope,
  question: Question,
  event: typeof Workspace.QuestionEvent.Type,
  state: Question["state"],
  waitingOn: string | null,
) {
  return Effect.gen(function* () {
    yield* Db.insertQuestionRevision(tx, {
      bookId: scope.bookId,
      questionId: question.id,
      revision: event.revision,
      state,
      waitingOn,
      body: yield* toJsonObject(event),
    });
    yield* Effect.forEach(event.attachments, (attachment, index) =>
      Db.insertQuestionAttachment(tx, {
        bookId: scope.bookId,
        questionId: question.id,
        revision: event.revision,
        ordinal: index + 1,
        occurrenceId: attachment.occurrenceId,
        sha256: attachment.sha256,
      }),
    );

    return yield* decode(Workspace.WorkQuestionResult, {
      scope,
      question: {
        ...question,
        state,
        waitingOn,
        revision: event.revision,
        events: [...question.events, event],
      },
    });
  });
}

export const readWorkQuestions = Effect.fn("workspace.questions.read")(function* (
  token: string,
  command: { scope: Scope; target: Target },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* requireQuestionAccess(tx, false);
    const resolved = yield* resolveQuestionOwner(tx, command.scope, command.target);
    const rows = yield* Db.readQuestionAnchors(tx, command.scope.bookId, resolved.root.key);

    if (rows.length > maximumQuestions) return yield* failure("Unavailable");
    yield* requireAttachmentBudget(tx, command.scope, resolved.root, []);
    const cache = new Map<string, Attachment>();

    const questions = yield* Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        const anchor = yield* decode(Anchor, row.body);
        const question = yield* readQuestion(tx, command.scope, anchor.id);

        return yield* availableQuestion(tx, command.scope, question, cache);
      }),
    );

    return yield* decode(Workspace.WorkQuestionsView, {
      scope: command.scope,
      actorId: principal.actorId,
      ...resolved,
      questions,
    });
  });
});

export const askWorkQuestion = Effect.fn("workspace.questions.ask")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Workspace.AskWorkQuestion.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireQuestionAccess(tx, true);

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        "workspace_ask_question",
        principal.actorId,
        yield* toJsonObject(command.input),
        Workspace.WorkQuestionResult,
      );

      if (request.previous) return request.previous;

      const resolved = yield* checkedOwner(
        tx,
        command.scope,
        command.input.target,
        command.input.expectedTargetRevision,
      );

      if (resolved.owner.completed && resolved.root.kind !== "bank")
        return yield* failure("AlreadyPosted");

      const member = (yield* WorkspaceDb.readBookMembershipRole(
        tx,
        command.scope.bookId,
        command.input.requestedFrom,
      ))[0];

      if (!member || member.role !== "operator") return yield* failure("InvalidJournal");
      const rows = yield* Db.readQuestionAnchors(tx, command.scope.bookId, resolved.root.key);

      if (rows.length >= maximumQuestions) return yield* failure("Unavailable");

      const anchor = yield* decode(Anchor, {
        id: newId("work_question"),
        scope: command.scope,
        root: resolved.root,
        kind: command.input.kind,
        question: yield* questionText(command.input.question),
        askedBy: principal.actorId,
        requestedFrom: command.input.requestedFrom,
        createdAt: yield* isoNow(tx),
      });

      yield* Db.insertQuestion(tx, {
        bookId: command.scope.bookId,
        id: anchor.id,
        rootKey: anchor.root.key,
        occurrenceId: anchor.root.kind === "document" ? anchor.root.recordId : null,
        supplierDraftId: anchor.root.kind === "supplier" ? anchor.root.recordId : null,
        statementId: anchor.root.kind === "bank" ? anchor.root.recordId : null,
        rowOrdinal: anchor.root.rowOrdinal,
        body: yield* toJsonObject(anchor),
      });

      const event = yield* decode(Workspace.QuestionEvent, {
        revision: 1,
        action: "asked",
        actorId: principal.actorId,
        createdAt: anchor.createdAt,
        text: anchor.question,
        attachments: [],
      });

      yield* Db.insertQuestionRevision(tx, {
        bookId: command.scope.bookId,
        questionId: anchor.id,
        revision: 1,
        state: "open",
        waitingOn: anchor.requestedFrom,
        body: yield* toJsonObject(event),
      });

      const result = yield* decode(Workspace.WorkQuestionResult, {
        scope: command.scope,
        question: {
          ...anchor,
          state: "open",
          revision: 1,
          waitingOn: anchor.requestedFrom,
          events: [event],
        },
      });

      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "workspace_ask_question",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const answerWorkQuestion = Effect.fn("workspace.questions.answer")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    questionId: string;
    input: typeof Workspace.AnswerWorkQuestion.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireQuestionAccess(tx, true);

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        "workspace_answer_question",
        principal.actorId,
        yield* toJsonObject({ questionId: command.questionId, input: command.input }),
        Workspace.WorkQuestionResult,
      );

      if (request.previous) return request.previous;

      const resolved = yield* checkedOwner(
        tx,
        command.scope,
        command.input.target,
        command.input.expectedTargetRevision,
      );

      const question = yield* readQuestion(tx, command.scope, command.questionId);
      yield* checkedQuestion(question, resolved.root, command.input.expectedRevision);

      if (resolved.owner.completed && resolved.root.kind !== "bank")
        return yield* failure("AlreadyPosted");

      if (principal.actorId !== question.requestedFrom && principal.actorId !== question.askedBy)
        return yield* failure("Forbidden");

      const attachments = yield* Effect.forEach(command.input.attachments, (reference) =>
        inspectAttachment(tx, command.scope, reference),
      );

      yield* requireAttachmentBudget(tx, command.scope, resolved.root, attachments);
      const current = attachments.length > 0 ? attachments : currentQuestionAttachments(question);

      const checked = yield* Effect.forEach(current, (reference) =>
        inspectAttachment(tx, command.scope, reference),
      );

      const answered =
        question.kind !== "missing_evidence" ||
        (checked.length > 0 && checked.every((item) => item.availability === "readable"));

      const event = yield* decode(Workspace.QuestionEvent, {
        revision: question.revision + 1,
        action: "answered",
        actorId: principal.actorId,
        createdAt: yield* isoNow(tx),
        text: yield* questionText(command.input.text),
        attachments,
      });

      const result = yield* appendEvent(
        tx,
        command.scope,
        question,
        event,
        answered ? "answered" : "open",
        question.askedBy,
      );

      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "workspace_answer_question",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const closeWorkQuestion = Effect.fn("workspace.questions.close")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    questionId: string;
    input: typeof Workspace.CloseWorkQuestion.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireQuestionAccess(tx, true);

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        "workspace_close_question",
        principal.actorId,
        yield* toJsonObject({ questionId: command.questionId, input: command.input }),
        Workspace.WorkQuestionResult,
      );

      if (request.previous) return request.previous;

      const resolved = yield* checkedOwner(
        tx,
        command.scope,
        command.input.target,
        command.input.expectedTargetRevision,
      );

      if (resolved.owner.completed && resolved.root.kind !== "bank")
        return yield* failure("AlreadyPosted");

      const question = yield* readQuestion(tx, command.scope, command.questionId);
      yield* checkedQuestion(question, resolved.root, command.input.expectedRevision);

      if (principal.actorId !== question.askedBy) return yield* failure("Forbidden");

      if (question.state !== "answered") return yield* failure("MissingEvidence");

      const attachments = yield* Effect.forEach(currentQuestionAttachments(question), (reference) =>
        inspectAttachment(tx, command.scope, reference),
      );

      if (
        attachments.some((item) => item.availability !== "readable") ||
        (question.kind === "missing_evidence" && attachments.length < 1)
      )
        return yield* failure("MissingEvidence");

      const event = yield* decode(Workspace.QuestionEvent, {
        revision: question.revision + 1,
        action: "closed",
        actorId: principal.actorId,
        createdAt: yield* isoNow(tx),
        text: yield* questionText(command.input.reason),
        attachments: [],
      });

      const result = yield* appendEvent(tx, command.scope, question, event, "closed", null);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "workspace_close_question",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});
