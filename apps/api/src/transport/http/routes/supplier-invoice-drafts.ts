import { Api } from "@open-erp/contracts/api";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const SupplierInvoiceDraftHandlers = HttpApiBuilder.group(
  Api,
  "supplierInvoiceDrafts",
  (handlers) =>
    handlers
      .handle("supplierInvoiceDraftDuplicates", ({ params, query: search }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "supplierInvoiceDraftDuplicates",
            [token, scopeParameter(params), params.id, search.after ?? ""],
            Drafts.SupplierInvoiceDraftDuplicates,
          ),
        ),
      )
      .handle("createSupplierInvoiceDraft", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "createSupplierInvoiceDraft",
            [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
            Drafts.SupplierInvoiceDraftRevision,
          ),
        ),
      )
      .handle("reviseSupplierInvoiceDraft", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "reviseSupplierInvoiceDraft",
            [
              token,
              scopeParameter(params),
              params.id,
              headers["idempotency-key"],
              JSON.stringify(payload),
            ],
            Drafts.SupplierInvoiceDraftRevision,
          ),
        ),
      )
      .handle("getSupplierInvoiceDraft", ({ params, query: search }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "getSupplierInvoiceDraft",
            [token, scopeParameter(params), params.id, search.revision ?? ""],
            Drafts.SupplierInvoiceDraftView,
          ),
        ),
      )
      .handle("listSupplierInvoiceDrafts", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "listSupplierInvoiceDrafts",
            [token, scopeParameter(params)],
            Drafts.SupplierInvoiceDraftList,
          ),
        ),
      )
      .handle("supplierInvoiceDraftHistory", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "supplierInvoiceDraftHistory",
            [token, scopeParameter(params), params.id],
            Drafts.SupplierInvoiceDraftHistory,
          ),
        ),
      ),
);
