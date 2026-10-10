import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import {
  createSupplierInvoiceDraft,
  reviseSupplierInvoiceDraft,
  supplierAccountSuggestions,
} from "../purchases/drafts";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const SupplierInvoiceDraftOperations = {
  supplierInvoiceDraftHistory: bindHttpOperation(
    Api.groups.supplierInvoiceDrafts.endpoints.supplierInvoiceDraftHistory,
    capabilities.commerce_supplier_invoice_draft_history,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  listSupplierInvoiceDrafts: bindHttpOperation(
    Api.groups.supplierInvoiceDrafts.endpoints.listSupplierInvoiceDrafts,
    capabilities.commerce_list_supplier_invoice_drafts,
    ({ params, query }) => ({ scope: scopeFromPath(params), ...query }),
  ),
  getSupplierInvoiceDraft: bindHttpOperation(
    Api.groups.supplierInvoiceDrafts.endpoints.getSupplierInvoiceDraft,
    capabilities.commerce_get_supplier_invoice_draft,
    ({ params, query: search }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      revision: search.revision,
    }),
  ),
  reviseSupplierInvoiceDraft: defineHttpOperation(
    Api.groups.supplierInvoiceDrafts.endpoints.reviseSupplierInvoiceDraft,
    (token, { params, headers, payload }) =>
      reviseSupplierInvoiceDraft(token, {
        scope: scopeFromPath(params),
        draftId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  createSupplierInvoiceDraft: defineHttpOperation(
    Api.groups.supplierInvoiceDrafts.endpoints.createSupplierInvoiceDraft,
    (token, { params, headers, payload }) =>
      createSupplierInvoiceDraft(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  supplierInvoiceDraftDuplicates: bindHttpOperation(
    Api.groups.supplierInvoiceDrafts.endpoints.supplierInvoiceDraftDuplicates,
    capabilities.commerce_supplier_invoice_draft_duplicates,
    ({ params, query: search }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      after: search.after,
    }),
  ),
  supplierAccountSuggestions: defineHttpOperation(
    Api.groups.supplierInvoiceDrafts.endpoints.supplierAccountSuggestions,
    (token, { params, query: search }) =>
      supplierAccountSuggestions(token, {
        scope: scopeFromPath(params),
        counterpartyId: params.counterpartyId,
        draftId: search.draftId,
        draftRevision: search.draftRevision,
      }),
  ),
};
