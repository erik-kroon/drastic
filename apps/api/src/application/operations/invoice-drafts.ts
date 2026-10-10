import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { capabilities } from "../capabilities/index";
import * as Commerce from "../commerce/invoice-lifecycle";
import { bindHttpOperation, defineHttpOperation } from "../capabilities/http-operation";

export const InvoiceDraftOperations = {
  invoiceDraftHistory: bindHttpOperation(
    Api.groups.invoiceDrafts.endpoints.invoiceDraftHistory,
    capabilities.commerce_invoice_draft_history,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  listInvoiceDrafts: bindHttpOperation(
    Api.groups.invoiceDrafts.endpoints.listInvoiceDrafts,
    capabilities.commerce_list_invoice_drafts,
    ({ params, query }) => ({ scope: scopeFromPath(params), ...query }),
  ),
  getInvoiceDraft: bindHttpOperation(
    Api.groups.invoiceDrafts.endpoints.getInvoiceDraft,
    capabilities.commerce_get_invoice_draft,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      revision: query.revision,
    }),
  ),
  reviseInvoiceDraft: defineHttpOperation(
    Api.groups.invoiceDrafts.endpoints.reviseInvoiceDraft,
    (token, { params, headers, payload }) =>
      Commerce.reviseInvoiceDraft(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  createInvoiceDraft: defineHttpOperation(
    Api.groups.invoiceDrafts.endpoints.createInvoiceDraft,
    (token, { params, headers, payload }) =>
      Commerce.createInvoiceDraft(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  salesRegister: bindHttpOperation(
    Api.groups.invoiceDrafts.endpoints.salesRegister,
    capabilities.commerce_sales_register,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      ...query,
    }),
  ),
  calculateCommercialDraft: defineHttpOperation(
    Api.groups.invoiceDrafts.endpoints.calculateCommercialDraft,
    (token, { params, payload }) =>
      Commerce.calculateCommercialDraft(token, {
        scope: scopeFromPath(params),
        input: payload,
      }),
  ),
};
