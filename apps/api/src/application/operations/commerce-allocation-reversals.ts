import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Commerce from "../commerce/allocation-reversals";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const CommerceAllocationReversalOperations = {
  revokeCommerceAllocationReversalApproval: defineHttpOperation(
    Api.groups.commerceAllocationReversals.endpoints.revokeCommerceAllocationReversalApproval,
    (token, { params, headers, payload }) =>
      Commerce.revokeAllocationReversalApproval(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  executeCommerceAllocationReversal: bindHttpOperation(
    Api.groups.commerceAllocationReversals.endpoints.executeCommerceAllocationReversal,
    capabilities.commerce_execute_allocation_reversal,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  approveCommerceAllocationReversal: defineHttpOperation(
    Api.groups.commerceAllocationReversals.endpoints.approveCommerceAllocationReversal,
    (token, { params, headers, payload }) =>
      Commerce.approveAllocationReversal(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getCommerceRegisterAllocationStatus: bindHttpOperation(
    Api.groups.commerceAllocationReversals.endpoints.getCommerceRegisterAllocationStatus,
    capabilities.commerce_get_register_allocation_status,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  getCommerceAllocationStatus: bindHttpOperation(
    Api.groups.commerceAllocationReversals.endpoints.getCommerceAllocationStatus,
    capabilities.commerce_get_allocation_status,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  listCommerceAllocationReversals: bindHttpOperation(
    Api.groups.commerceAllocationReversals.endpoints.listCommerceAllocationReversals,
    capabilities.commerce_list_allocation_reversals,
    ({ params, query: page }) => ({
      scope: scopeFromPath(params),
      after: page.after ?? "",
    }),
  ),
  getCommerceAllocationReversal: bindHttpOperation(
    Api.groups.commerceAllocationReversals.endpoints.getCommerceAllocationReversal,
    capabilities.commerce_get_allocation_reversal,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  prepareCommerceAllocationReversal: bindHttpOperation(
    Api.groups.commerceAllocationReversals.endpoints.prepareCommerceAllocationReversal,
    capabilities.commerce_prepare_allocation_reversal,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
