import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Commerce from "../commerce/legal";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const LegalDeliveryOperations = {
  legalDeliveryHistory: bindHttpOperation(
    Api.groups.legalDeliveries.endpoints.legalDeliveryHistory,
    capabilities.commerce_legal_delivery_history,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getLegalDelivery: bindHttpOperation(
    Api.groups.legalDeliveries.endpoints.getLegalDelivery,
    capabilities.commerce_get_legal_delivery,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  reconcileLegalDeliveryAttempt: defineHttpOperation(
    Api.groups.legalDeliveries.endpoints.reconcileLegalDeliveryAttempt,
    (token, { params, headers, payload }) =>
      Commerce.reconcileLegalDeliveryAttempt(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  startLegalDeliveryAttempt: defineHttpOperation(
    Api.groups.legalDeliveries.endpoints.startLegalDeliveryAttempt,
    (token, { params, headers, payload }) =>
      Commerce.startLegalDeliveryAttempt(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveLegalDelivery: defineHttpOperation(
    Api.groups.legalDeliveries.endpoints.approveLegalDelivery,
    (token, { params, headers, payload }) =>
      Commerce.approveLegalDelivery(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareLegalDelivery: defineHttpOperation(
    Api.groups.legalDeliveries.endpoints.prepareLegalDelivery,
    (token, { params, headers, payload }) =>
      Commerce.prepareLegalDelivery(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
