import * as Sales from "@open-erp/contracts/sales-orders";
import * as Effect from "effect/Effect";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";
import * as DraftDb from "../../db/commerce/invoice-lifecycle";
import { calculateDraft } from "./draft-calculation";
import { createInvoiceDraftInTransaction } from "./invoice-lifecycle";
import * as SalesDb from "../../db/commerce/sales-orders";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { decode, requireTableAccess, withBook, toJsonObject, type Scope } from "./support";

const ListSchema = Sales.SalesDocumentList;

const ViewSchema = Sales.SalesDocumentView;

function readDocumentView(transaction: Transaction, bookId: string, id: string) {
  return Effect.gen(function* () {
    const rows = yield* SalesDb.readSalesDocument(transaction, bookId, id, "share");
    const row = rows[0];

    if (!row) return yield* failure("NotFound");
    const conversions = yield* SalesDb.readSalesConversions(transaction, bookId, row.id);

    return yield* decode(ViewSchema, {
      record: row.body,
      conversions: conversions.map((conversion) => ({
        draftId: conversion.draftId,
        orderRevision: conversion.orderRevision,
        portions: conversion.portions,
      })),
    });
  });
}

export const listSalesDocuments = Effect.fn("commerce.salesOrders.list")(function* (
  token: string,
  input: { scope: Scope },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, SalesDb.salesOrderTables, false);
    const rows = yield* SalesDb.readSalesDocumentList(transaction, input.scope.bookId);

    return yield* decode(ListSchema, { scope: input.scope, items: rows.map((row) => row.body) });
  });
});

export const getSalesDocument = Effect.fn("commerce.salesOrders.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, SalesDb.salesOrderTables, false);

    return yield* readDocumentView(transaction, input.scope.bookId, input.id);
  });
});

type CreateCommand = {
  scope: Scope;
  idempotencyKey: string;
  input: typeof Sales.CreateSalesDocument.Type;
};

type ReviseCommand = {
  scope: Scope;
  id: string;
  idempotencyKey: string;
  input: typeof Sales.ReviseSalesDocument.Type;
};

type TransitionCommand = {
  scope: Scope;
  id: string;
  idempotencyKey: string;
  input: typeof Sales.TransitionSalesDocument.Type;
};

type DocumentCommand = CreateCommand | ReviseCommand | TransitionCommand;

type Document = typeof Sales.SalesDocument.Type;

const readWriteContext = Effect.fn("commerce.salesOrders.context")(function* (
  tx: Transaction,
  scope: Scope,
  input: DocumentCommand["input"],
  id: string | null,
  action: string,
) {
  const book = (yield* DraftDb.readBookCurrency(tx, scope.bookId))[0];

  if (!book || book.authority !== "native") return yield* failure("Forbidden");

  if (new TextEncoder().encode(JSON.stringify(input)).length > 65536)
    return yield* failure("InvalidJournal");

  const previous =
    id === null ? undefined : (yield* SalesDb.readSalesDocument(tx, scope.bookId, id, "update"))[0];

  if (id !== null && !previous) return yield* failure("NotFound");

  const head = previous ? yield* decode(Sales.SalesDocument, previous.body) : null;

  if (
    "expectedDigest" in input &&
    (!head || head.digest !== input.expectedDigest || head.revision !== input.expectedRevision)
  )
    return yield* failure("StaleDependency");

  return { book, head, create: !head || action === "order_from_quote" };
});

const requireAllowedTransition = Effect.fn("commerce.salesOrders.transition")(function* (
  tx: Transaction,
  scope: Scope,
  action: string,
  head: Document | null,
  create: boolean,
) {
  if (create && (yield* SalesDb.readSalesDocumentList(tx, scope.bookId)).length >= 200)
    return yield* failure("InvalidJournal");

  if (!create && head && BigInt(head.revision) >= 50n) return yield* failure("InvalidJournal");

  if (head && (action === "revise" || action === "accept") && head.state !== "draft")
    return yield* failure("InvalidJournal");

  if (action === "cancel" && head) {
    if (
      head.state === "cancelled" ||
      (head.kind === "order" &&
        (yield* SalesDb.readSalesConversions(tx, scope.bookId, head.id)).length)
    )
      return yield* failure("InvalidJournal");
  }

  if (action === "order_from_quote" && (head?.kind !== "quote" || head.state !== "accepted"))
    return yield* failure("InvalidJournal");
});

