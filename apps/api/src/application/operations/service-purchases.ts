import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import {
  approveServicePurchase,
  executeServicePurchase,
  prepareServicePurchase,
} from "../purchases/service-purchases";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const ServicePurchaseOperations = {
  getServicePurchaseRecognition: bindHttpOperation(
    Api.groups.servicePurchases.endpoints.getServicePurchaseRecognition,
    capabilities.commerce_get_service_purchase_recognition,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  servicePurchaseHistory: bindHttpOperation(
    Api.groups.servicePurchases.endpoints.servicePurchaseHistory,
    capabilities.commerce_service_purchase_history,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getServicePurchaseReview: bindHttpOperation(
    Api.groups.servicePurchases.endpoints.getServicePurchaseReview,
    capabilities.commerce_get_service_purchase_review,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  executeServicePurchase: defineHttpOperation(
    Api.groups.servicePurchases.endpoints.executeServicePurchase,
    (token, { params, headers, payload }) =>
      executeServicePurchase(token, {
        scope: scopeFromPath(params),
        reviewId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveServicePurchase: defineHttpOperation(
    Api.groups.servicePurchases.endpoints.approveServicePurchase,
    (token, { params, headers, payload }) =>
      approveServicePurchase(token, {
        scope: scopeFromPath(params),
        reviewId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareServicePurchase: defineHttpOperation(
    Api.groups.servicePurchases.endpoints.prepareServicePurchase,
    (token, { params, headers, payload }) =>
      prepareServicePurchase(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
