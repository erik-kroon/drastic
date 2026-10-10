import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { approveBankAllocation } from "../banking/allocations";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const SettlementOperations = {
  getBankCapacityReconciliation: bindHttpOperation(
    Api.groups.settlements.endpoints.getBankCapacityReconciliation,
    capabilities.bank_get_capacity_reconciliation,
    ({ params }) => ({
      scope: scopeFromPath(params),
      reconciliationId: params.id,
    }),
  ),
  reconcileBankCapacity: bindHttpOperation(
    Api.groups.settlements.endpoints.reconcileBankCapacity,
    capabilities.bank_reconcile_capacity,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  executeBankAllocation: bindHttpOperation(
    Api.groups.settlements.endpoints.executeBankAllocation,
    capabilities.bank_execute_allocation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      planId: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  approveBankAllocation: defineHttpOperation(
    Api.groups.settlements.endpoints.approveBankAllocation,
    (token, { params, headers, payload }) =>
      approveBankAllocation(token, {
        scope: scopeFromPath(params),
        planId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getBankAllocation: bindHttpOperation(
    Api.groups.settlements.endpoints.getBankAllocation,
    capabilities.bank_get_allocation,
    ({ params }) => ({ scope: scopeFromPath(params), planId: params.id }),
  ),
  prepareBankAllocation: bindHttpOperation(
    Api.groups.settlements.endpoints.prepareBankAllocation,
    capabilities.bank_prepare_allocation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
