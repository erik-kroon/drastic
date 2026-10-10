import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import {
  approveSupplierAcceptance,
  executeSupplierAcceptance,
  prepareSupplierAcceptance,
} from "../purchases/acceptance";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const SupplierAcceptanceOperations = {
  supplierAcceptanceHistory: bindHttpOperation(
    Api.groups.supplierAcceptance.endpoints.supplierAcceptanceHistory,
    capabilities.commerce_supplier_acceptance_history,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getSupplierAcceptanceReview: bindHttpOperation(
    Api.groups.supplierAcceptance.endpoints.getSupplierAcceptanceReview,
    capabilities.commerce_get_supplier_acceptance_review,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  executeSupplierAcceptance: defineHttpOperation(
    Api.groups.supplierAcceptance.endpoints.executeSupplierAcceptance,
    (token, { params, headers, payload }) =>
      executeSupplierAcceptance(token, {
        scope: scopeFromPath(params),
        reviewId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveSupplierAcceptance: defineHttpOperation(
    Api.groups.supplierAcceptance.endpoints.approveSupplierAcceptance,
    (token, { params, headers, payload }) =>
      approveSupplierAcceptance(token, {
        scope: scopeFromPath(params),
        reviewId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareSupplierAcceptance: defineHttpOperation(
    Api.groups.supplierAcceptance.endpoints.prepareSupplierAcceptance,
    (token, { params, headers, payload }) =>
      prepareSupplierAcceptance(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
