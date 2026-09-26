import * as Accounting from "@open-erp/contracts/accounting";
import * as SupplierInbox from "@open-erp/contracts/supplier-inbox";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import { isoNow, newId, replay, saveCommand, sha256Hex } from "../posting";
import * as InboxDb from "../../db/purchases/inbox";
import * as Shared from "./shared";
import { createSupplierInvoiceDraftInTransaction } from "./drafts";

type Scope = typeof Accounting.Scope.Type;

type JsonObject = Schema.JsonObject;

const ViewSchema = SupplierInbox.SupplierInboxView;

const PageSchema = SupplierInbox.SupplierInboxPage;

const ReviewSchema = SupplierInbox.SupplierInboxReview;

const inboxTables = [
  "books",
  "evidence",
  "command_receipts",
  "intake_occurrences",
  "intake_previews",
  "intake_admissions",
  "supplier_inbox",
  "supplier_extraction_attempts",
  "supplier_invoice_drafts",
  "supplier_invoice_draft_revisions",
  "commerce_counterparties",
  "commerce_counterparty_revisions",
  "commerce_invoices",
  "supplier_acceptance_reviews",
  "supplier_acceptances",
];

const inboxInserts = ["supplier_inbox", "supplier_extraction_attempts", "command_receipts"];

const inboxUpdates = ["supplier_inbox"];

const maximumAttempts = 50;

const maximumExtractionBytes = 32768;

function occurrenceSummary(row: InboxDb.OccurrenceRow) {
  return Object.assign(
    {},
    {
      occurrence: row.body,
      latestPreviewId: row.latestPreviewId,
      admission: row.admission,
    },
  ) satisfies JsonObject;
}

function purchaseSourceReference(content: string) {
  try {
    const parsed: unknown = JSON.parse(content);

    return Shared.isJsonObject(parsed) ? parsed : {};
  } catch {
    return null;
  }
}

function inboxView(
  transaction: import("../../db/transaction").Transaction,
  bookId: string,
  occurrenceId: string,
) {
  return Effect.gen(function* () {
    const entry = (yield* InboxDb.readInbox(transaction, bookId, occurrenceId))[0];

    if (!entry) return yield* failure("NotFound");
    const occurrence = (yield* InboxDb.readOccurrence(transaction, bookId, occurrenceId))[0];

    if (!occurrence) return yield* failure("NotFound");
    const attempts = yield* InboxDb.readAttempts(transaction, bookId, occurrenceId);

    return yield* Shared.decode(ViewSchema, {
      occurrence: occurrenceSummary(occurrence),
      channel: entry.channel,
      messageIdentity: entry.messageIdentity,
      draftId: entry.draftId,
      reviewReason: entry.reviewReason,
      reviewAttemptId: entry.reviewAttemptId,
      attempts: attempts.map((attempt) => attempt.body),
    });
  });
}

export const getSupplierInbox = Effect.fn("purchases.inbox.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly occurrenceId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, inboxTables);

      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];

      if (!book) return yield* failure("Forbidden");

      return yield* inboxView(transaction, command.scope.bookId, command.occurrenceId);
    }),
  );
});

export const listSupplierInboxes = Effect.fn("purchases.inbox.list")(function* (
  token: string,
  command: { readonly scope: Scope; readonly cursor?: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, inboxTables);

      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];

      if (!book) return yield* failure("Forbidden");

      const page = yield* InboxDb.readOccurrencePage(
        transaction,
        command.scope.bookId,
        command.cursor ?? null,
      );

      const visible = page.slice(0, 20);
      const items: JsonObject[] = [];

      for (const entry of visible) {
        const occurrenceId = entry.occurrenceId;

        const occurrence = (yield* InboxDb.readOccurrence(
          transaction,
          command.scope.bookId,
          occurrenceId,
        ))[0];

        if (!occurrence) return yield* failure("InternalError");

        const stored = (yield* InboxDb.readInbox(
          transaction,
          command.scope.bookId,
          occurrenceId,
        ))[0];

        if (!stored) return yield* failure("InternalError");

        const attempts = yield* InboxDb.readAttempts(
          transaction,
          command.scope.bookId,
          occurrenceId,
        );

        items.push(
          yield* Shared.toJsonObject(
            Object.assign(
              {},
              {
                occurrence: occurrenceSummary(occurrence),
                channel: stored.channel,
                messageIdentity: stored.messageIdentity,
                draftId: stored.draftId,
                reviewReason: stored.reviewReason,
                reviewAttemptId: stored.reviewAttemptId,
                attempts: attempts.map((attempt) => attempt.body),
              },
            ),
          ),
        );
      }

      const anchor = visible[visible.length - 1];

      return yield* Shared.decode(PageSchema, {
        items,
        nextCursor:
          page.length > 20 && anchor
            ? (Shared.objectField(anchor.body, "occurrence").id ?? null)
            : null,
      });
    }),
  );
});