const writeDocument = Effect.fn("commerce.salesOrders.write")(function* (
  token: string,
  command: DocumentCommand,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const input = command.input;

      const action =
        "kind" in input ? `create_${input.kind}` : "action" in input ? input.action : "revise";

      const id = "id" in command ? command.id : null;
      const operation = "sales_document_command";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { action, id, input },
        Sales.SalesDocument,
      );

      if (request.previous) return request.previous;

      const context = yield* readWriteContext(tx, command.scope, input, id, action);

      yield* requireAllowedTransition(tx, command.scope, action, context.head, context.create);

      const head = context.head;
      const create = context.create;
      const content = "content" in input ? input.content : head?.content;

      if (!content) return yield* failure("InvalidJournal");

      const calculation =
        "content" in input
          ? yield* calculateDraft(tx, command.scope, context.book, content)
          : head?.calculation;

      const body = {
        id: create ? newId("sales_document") : id,
        scope: command.scope,
        kind: "kind" in input ? input.kind : action === "order_from_quote" ? "order" : head?.kind,
        state:
          action === "accept" || action === "order_from_quote"
            ? "accepted"
            : action === "cancel"
              ? "cancelled"
              : "draft",
        revision: create ? "1" : (BigInt(head?.revision ?? "0") + 1n).toString(),
        content,
        calculation,
        sourceQuoteId: action === "order_from_quote" ? id : (head?.sourceQuoteId ?? null),
        sourceQuoteRevision:
          action === "order_from_quote" ? head?.revision : (head?.sourceQuoteRevision ?? null),
        createdAt: yield* isoNow(tx),
        receipt: { key: command.idempotencyKey, operation, actorId: principal.actorId },
      };

      const json = yield* toJsonObject(body);
      const result = yield* decode(Sales.SalesDocument, { ...json, digest: yield* digest(json) });

      if (create) yield* SalesDb.insertDocument(tx, command.scope.bookId, result);
      else yield* SalesDb.updateRevision(tx, command.scope.bookId, result.id, result.revision);
      yield* SalesDb.insertRevision(tx, command.scope.bookId, result);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    },
    "update",
  );
});

export const createSalesDocument = (token: string, command: CreateCommand) =>
  writeDocument(token, command);

export const reviseSalesDocument = (token: string, command: ReviseCommand) =>
  writeDocument(token, command);

export const transitionSalesDocument = (token: string, command: TransitionCommand) =>
  writeDocument(token, command);

function quantity(value: string) {
  const [whole, fraction = ""] = value.split(".");

  return BigInt(whole ?? "0") * 1000000n + BigInt(fraction.padEnd(6, "0"));
}

export const convertSalesOrder = Effect.fn("commerce.salesOrders.convert")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Sales.ConvertSalesOrder.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, id, input, idempotencyKey } = command,
        operation = "convert_sales_order";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Sales.OrderConversion,
      );

      if (request.previous) return request.previous;
      const row = (yield* SalesDb.readSalesDocument(tx, scope.bookId, id, "update"))[0];

      if (!row || row.kind !== "order") return yield* failure("NotFound");
      const head = yield* decode(Sales.SalesDocument, row.body);

      if (
        head.state !== "accepted" ||
        head.revision !== input.expectedRevision ||
        head.digest !== input.expectedDigest
      )
        return yield* failure("StaleDependency");

      if (new Set(input.lines.map((line) => line.id)).size !== input.lines.length)
        return yield* failure("InvalidJournal");
      const conversions = yield* SalesDb.readSalesConversions(tx, scope.bookId, id);
      const lines: Array<typeof Drafts.DraftLine.Type> = [];
      const portions: Array<typeof Sales.ConvertedPortion.Type> = [];

      for (const selected of input.lines) {
        const original = head.content.lines.find((line) => line.id === selected.id);

        if (!original) return yield* failure("InvalidJournal");

        const prior = conversions.flatMap((entry) =>
          entry.portions.filter((portion) => portion.id === selected.id),
        );

        const consumed = prior.reduce((sum, portion) => sum + quantity(portion.quantity), 0n);

        const requested = quantity(selected.quantity),
          available = quantity(original.quantity);

        if (requested + consumed > available) return yield* failure("StaleDependency");
        const amounts: Record<string, string | null> = {};

        for (const field of [
          "baseMinor",
          "discountMinor",
          "chargeMinor",
          "taxMinor",
          "sourceGrossMinor",
        ] as const) {
          if (original[field] === null) {
            amounts[field] = null;
            continue;
          }

          const total = BigInt(original[field]);
          const used = prior.reduce((sum, portion) => sum + BigInt(portion[field] ?? "0"), 0n);

          if (requested + consumed !== available && (total * requested) % available !== 0n)
            return yield* failure("InvalidJournal");
          amounts[field] = (
            requested + consumed === available ? total - used : (total * requested) / available
          ).toString();
        }

        lines.push(
          yield* decode(Drafts.DraftLine, { ...original, quantity: selected.quantity, ...amounts }),
        );
        portions.push(yield* decode(Sales.ConvertedPortion, { ...selected, ...amounts }));
      }

      const content = {
        ...head.content,
        lines,
        sourceTotalMinor: lines.some((line) => line.sourceGrossMinor === null)
          ? null
          : lines.reduce((sum, line) => sum + BigInt(line.sourceGrossMinor ?? "0"), 0n).toString(),
      };

      const draft = yield* createInvoiceDraftInTransaction(tx, principal, {
        scope,
        idempotencyKey: newId("sales_conversion"),
        input: { draftKey: input.draftKey, content },
      });

      const result = yield* decode(Sales.OrderConversion, {
        orderId: id,
        orderRevision: head.revision,
        portions,
        draft,
      });

      yield* SalesDb.insertConversion(tx, scope.bookId, result);
      yield* saveCommand(
        tx,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    },
    "update",
  );
});
