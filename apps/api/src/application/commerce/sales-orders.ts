import * as Sales from "@open-erp/contracts/sales-orders";
import * as Effect from "effect/Effect";
import * as SalesDb from "../../db/commerce/sales-orders";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { decode, requireTableAccess, unsupported, withBook, type Scope } from "./support";

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

export const createSalesDocument = Effect.fn("commerce.salesOrders.create")(function* (
  _token: string,
  _command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Sales.CreateSalesDocument.Type;
  },
) {
  return yield* unsupported();
});

export const reviseSalesDocument = Effect.fn("commerce.salesOrders.revise")(function* (
  _token: string,
  _command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Sales.ReviseSalesDocument.Type;
  },
) {
  return yield* unsupported();
});

export const transitionSalesDocument = Effect.fn("commerce.salesOrders.transition")(function* (
  _token: string,
  _command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Sales.TransitionSalesDocument.Type;
  },
) {
  return yield* unsupported();
});

export const convertSalesOrder = Effect.fn("commerce.salesOrders.convert")(function* (
  _token: string,
  _command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Sales.ConvertSalesOrder.Type;
  },
) {
  return yield* unsupported();
});