export const registerSupplierInbox = Effect.fn("purchases.inbox.register")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof SupplierInbox.RegisterSupplierInbox.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, inboxTables, inboxInserts, inboxUpdates);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = yield* Shared.readBook(transaction, command.scope.bookId);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "register_supplier_inbox",
        principal.actorId,
        yield* Shared.toJsonObject(command.input),
        ViewSchema,
      );

      if (request.previous) return request.previous;
      yield* Shared.requireNativeCommerceProfile(book.profile, book.authority);

      const { occurrenceId, channel, messageIdentity } = command.input;

      if (
        (channel === "email" &&
          (messageIdentity === null ||
            messageIdentity.length < 1 ||
            messageIdentity.length > 200)) ||
        (channel === "upload" && messageIdentity !== null)
      ) {
        return yield* failure("InvalidJournal");
      }

      const occurrence = (yield* InboxDb.readOccurrence(
        transaction,
        command.scope.bookId,
        occurrenceId,
      ))[0];

      if (!occurrence) return yield* failure("NotFound");

      if (
        messageIdentity !== null &&
        (yield* InboxDb.readMessageIdentityConflict(
          transaction,
          command.scope.bookId,
          channel,
          messageIdentity,
          occurrenceId,
        ))[0]?.present === true
      ) {
        return yield* failure("IdempotencyConflict");
      }

      yield* InboxDb.insertInbox(transaction, {
        bookId: command.scope.bookId,
        occurrenceId,
        channel,
        messageIdentity,
      });

      if (
        (yield* InboxDb.readRegistration(
          transaction,
          command.scope.bookId,
          occurrenceId,
          channel,
          messageIdentity,
        ))[0]?.registered !== true
      ) {
        return yield* failure("IdempotencyConflict");
      }

      const view = yield* inboxView(transaction, command.scope.bookId, occurrenceId);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "register_supplier_inbox",
        principal.actorId,
        yield* Shared.toJsonObject(view),
      );

      return view;
    }),
  );
});

export const recordSupplierExtraction = Effect.fn("purchases.inbox.recordExtraction")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly occurrenceId: string;
    readonly idempotencyKey: string;
    readonly input: typeof SupplierInbox.RecordSupplierExtraction.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, inboxTables, inboxInserts, inboxUpdates);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = yield* Shared.readBook(transaction, command.scope.bookId);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "record_supplier_extraction",
        principal.actorId,
        {
          occurrenceId: command.occurrenceId,
          input: yield* Shared.toJsonObject(command.input),
        } satisfies JsonObject,
        ViewSchema,
      );

      if (request.previous) return request.previous;
      yield* Shared.requireNativeCommerceProfile(book.profile, book.authority);

      if (Shared.byteLength(JSON.stringify(command.input)) > maximumExtractionBytes) {
        return yield* failure("InvalidJournal");
      }

      if (
        (yield* InboxDb.readInboxForUpdate(transaction, command.scope.bookId, command.occurrenceId))
          .length === 0
      ) {
        return yield* failure("NotFound");
      }

      const attemptCount = (yield* InboxDb.readAttemptCount(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
      ))[0]!.total;

      if (attemptCount >= maximumAttempts) return yield* failure("InvalidJournal");

      const ordinal = attemptCount + 1;

      const body = Object.assign({}, command.input, {
        id: newId("supplier_extraction"),
        occurrenceId: command.occurrenceId,
        ordinal,
        createdBy: principal.actorId,
        createdAt: yield* isoNow(transaction),
      }) satisfies JsonObject;

      if (Shared.byteLength(JSON.stringify(body)) > 65536) {
        return yield* failure("InvalidJournal");
      }

      const attemptId = newId("supplier_extraction");
      yield* InboxDb.insertAttempt(transaction, {
        bookId: command.scope.bookId,
        id: attemptId,
        occurrenceId: command.occurrenceId,
        ordinal,
        body: Object.assign({}, body, { id: attemptId }),
      });
      const view = yield* inboxView(transaction, command.scope.bookId, command.occurrenceId);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "record_supplier_extraction",
        principal.actorId,
        yield* Shared.toJsonObject(view),
      );

      return view;
    }),
  );
});

