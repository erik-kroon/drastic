import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import {
  approveSupplierCredit,
  executeSupplierCredit,
  prepareSupplierCredit,
} from "../purchases/credits";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const SupplierCreditOperations = {
  supplierCreditHistory: bindHttpOperation(
    Api.groups.supplierCredits.endpoints.supplierCreditHistory,
    capabilities.commerce_supplier_credit_history,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getSupplierCreditReview: bindHttpOperation(
    Api.groups.supplierCredits.endpoints.getSupplierCreditReview,
    capabilities.commerce_get_supplier_credit_review,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  executeSupplierCredit: defineHttpOperation(
    Api.groups.supplierCredits.endpoints.executeSupplierCredit,
    (token, { params, headers, payload }) =>
      executeSupplierCredit(token, {
        scope: scopeFromPath(params),
        reviewId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveSupplierCredit: defineHttpOperation(
    Api.groups.supplierCredits.endpoints.approveSupplierCredit,
    (token, { params, headers, payload }) =>
      approveSupplierCredit(token, {
        scope: scopeFromPath(params),
        reviewId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareSupplierCredit: defineHttpOperation(
    Api.groups.supplierCredits.endpoints.prepareSupplierCredit,
    (token, { params, headers, payload }) =>
      prepareSupplierCredit(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
