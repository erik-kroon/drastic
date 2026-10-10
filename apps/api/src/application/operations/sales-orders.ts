import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Commerce from "../commerce/sales-orders";

import { defineHttpOperation } from "../capabilities/http-operation";

export const SalesOrderOperations = {
  convertSalesOrder: defineHttpOperation(
    Api.groups.salesOrders.endpoints.convertSalesOrder,
    (token, { params, headers, payload }) =>
      Commerce.convertSalesOrder(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  transitionSalesDocument: defineHttpOperation(
    Api.groups.salesOrders.endpoints.transitionSalesDocument,
    (token, { params, headers, payload }) =>
      Commerce.transitionSalesDocument(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  reviseSalesDocument: defineHttpOperation(
    Api.groups.salesOrders.endpoints.reviseSalesDocument,
    (token, { params, headers, payload }) =>
      Commerce.reviseSalesDocument(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getSalesDocument: defineHttpOperation(
    Api.groups.salesOrders.endpoints.getSalesDocument,
    (token, { params }) =>
      Commerce.getSalesDocument(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  listSalesDocuments: defineHttpOperation(
    Api.groups.salesOrders.endpoints.listSalesDocuments,
    (token, { params }) => Commerce.listSalesDocuments(token, { scope: scopeFromPath(params) }),
  ),
  createSalesDocument: defineHttpOperation(
    Api.groups.salesOrders.endpoints.createSalesDocument,
    (token, { params, headers, payload }) =>
      Commerce.createSalesDocument(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
