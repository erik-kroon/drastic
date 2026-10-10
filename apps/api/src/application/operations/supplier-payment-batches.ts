import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import {
  exportSupplierPaymentBatch,
  prepareSupplierPaymentBatch,
  proposeSupplierPayee,
  reportSupplierPaymentOutcome,
  verifySupplierPayee,
} from "../purchases/payments";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const SupplierPaymentBatchOperations = {
  getSupplierPaymentBatch: bindHttpOperation(
    Api.groups.supplierPaymentBatches.endpoints.getSupplierPaymentBatch,
    capabilities.commerce_get_supplier_payment_batch,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  reportSupplierPaymentOutcome: defineHttpOperation(
    Api.groups.supplierPaymentBatches.endpoints.reportSupplierPaymentOutcome,
    (token, { params, headers, payload }) =>
      reportSupplierPaymentOutcome(token, {
        scope: scopeFromPath(params),
        exportId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  verifySupplierPayee: defineHttpOperation(
    Api.groups.supplierPaymentBatches.endpoints.verifySupplierPayee,
    (token, { params, headers, payload }) =>
      verifySupplierPayee(token, {
        scope: scopeFromPath(params),
        proposalId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getSupplierPayee: bindHttpOperation(
    Api.groups.supplierPaymentBatches.endpoints.getSupplierPayee,
    capabilities.commerce_get_supplier_payee,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  proposeSupplierPayee: defineHttpOperation(
    Api.groups.supplierPaymentBatches.endpoints.proposeSupplierPayee,
    (token, { params, headers, payload }) =>
      proposeSupplierPayee(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  listSupplierPaymentEligibility: bindHttpOperation(
    Api.groups.supplierPaymentBatches.endpoints.listSupplierPaymentEligibility,
    capabilities.commerce_list_supplier_payment_eligibility,
    ({ params, query: search }) => ({
      scope: scopeFromPath(params),
      after: search.after,
    }),
  ),
  exportSupplierPaymentBatch: defineHttpOperation(
    Api.groups.supplierPaymentBatches.endpoints.exportSupplierPaymentBatch,
    (token, { params, headers, payload }) =>
      exportSupplierPaymentBatch(token, {
        scope: scopeFromPath(params),
        previewId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareSupplierPaymentBatch: defineHttpOperation(
    Api.groups.supplierPaymentBatches.endpoints.prepareSupplierPaymentBatch,
    (token, { params, headers, payload }) =>
      prepareSupplierPaymentBatch(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
