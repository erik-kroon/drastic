import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { capabilities } from "../capabilities/index";
import * as Allocations from "../commerce/allocation-reversals";
import { bindHttpOperation, defineHttpOperation } from "../capabilities/http-operation";

export const CommerceOperations = {
  commerceApplyAllocation: bindHttpOperation(
    Api.groups.commerce.endpoints.commerceApplyAllocation,
    capabilities.commerce_apply_allocation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
      id: params.id,
    }),
  ),
  commerceApproveAllocation: defineHttpOperation(
    Api.groups.commerce.endpoints.commerceApproveAllocation,
    (token, { params, headers, payload }) =>
      Allocations.approveAllocation(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  commerceGetAllocation: bindHttpOperation(
    Api.groups.commerce.endpoints.commerceGetAllocation,
    capabilities.commerce_get_allocation,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  commercePrepareAllocation: bindHttpOperation(
    Api.groups.commerce.endpoints.commercePrepareAllocation,
    capabilities.commerce_prepare_allocation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  commerceGetPaymentCapacity: bindHttpOperation(
    Api.groups.commerce.endpoints.commerceGetPaymentCapacity,
    capabilities.commerce_get_payment_capacity,
    ({ params }) => ({
      scope: scopeFromPath(params),
      voucherId: params.voucherId,
      lineId: params.lineId,
    }),
  ),
  commerceListInvoices: bindHttpOperation(
    Api.groups.commerce.endpoints.commerceListInvoices,
    capabilities.commerce_list_invoices,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      after: query.after,
    }),
  ),
  commerceInvoiceHistory: bindHttpOperation(
    Api.groups.commerce.endpoints.commerceInvoiceHistory,
    capabilities.commerce_invoice_history,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      after: query.after,
    }),
  ),
  commerceInvoicePayments: bindHttpOperation(
    Api.groups.commerce.endpoints.commerceInvoicePayments,
    capabilities.commerce_invoice_payments,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      ...query,
    }),
  ),
  commerceGetInvoice: bindHttpOperation(
    Api.groups.commerce.endpoints.commerceGetInvoice,
    capabilities.commerce_get_invoice,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  commerceReviseInvoice: bindHttpOperation(
    Api.groups.commerce.endpoints.commerceReviseInvoice,
    capabilities.commerce_revise_invoice,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
      id: params.id,
    }),
  ),
  commerceCreateInvoice: bindHttpOperation(
    Api.groups.commerce.endpoints.commerceCreateInvoice,
    capabilities.commerce_create_invoice,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  commerceSupplierInvoiceDuplicates: bindHttpOperation(
    Api.groups.commerce.endpoints.commerceSupplierInvoiceDuplicates,
    capabilities.commerce_supplier_invoice_duplicates,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      ...query,
    }),
  ),
  commerceListCounterparties: bindHttpOperation(
    Api.groups.commerce.endpoints.commerceListCounterparties,
    capabilities.commerce_list_counterparties,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      after: query.after,
    }),
  ),
  commerceGetCounterparty: bindHttpOperation(
    Api.groups.commerce.endpoints.commerceGetCounterparty,
    capabilities.commerce_get_counterparty,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      revision: query.revision,
    }),
  ),
  commerceReviseCounterparty: bindHttpOperation(
    Api.groups.commerce.endpoints.commerceReviseCounterparty,
    capabilities.commerce_revise_counterparty,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
      id: params.id,
    }),
  ),
  commerceCreateCounterparty: bindHttpOperation(
    Api.groups.commerce.endpoints.commerceCreateCounterparty,
    capabilities.commerce_create_counterparty,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
