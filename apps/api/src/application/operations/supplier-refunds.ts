import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import {
  approvePaidSupplierCredit,
  approveSupplierRefund,
  executePaidSupplierCredit,
  executeSupplierRefund,
  getPaidSupplierCreditReview,
  getSupplierRefundReview,
  preparePaidSupplierCredit,
  prepareSupplierRefund,
} from "../purchases/refunds";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const SupplierRefundOperations = {
  supplierRefundHistory: bindHttpOperation(
    Api.groups.supplierRefunds.endpoints.supplierRefundHistory,
    capabilities.commerce_supplier_refund_history,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getSupplierRefundPosition: bindHttpOperation(
    Api.groups.supplierRefunds.endpoints.getSupplierRefundPosition,
    capabilities.commerce_get_supplier_refund_position,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getSupplierRefundReview: defineHttpOperation(
    Api.groups.supplierRefunds.endpoints.getSupplierRefundReview,
    (token, { params }) =>
      getSupplierRefundReview(token, { scope: scopeFromPath(params), reviewId: params.id }),
  ),
  executeSupplierRefund: defineHttpOperation(
    Api.groups.supplierRefunds.endpoints.executeSupplierRefund,
    (token, { params, headers, payload }) =>
      executeSupplierRefund(token, {
        scope: scopeFromPath(params),
        reviewId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveSupplierRefund: defineHttpOperation(
    Api.groups.supplierRefunds.endpoints.approveSupplierRefund,
    (token, { params, headers, payload }) =>
      approveSupplierRefund(token, {
        scope: scopeFromPath(params),
        reviewId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareSupplierRefund: defineHttpOperation(
    Api.groups.supplierRefunds.endpoints.prepareSupplierRefund,
    (token, { params, headers, payload }) =>
      prepareSupplierRefund(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getPaidSupplierCreditReview: defineHttpOperation(
    Api.groups.supplierRefunds.endpoints.getPaidSupplierCreditReview,
    (token, { params }) =>
      getPaidSupplierCreditReview(token, { scope: scopeFromPath(params), reviewId: params.id }),
  ),
  executePaidSupplierCredit: defineHttpOperation(
    Api.groups.supplierRefunds.endpoints.executePaidSupplierCredit,
    (token, { params, headers, payload }) =>
      executePaidSupplierCredit(token, {
        scope: scopeFromPath(params),
        reviewId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approvePaidSupplierCredit: defineHttpOperation(
    Api.groups.supplierRefunds.endpoints.approvePaidSupplierCredit,
    (token, { params, headers, payload }) =>
      approvePaidSupplierCredit(token, {
        scope: scopeFromPath(params),
        reviewId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  preparePaidSupplierCredit: defineHttpOperation(
    Api.groups.supplierRefunds.endpoints.preparePaidSupplierCredit,
    (token, { params, headers, payload }) =>
      preparePaidSupplierCredit(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
