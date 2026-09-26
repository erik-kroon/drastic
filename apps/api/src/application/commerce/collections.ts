import { digest as digestNative, canonicalText as canonicalNative } from "../json";
import * as Collections from "@open-erp/contracts/collections";
import * as Effect from "effect/Effect";
import { readInstant } from "../../db/commerce/access";
import * as CollectionDb from "../../db/commerce/collections";
import * as InvoiceDb from "../../db/commerce/invoices";
import type { Transaction } from "../../db/transaction";
import { newId, replay, saveCommand } from "../posting";
import { lockBookForUpdate } from "../../db/posting";
import { failure } from "../failures";
import {
  decode,
  requireInsertAccess,
  requireTableAccess,
  withBook,
  type JsonObject,
  type Scope,
} from "./support";

const DisputeSchema = Collections.CollectionDispute;

const ActionSchema = Collections.CollectionAction;

const DisputeInputSchema = Collections.OpenCollectionDispute;

const ActionInputSchema = Collections.RecordCollectionAction;

const StatementSchema = Collections.CollectionStatement;

const StatementInputSchema = Collections.CaptureCollectionStatement;

const WorklistSchema = Collections.CollectionWorklist;

const ExportSchema = Collections.CollectionStatementExport;

const HistorySchema = Collections.CollectionHistory;

const HistoryPageSchema = Collections.CollectionHistoryPage;

const historyPageSize = 50;

const worklistPageSize = 50;

const worklistPage = /^[1-9][0-9]{0,5}$/u;

const identifier = /^[a-z][a-z0-9_]{2,127}$/u;

const accountingDate = /^\d{4}-\d{2}-\d{2}$/u;

const cursorDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;

const cursorId = /^[a-z][a-z0-9_]{2,127}$/u;

function requireCustomer(transaction: Transaction, bookId: string, customerId: string) {
  return CollectionDb.readCustomer(transaction, bookId, customerId).pipe(
    Effect.flatMap((rows) => (rows.length > 0 ? Effect.void : failure("NotFound"))),
  );
}

function retainedNow(transaction: Transaction) {
  return readInstant(transaction).pipe(
    Effect.flatMap((rows) => {
      const instant = rows[0]?.instant;

      return instant === undefined ? failure("InternalError") : Effect.succeed(instant);
    }),
  );
}

function groupHistory(rows: ReadonlyArray<CollectionDb.HistoryRecordRow>) {
  return {
    statements: rows.filter((row) => row.recordKind === "statement").map((row) => row.body),
    disputes: rows.filter((row) => row.recordKind === "dispute").map((row) => row.body),
    events: rows.filter((row) => row.recordKind === "event").map((row) => row.body),
  };
}

