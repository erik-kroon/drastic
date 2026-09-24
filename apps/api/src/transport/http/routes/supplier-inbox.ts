import { Api } from "@open-erp/contracts/api";
import * as Inbox from "@open-erp/contracts/supplier-inbox";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const SupplierInboxHandlers = HttpApiBuilder.group(Api, "supplierInbox", (handlers) =>
  handlers
    .handle("listSupplierInboxes", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) => query("listSupplierInboxes",
        [token, scopeParameter(params), search.cursor ?? ""], Inbox.SupplierInboxPage)))
    .handle("registerSupplierInbox", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) => query("registerSupplierInbox",
        [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)], Inbox.SupplierInboxView)))
    .handle("getSupplierInbox", ({ params }) =>
      Effect.flatMap(authenticate, (token) => query("getSupplierInbox",
        [token, scopeParameter(params), params.id], Inbox.SupplierInboxView)))
    .handle("recordSupplierExtraction", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) => query("recordSupplierExtraction",
        [token, scopeParameter(params), headers["idempotency-key"], params.id, JSON.stringify(payload)], Inbox.SupplierInboxView)))
    .handle("reviewSupplierInbox", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) => query("reviewSupplierInbox",
        [token, scopeParameter(params), headers["idempotency-key"], params.id, JSON.stringify(payload)], Inbox.SupplierInboxReview))),
);
