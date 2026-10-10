import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Commerce from "../commerce/documents";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const LegalInvoicePdfOperations = {
  legalInvoicePdfHistory: bindHttpOperation(
    Api.groups.legalInvoicePdfs.endpoints.legalInvoicePdfHistory,
    capabilities.commerce_legal_invoice_pdf_history,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  resumeLegalInvoicePdf: defineHttpOperation(
    Api.groups.legalInvoicePdfs.endpoints.resumeLegalInvoicePdf,
    (token, { params }) =>
      Commerce.resumeLegalInvoicePdf(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  getLegalInvoicePdf: bindHttpOperation(
    Api.groups.legalInvoicePdfs.endpoints.getLegalInvoicePdf,
    capabilities.commerce_get_legal_invoice_pdf,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  prepareLegalInvoicePdf: defineHttpOperation(
    Api.groups.legalInvoicePdfs.endpoints.prepareLegalInvoicePdf,
    (token, { params, headers, payload }) =>
      Commerce.prepareLegalInvoicePdf(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
