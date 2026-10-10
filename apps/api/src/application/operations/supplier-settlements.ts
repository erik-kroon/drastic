import { capabilities } from "../capabilities";
import { Api } from "@open-erp/contracts/api";

import { scopeFromPath } from "../operation-scope";
import {
  approveSupplierSettlementCancellation,
  approveSupplierSettlement,
  revokeSupplierSettlementApproval,
  revokeSupplierSettlementCancellationApproval,
} from "../purchases/supplier-settlements";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const SupplierSettlementOperations = {
  revokeSupplierSettlementCancellationApproval: defineHttpOperation(
    Api.groups.supplierSettlements.endpoints.revokeSupplierSettlementCancellationApproval,
    (token, { params, headers, payload }) =>
      revokeSupplierSettlementCancellationApproval(token, {
        scope: scopeFromPath(params),
        approvalId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveSupplierSettlementCancellation: defineHttpOperation(
    Api.groups.supplierSettlements.endpoints.approveSupplierSettlementCancellation,
    (token, { params, headers, payload }) =>
      approveSupplierSettlementCancellation(token, {
        scope: scopeFromPath(params),
        planId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  executeSupplierSettlementCancellation: bindHttpOperation(
    Api.groups.supplierSettlements.endpoints.executeSupplierSettlementCancellation,
    capabilities.purchases_execute_supplier_settlement_cancellation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      planId: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  prepareSupplierSettlementCancellation: bindHttpOperation(
    Api.groups.supplierSettlements.endpoints.prepareSupplierSettlementCancellation,
    capabilities.purchases_prepare_supplier_settlement_cancellation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getSupplierSettlementReceipt: bindHttpOperation(
    Api.groups.supplierSettlements.endpoints.getSupplierSettlementReceipt,
    capabilities.purchases_get_supplier_settlement_receipt,
    ({ params }) => ({
      scope: scopeFromPath(params),
      receiptId: params.id,
    }),
  ),
  executeSupplierSettlement: bindHttpOperation(
    Api.groups.supplierSettlements.endpoints.executeSupplierSettlement,
    capabilities.purchases_execute_supplier_settlement,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      planId: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  revokeSupplierSettlementApproval: defineHttpOperation(
    Api.groups.supplierSettlements.endpoints.revokeSupplierSettlementApproval,
    (token, { params, headers, payload }) =>
      revokeSupplierSettlementApproval(token, {
        scope: scopeFromPath(params),
        approvalId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveSupplierSettlement: defineHttpOperation(
    Api.groups.supplierSettlements.endpoints.approveSupplierSettlement,
    (token, { params, headers, payload }) =>
      approveSupplierSettlement(token, {
        scope: scopeFromPath(params),
        planId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getSupplierSettlement: bindHttpOperation(
    Api.groups.supplierSettlements.endpoints.getSupplierSettlement,
    capabilities.purchases_get_supplier_settlement,
    ({ params }) => ({ scope: scopeFromPath(params), planId: params.id }),
  ),
  prepareSupplierSettlement: bindHttpOperation(
    Api.groups.supplierSettlements.endpoints.prepareSupplierSettlement,
    capabilities.purchases_prepare_supplier_settlement,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getSupplierSettlementCancellation: bindHttpOperation(
    Api.groups.supplierSettlements.endpoints.getSupplierSettlementCancellation,
    capabilities.purchases_get_supplier_settlement_cancellation,
    ({ params }) => ({
      scope: scopeFromPath(params),
      planId: params.id,
    }),
  ),
  listSupplierSettlements: bindHttpOperation(
    Api.groups.supplierSettlements.endpoints.listSupplierSettlements,
    capabilities.purchases_list_supplier_settlements,
    ({ params, query }) => ({ scope: scopeFromPath(params), ...query }),
  ),
  listSupplierSettlementCancellationApprovals: bindHttpOperation(
    Api.groups.supplierSettlements.endpoints.listSupplierSettlementCancellationApprovals,
    capabilities.purchases_list_supplier_settlement_cancellation_approvals,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      planId: params.id,
      ...query,
    }),
  ),
};
