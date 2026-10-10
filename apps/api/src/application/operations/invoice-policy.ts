import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Commerce from "../commerce/invoice-policy";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const InvoicePolicyOperations = {
  invoicePolicyHistory: bindHttpOperation(
    Api.groups.invoicePolicies.endpoints.invoicePolicyHistory,
    capabilities.commerce_invoice_policy_history,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  getInvoicePolicyCandidate: bindHttpOperation(
    Api.groups.invoicePolicies.endpoints.getInvoicePolicyCandidate,
    capabilities.commerce_get_invoice_policy_candidate,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  reviewInvoicePolicyCandidate: defineHttpOperation(
    Api.groups.invoicePolicies.endpoints.reviewInvoicePolicyCandidate,
    (token, { params, headers, payload }) =>
      Commerce.reviewCandidate(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  saveInvoicePolicyCandidate: defineHttpOperation(
    Api.groups.invoicePolicies.endpoints.saveInvoicePolicyCandidate,
    (token, { params, headers, payload }) =>
      Commerce.saveCandidate(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
