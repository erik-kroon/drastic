import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  approveBankAllocation,
  executeBankAllocation,
  getBankAllocation,
  prepareBankAllocation,
} from "../../../application/banking/allocations";
import {
  getBankCapacityReconciliation,
  reconcileBankCapacity,
} from "../../../application/banking/reconciliations";

export const SettlementHandlers = HttpApiBuilder.group(Api, "settlements", (handlers) =>
  handlers
    .handle("prepareBankAllocation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareBankAllocation(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getBankAllocation", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getBankAllocation(token, { scope: scopeFromPath(params), planId: params.id }),
      ),
    )
    .handle("approveBankAllocation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        approveBankAllocation(token, {
          scope: scopeFromPath(params),
          planId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeBankAllocation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        executeBankAllocation(token, {
          scope: scopeFromPath(params),
          planId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("reconcileBankCapacity", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        reconcileBankCapacity(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getBankCapacityReconciliation", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getBankCapacityReconciliation(token, {
          scope: scopeFromPath(params),
          reconciliationId: params.id,
        }),
      ),
    ),
);
