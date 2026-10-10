import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { capabilities } from "../capabilities/index";
import * as Commerce from "../commerce/invoice-lifecycle";
import { bindHttpOperation, defineHttpOperation } from "../capabilities/http-operation";

export const InvoiceCancellationOperations = {
  getInvoiceCancellationStatus: bindHttpOperation(
    Api.groups.invoiceCancellations.endpoints.getInvoiceCancellationStatus,
    capabilities.commerce_get_invoice_cancellation_status,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  getInvoiceCancellation: bindHttpOperation(
    Api.groups.invoiceCancellations.endpoints.getInvoiceCancellation,
    capabilities.commerce_get_invoice_cancellation,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  revokeInvoiceCancellationApproval: defineHttpOperation(
    Api.groups.invoiceCancellations.endpoints.revokeInvoiceCancellationApproval,
    (token, { params, headers, payload }) =>
      Commerce.revokeInvoiceCancellationApproval(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  executeInvoiceCancellation: defineHttpOperation(
    Api.groups.invoiceCancellations.endpoints.executeInvoiceCancellation,
    (token, { params, headers, payload }) =>
      Commerce.executeInvoiceCancellation(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveInvoiceCancellation: defineHttpOperation(
    Api.groups.invoiceCancellations.endpoints.approveInvoiceCancellation,
    (token, { params, headers, payload }) =>
      Commerce.approveInvoiceCancellation(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareInvoiceCancellation: defineHttpOperation(
    Api.groups.invoiceCancellations.endpoints.prepareInvoiceCancellation,
    (token, { params, headers, payload }) =>
      Commerce.prepareInvoiceCancellation(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
