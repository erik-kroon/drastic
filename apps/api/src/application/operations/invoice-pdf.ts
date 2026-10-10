import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Commerce from "../commerce/documents";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const InvoicePdfOperations = {
  invoicePdfHistory: bindHttpOperation(
    Api.groups.invoicePdfs.endpoints.invoicePdfHistory,
    capabilities.commerce_invoice_pdf_history,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  resumeInvoicePdf: defineHttpOperation(
    Api.groups.invoicePdfs.endpoints.resumeInvoicePdf,
    (token, { params }) =>
      Commerce.resumeInvoicePdf(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  getInvoicePdf: bindHttpOperation(
    Api.groups.invoicePdfs.endpoints.getInvoicePdf,
    capabilities.commerce_get_invoice_pdf,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  prepareInvoicePdf: defineHttpOperation(
    Api.groups.invoicePdfs.endpoints.prepareInvoicePdf,
    (token, { params, headers, payload }) =>
      Commerce.prepareInvoicePdf(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