export const reviewSupplierInbox = Effect.fn("purchases.inbox.review")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly occurrenceId: string;
    readonly idempotencyKey: string;
    readonly input: typeof SupplierInbox.ReviewSupplierInbox.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(
        transaction,
        inboxTables,
        [...inboxInserts, "supplier_invoice_drafts", "supplier_invoice_draft_revisions"],
        inboxUpdates,
      );
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      yield* Shared.readBook(transaction, command.scope.bookId);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "review_supplier_inbox",
        principal.actorId,
        {
          occurrenceId: command.occurrenceId,
          input: yield* Shared.toJsonObject(command.input),
        } satisfies JsonObject,
        ReviewSchema,
      );

      if (request.previous) return request.previous;

      const entry = (yield* InboxDb.readInboxForUpdate(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
      ))[0];

      if (!entry) return yield* failure("NotFound");

      if (entry.draftId !== null) return yield* failure("IdempotencyConflict");
      const attemptId = command.input.reviewAttemptId;

      if (
        attemptId !== null &&
        (yield* InboxDb.readAttemptPresence(
          transaction,
          command.scope.bookId,
          command.occurrenceId,
          attemptId,
        ))[0]?.present !== true
      ) {
        return yield* failure("NotFound");
      }

      const draftContent = yield* Shared.toJsonObject(command.input.draft);

      const sourceEvidenceId = Shared.textField(
        Shared.objectField(draftContent, "content"),
        "sourceEvidenceId",
      );

      if (sourceEvidenceId === undefined) return yield* failure("InvalidJournal");

      const evidence = (yield* InboxDb.readReviewedEvidence(
        transaction,
        command.scope.bookId,
        sourceEvidenceId,
      ))[0];

      if (!evidence) return yield* failure("InvalidJournal");
      const parsed = purchaseSourceReference(evidence.content);
      const reference = Shared.objectField(parsed, "source");

      const occurrence = (yield* InboxDb.readOccurrence(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
      ))[0];

      if (!occurrence) return yield* failure("NotFound");

      if (
        Shared.textField(reference, "occurrenceId") !== command.occurrenceId ||
        Shared.textField(reference, "sha256") !== occurrence.sha256
      ) {
        return yield* failure("InvalidJournal");
      }

      const draftKey = `ap_${(yield* sha256Hex(
        `${command.scope.bookId}:${command.occurrenceId}`,
      )).slice(0, 60)}`;

      const draft = yield* createSupplierInvoiceDraftInTransaction(transaction, principal, {
        scope: command.scope,
        idempotencyKey: command.idempotencyKey,
        input: { draftKey, content: command.input.draft.content },
      });

      yield* InboxDb.bindDraft(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
        Shared.textField(yield* Shared.toJsonObject(draft), "id") ?? "",
        command.input.reviewReason,
        attemptId,
      );
      const view = yield* inboxView(transaction, command.scope.bookId, command.occurrenceId);

      const result = yield* Shared.decode(
        ReviewSchema,
        Object.assign(
          {},
          {
            inbox: yield* Shared.toJsonObject(view),
            draft,
          },
        ),
      );

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "review_supplier_inbox",
        principal.actorId,
        yield* Shared.toJsonObject(result),
      );

      return result;
    }),
  );
});
