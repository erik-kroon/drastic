import { capabilities } from "../capabilities";
import { Api } from "@open-erp/contracts/api";
import { scopeFromPath } from "../operation-scope";
import * as Templates from "../commerce/invoice-templates";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const InvoiceTemplateOperations = {
  applyInvoiceTemplate: bindHttpOperation(
    Api.groups.invoiceTemplates.endpoints.applyInvoiceTemplate,
    capabilities.invoice_templates_apply,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  archiveInvoiceTemplate: defineHttpOperation(
    Api.groups.invoiceTemplates.endpoints.archiveInvoiceTemplate,
    (token, { params, headers, payload }) =>
      Templates.archiveInvoiceTemplate(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  reviseInvoiceTemplate: defineHttpOperation(
    Api.groups.invoiceTemplates.endpoints.reviseInvoiceTemplate,
    (token, { params, headers, payload }) =>
      Templates.reviseInvoiceTemplate(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  createInvoiceTemplate: defineHttpOperation(
    Api.groups.invoiceTemplates.endpoints.createInvoiceTemplate,
    (token, { params, headers, payload }) =>
      Templates.createInvoiceTemplate(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getInvoiceTemplate: bindHttpOperation(
    Api.groups.invoiceTemplates.endpoints.getInvoiceTemplate,
    capabilities.invoice_templates_get,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      revision: query.revision,
    }),
  ),
  listInvoiceTemplates: bindHttpOperation(
    Api.groups.invoiceTemplates.endpoints.listInvoiceTemplates,
    capabilities.invoice_templates_list,
    ({ params, query }) => ({ scope: scopeFromPath(params), after: query.after }),
  ),
};
