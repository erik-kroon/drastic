import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Commerce from "../commerce/documents";

import { defineHttpOperation } from "../capabilities/http-operation";

export const InvoiceDocumentOperations = {
  invoiceDocumentHistory: defineHttpOperation(
    Api.groups.invoiceDocuments.endpoints.invoiceDocumentHistory,
    (token, { params }) =>
      Commerce.invoiceDocumentHistory(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  resumeInvoiceDocument: defineHttpOperation(
    Api.groups.invoiceDocuments.endpoints.resumeInvoiceDocument,
    (token, { params }) =>
      Commerce.resumeInvoiceDocument(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  getInvoiceDocument: defineHttpOperation(
    Api.groups.invoiceDocuments.endpoints.getInvoiceDocument,
    (token, { params }) =>
      Commerce.getInvoiceDocument(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  prepareInvoiceDocument: defineHttpOperation(
    Api.groups.invoiceDocuments.endpoints.prepareInvoiceDocument,
    (token, { params, headers, payload }) =>
      Commerce.prepareInvoiceDocument(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
