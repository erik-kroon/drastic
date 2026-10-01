import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { capabilities } from "../../../application/capabilities";
import * as OwnerOperations from "../../../application/subledger/owner-operations";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const OwnerOperationHandlers = HttpApiBuilder.group(Api, "ownerOperations", (handlers) =>
  handlers
    .handle("ownersPrepareOperation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_prepare_operation.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("ownersGetOperation", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_get_operation.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
        }),
      ),
    )
    // Approval is an operator-only HTTP command. It is deliberately not in the
    // shared capability map, so it stays absent from the MCP catalogue.
    .handle("ownersApproveOperation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        OwnerOperations.approveOwnerOperation(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("ownersExecuteOperation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_execute_operation.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("ownersGetPaidPurchase", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.owners_get_paid_purchase.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
        }),
      ),
    ),
);
