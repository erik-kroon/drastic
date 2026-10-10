import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Commerce from "../commerce/invoice-delivery";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const InvoiceDeliveryOperations = {
  invoiceDeliveryHistory: bindHttpOperation(
    Api.groups.invoiceDeliveries.endpoints.invoiceDeliveryHistory,
    capabilities.commerce_invoice_delivery_history,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getInvoiceDelivery: bindHttpOperation(
    Api.groups.invoiceDeliveries.endpoints.getInvoiceDelivery,
    capabilities.commerce_get_invoice_delivery,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  resolveInvoiceDeliverySimulation: defineHttpOperation(
    Api.groups.invoiceDeliveries.endpoints.resolveInvoiceDeliverySimulation,
    (token, { params, headers, payload }) =>
      Commerce.resolveSimulation(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  startInvoiceDeliverySimulation: defineHttpOperation(
    Api.groups.invoiceDeliveries.endpoints.startInvoiceDeliverySimulation,
    (token, { params, headers, payload }) =>
      Commerce.startSimulation(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveInvoiceDelivery: defineHttpOperation(
    Api.groups.invoiceDeliveries.endpoints.approveInvoiceDelivery,
    (token, { params, headers, payload }) =>
      Commerce.approveDelivery(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareInvoiceDelivery: defineHttpOperation(
    Api.groups.invoiceDeliveries.endpoints.prepareInvoiceDelivery,
    (token, { params, headers, payload }) =>
      Commerce.prepareDelivery(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
