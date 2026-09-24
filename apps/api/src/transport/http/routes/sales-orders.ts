import { Api } from "@open-erp/contracts/api";
import * as Sales from "@open-erp/contracts/sales-orders";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const SalesOrderHandlers = HttpApiBuilder.group(Api, "salesOrders", (handlers) => handlers
  .handle("createSalesDocument", ({ params, headers, payload }) => Effect.flatMap(authenticate, token =>
    query("salesDocumentCommand", [token, scopeParameter(params), headers["idempotency-key"],
      payload.kind === "quote" ? "create_quote" : "create_order", "", JSON.stringify({ content: payload.content })], Sales.SalesDocument)))
  .handle("listSalesDocuments", ({ params }) => Effect.flatMap(authenticate, token =>
    query("salesDocumentList", [token, scopeParameter(params)], Sales.SalesDocumentList)))
  .handle("getSalesDocument", ({ params }) => Effect.flatMap(authenticate, token =>
    query("salesDocumentView", [token, scopeParameter(params), params.id], Sales.SalesDocumentView)))
  .handle("reviseSalesDocument", ({ params, headers, payload }) => Effect.flatMap(authenticate, token =>
    query("salesDocumentCommand", [token, scopeParameter(params), headers["idempotency-key"], "revise", params.id,
      JSON.stringify(payload)], Sales.SalesDocument)))
  .handle("transitionSalesDocument", ({ params, headers, payload }) => Effect.flatMap(authenticate, token =>
    query("salesDocumentCommand", [token, scopeParameter(params), headers["idempotency-key"], payload.action, params.id,
      JSON.stringify({ expectedRevision: payload.expectedRevision, expectedDigest: payload.expectedDigest })], Sales.SalesDocument)))
  .handle("convertSalesOrder", ({ params, headers, payload }) => Effect.flatMap(authenticate, token =>
    query("convertSalesOrder", [token, scopeParameter(params), headers["idempotency-key"], params.id,
      JSON.stringify(payload)], Sales.OrderConversion))));
