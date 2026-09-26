import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  createSupplierInvoiceDraft,
  getSupplierInvoiceDraft,
  listSupplierInvoiceDrafts,
  reviseSupplierInvoiceDraft,
  supplierAccountSuggestions,
  supplierInvoiceDraftDuplicates,
  supplierInvoiceDraftHistory,
} from "../../../application/purchases/drafts";

export const SupplierInvoiceDraftHandlers = HttpApiBuilder.group(
  Api,
  "supplierInvoiceDrafts",
  (handlers) =>
    handlers
      .handle("supplierAccountSuggestions", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          supplierAccountSuggestions(token, {
            scope: scopeFromPath(params),
            counterpartyId: params.counterpartyId,
          }),
        ),
      )
      .handle("supplierInvoiceDraftDuplicates", ({ params, query: search }) =>
        Effect.flatMap(authenticate, (token) =>
          supplierInvoiceDraftDuplicates(token, {
            scope: scopeFromPath(params),
            draftId: params.id,
            after: search.after,
          }),
        ),
      )
      .handle("createSupplierInvoiceDraft", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          createSupplierInvoiceDraft(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("reviseSupplierInvoiceDraft", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          reviseSupplierInvoiceDraft(token, {
            scope: scopeFromPath(params),
            draftId: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getSupplierInvoiceDraft", ({ params, query: search }) =>
        Effect.flatMap(authenticate, (token) =>
          getSupplierInvoiceDraft(token, {
            scope: scopeFromPath(params),
            draftId: params.id,
            revision: search.revision,
          }),
        ),
      )
      .handle("listSupplierInvoiceDrafts", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          listSupplierInvoiceDrafts(token, { scope: scopeFromPath(params) }),
        ),
      )
      .handle("supplierInvoiceDraftHistory", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          supplierInvoiceDraftHistory(token, { scope: scopeFromPath(params), draftId: params.id }),
        ),
      ),
);
