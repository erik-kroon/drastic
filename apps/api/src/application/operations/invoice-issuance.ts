import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { capabilities } from "../capabilities/index";
import * as Commerce from "../commerce/invoice-lifecycle";
import { bindHttpOperation, defineHttpOperation } from "../capabilities/http-operation";

export const InvoiceIssuanceOperations = {
  invoiceIssueHistory: bindHttpOperation(
    Api.groups.invoiceIssuance.endpoints.invoiceIssueHistory,
    capabilities.commerce_invoice_issue_history,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  getInvoiceIssueReview: bindHttpOperation(
    Api.groups.invoiceIssuance.endpoints.getInvoiceIssueReview,
    capabilities.commerce_get_invoice_issue_review,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  executeInvoiceIssue: defineHttpOperation(
    Api.groups.invoiceIssuance.endpoints.executeInvoiceIssue,
    (token, { params, headers, payload }) =>
      Commerce.executeInvoiceIssue(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveInvoiceIssue: defineHttpOperation(
    Api.groups.invoiceIssuance.endpoints.approveInvoiceIssue,
    (token, { params, headers, payload }) =>
      Commerce.approveInvoiceIssue(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareInvoiceIssue: defineHttpOperation(
    Api.groups.invoiceIssuance.endpoints.prepareInvoiceIssue,
    (token, { params, headers, payload }) =>
      Commerce.prepareInvoiceIssue(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