export const openDispute = Effect.fn("commerce.collections.openDispute")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Collections.OpenCollectionDispute.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "open_collection_dispute",
        principal.actorId,
        command.input,
        DisputeSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, CollectionDb.collectionTables, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const input = yield* decode(DisputeInputSchema, command.input);

      if (
        input.reason.trim().length === 0 ||
        input.ownerId.length < 3 ||
        input.ownerId.length > 128
      ) {
        return yield* failure("InvalidJournal");
      }

      const evidence = yield* CollectionDb.readEvidenceExists(
        transaction,
        command.scope.bookId,
        input.evidenceId,
      );

      if (evidence[0]?.present !== true) return yield* failure("MissingEvidence");

      const members = yield* CollectionDb.readBookMembership(
        transaction,
        command.scope.bookId,
        input.ownerId,
      );

      if (members[0]?.present !== true) return yield* failure("InvalidJournal");

      const invoices = yield* CollectionDb.readCustomerInvoice(
        transaction,
        command.scope.bookId,
        input.invoiceId,
      );

      const invoice = invoices[0];

      if (!invoice) return yield* failure("NotFound");
      const id = newId("collection_dispute");

      const withoutDigest: JsonObject = {
        id,
        scope: command.scope,
        invoiceId: invoice.id,
        customerId: invoice.counterpartyId,
        reason: input.reason,
        evidenceId: input.evidenceId,
        ownerId: input.ownerId,
        holdReminders: input.holdReminders,
        createdBy: principal.actorId,
        createdAt: yield* retainedNow(transaction),
      };

      const digest = yield* digestNative(withoutDigest);
      const body: JsonObject = Object.assign({}, withoutDigest, { digest });
      const result = yield* decode(DisputeSchema, body);
      yield* CollectionDb.insertDispute(transaction, {
        bookId: command.scope.bookId,
        id,
        invoiceId: invoice.id,
        customerId: invoice.counterpartyId,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "open_collection_dispute",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const recordAction = Effect.fn("commerce.collections.recordAction")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Collections.RecordCollectionAction.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "record_collection_action",
        principal.actorId,
        command.input,
        ActionSchema,
      );

      if (request.previous) return request.previous;
      const input = yield* decode(ActionInputSchema, command.input);
      yield* requireTableAccess(transaction, CollectionDb.collectionTables, true);
      yield* lockBookForUpdate(transaction, command.scope);

      if (input.note.trim().length === 0) return yield* failure("InvalidJournal");

      const members = yield* CollectionDb.readBookMembership(
        transaction,
        command.scope.bookId,
        input.ownerId,
      );

      if (members[0]?.present !== true) return yield* failure("InvalidJournal");

      const invoices = yield* CollectionDb.readCustomerInvoice(
        transaction,
        command.scope.bookId,
        input.invoiceId,
      );

      const invoice = invoices[0];

      if (!invoice) return yield* failure("NotFound");
      let disputeId: string | null = null;

      if (input.kind === "dispute_resolved") {
        if (input.disputeId === null) return yield* failure("NotFound");

        const disputes = yield* CollectionDb.readInvoiceDispute(
          transaction,
          command.scope.bookId,
          invoice.id,
          input.disputeId,
        );

        const dispute = disputes[0];

        if (!dispute) return yield* failure("NotFound");

        const resolved = yield* CollectionDb.readDisputeResolutionExists(
          transaction,
          command.scope.bookId,
          dispute.id,
        );

        if (resolved[0]?.present === true) return yield* failure("AlreadyPosted");
        disputeId = dispute.id;
      } else if (input.disputeId !== null) {
        return yield* failure("InvalidJournal");
      }

      let outstandingMinor: string | null = null;

      if (input.kind === "reminder_prepared") {
        yield* requireTableAccess(transaction, InvoiceDb.commerceInvoiceTables, false);

        const outstanding = yield* InvoiceDb.readInvoiceOutstanding(
          transaction,
          command.scope.bookId,
          invoice.id,
        );

        const live = outstanding[0];

        const holds = yield* CollectionDb.readOpenReminderHold(
          transaction,
          command.scope.bookId,
          invoice.id,
        );

        if (
          !live ||
          (live.status !== "open" && live.status !== "partially_allocated") ||
          live.outstandingMinor === null ||
          BigInt(live.outstandingMinor) <= 0n ||
          holds[0]?.present === true
        ) {
          return yield* failure("StaleDependency");
        }

        outstandingMinor = live.outstandingMinor;
      }

      const id = newId("collection_action");

      const withoutDigest: JsonObject = {
        id,
        scope: command.scope,
        customerId: invoice.counterpartyId,
        invoiceId: invoice.id,
        disputeId,
        kind: input.kind,
        note: input.note,
        ownerId: input.ownerId,
        createdBy: principal.actorId,
        createdAt: yield* retainedNow(transaction),
        outstandingMinor,
        sendAuthorized: false,
      };

      const digest = yield* digestNative(withoutDigest);
      const body: JsonObject = Object.assign({}, withoutDigest, { digest });
      const result = yield* decode(ActionSchema, body);
      yield* CollectionDb.insertEvent(transaction, {
        bookId: command.scope.bookId,
        id,
        customerId: invoice.counterpartyId,
        invoiceId: invoice.id,
        disputeId,
        kind: input.kind,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "record_collection_action",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const readHistory = Effect.fn("commerce.collections.readHistory")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, CollectionDb.collectionTables, false);
    yield* requireCustomer(transaction, input.scope.bookId, input.id);
    const rows = yield* CollectionDb.readFullHistory(transaction, input.scope.bookId, input.id);

    return yield* decode(HistorySchema, {
      scope: input.scope,
      customerId: input.id,
      complete: true,
      ...groupHistory(rows),
    });
  });
});

