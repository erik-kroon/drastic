import { Api } from "@open-erp/contracts/api";

import { capabilities } from "../capabilities/index";
import * as OwnerOperations from "../subledger/owner-operations";
import { scopeFromPath } from "../operation-scope";
import { bindHttpOperation, defineHttpOperation } from "../capabilities/http-operation";

export const OwnerOperationOperations = {
  ownersGetPaidPurchase: bindHttpOperation(
    Api.groups.ownerOperations.endpoints.ownersGetPaidPurchase,
    capabilities.owners_get_paid_purchase,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  ownersExecuteOperation: bindHttpOperation(
    Api.groups.ownerOperations.endpoints.ownersExecuteOperation,
    capabilities.owners_execute_operation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  ownersApproveOperation: defineHttpOperation(
    Api.groups.ownerOperations.endpoints.ownersApproveOperation,
    (token, { params, headers, payload }) =>
      OwnerOperations.approveOwnerOperation(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  ownersGetOperation: bindHttpOperation(
    Api.groups.ownerOperations.endpoints.ownersGetOperation,
    capabilities.owners_get_operation,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  ownersPrepareOperation: bindHttpOperation(
    Api.groups.ownerOperations.endpoints.ownersPrepareOperation,
    capabilities.owners_prepare_operation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