export const readHistoryPage = Effect.fn("commerce.collections.readHistoryPage")(function* (
  token: string,
  input: { scope: Scope; id: string; after: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, CollectionDb.collectionTables, false);
    yield* requireCustomer(transaction, input.scope.bookId, input.id);
    const separator = input.after.indexOf("|");
    const afterAt = separator === -1 ? input.after : input.after.slice(0, separator);
    const afterId = separator === -1 ? "" : input.after.slice(separator + 1);

    if (
      input.after.length > 256 ||
      (input.after !== "" && (!cursorDate.test(afterAt) || !cursorId.test(afterId)))
    ) {
      return yield* failure("InvalidJournal");
    }

    const rows = yield* CollectionDb.readHistoryPage(
      transaction,
      input.scope.bookId,
      input.id,
      afterAt,
      afterId,
      historyPageSize,
    );

    const last = rows[rows.length - 1];

    return yield* decode(HistoryPageSchema, {
      scope: input.scope,
      customerId: input.id,
      ...groupHistory(rows),
      nextCursor: last?.hasMore === true ? `${last.recordAt}|${last.recordId}` : null,
    });
  });
});

export const readWorklist = Effect.fn("commerce.collections.readWorklist")(function* (
  token: string,
  input: { scope: Scope; page: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, CollectionDb.collectionWorklistTables, false);

    if (!worklistPage.test(input.page)) return yield* failure("InvalidJournal");
    const page = Number.parseInt(input.page, 10);
    const checkedAt = yield* retainedNow(transaction);
    const asOf = checkedAt.slice(0, 10);

    const rows = yield* InvoiceDb.readCustomerWorklistPage(
      transaction,
      input.scope.bookId,
      asOf,
      page,
      worklistPageSize,
    );

    return yield* decode(WorklistSchema, {
      scope: input.scope,
      checkedAt,
      asOf,
      page,
      pageSize: worklistPageSize,
      total: rows[0]?.total ?? 0,
      items: [...rows].sort((left, right) => left.ordinal - right.ordinal).map((row) => row.body),
    });
  });
});

export const readStatementExport = Effect.fn("commerce.collections.readStatementExport")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, CollectionDb.collectionWorklistTables, false);

    if (!identifier.test(input.id)) return yield* failure("InvalidJournal");
    const rows = yield* CollectionDb.readStatementExport(transaction, input.scope.bookId, input.id);
    const statement = rows[0];

    if (!statement) return yield* failure("NotFound");
    const canonical = yield* canonicalNative(statement.body);

    if (canonical !== statement.content) return yield* failure("StaleDependency");

    return yield* decode(ExportSchema, {
      scope: input.scope,
      statementId: input.id,
      customerId: statement.customerId,
      mediaType: "application/json",
      encoding: "UTF-8",
      filename: `${input.id}.json`,
      byteLength: statement.byteLength,
      sha256: statement.sha256,
      body: statement.content,
    });
  });
});

export const captureStatement = Effect.fn("commerce.collections.captureStatement")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Collections.CaptureCollectionStatement.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "capture_collection_statement",
        principal.actorId,
        command.input,
        StatementSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, CollectionDb.collectionWorklistTables, false);
      yield* requireInsertAccess(transaction, ["collection_statements"]);
      yield* lockBookForUpdate(transaction, command.scope);
      const input = yield* decode(StatementInputSchema, command.input);

      if (!accountingDate.test(input.asOf)) return yield* failure("InvalidJournal");
      const cutoffAt = yield* retainedNow(transaction);

      if (input.asOf > cutoffAt.slice(0, 10)) return yield* failure("InvalidJournal");
      yield* requireCustomer(transaction, command.scope.bookId, input.customerId);

      const blocked = yield* InvoiceDb.readBlockedCustomerInvoices(
        transaction,
        command.scope.bookId,
        input.customerId,
        input.asOf,
      );

      if (blocked[0]?.present === true) return yield* failure("StaleDependency");

      const items = yield* InvoiceDb.readCustomerStatementItems(
        transaction,
        command.scope.bookId,
        input.customerId,
        input.asOf,
        cutoffAt,
      );

      const withoutDigest: JsonObject = {
        id: newId("collection_statement"),
        scope: command.scope,
        customerId: input.customerId,
        asOf: input.asOf,
        cutoffAt,
        items: items[0]?.body ?? [],
        createdBy: principal.actorId,
        createdAt: cutoffAt,
      };

      const digest = yield* digestNative(withoutDigest);
      const body: JsonObject = Object.assign({}, withoutDigest, { digest });
      const result = yield* decode(StatementSchema, body);
      yield* CollectionDb.insertStatement(transaction, {
        bookId: command.scope.bookId,
        id: result.id,
        customerId: input.customerId,
        body,
      });
      yield* CollectionDb.insertStatementArtifact(
        transaction,
        command.scope.bookId,
        result.id,
        yield* canonicalNative(body),
      );
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "capture_collection_statement",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});
