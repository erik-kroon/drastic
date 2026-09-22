import { Api } from "@open-erp/contracts/api";
import * as Settlement from "@open-erp/contracts/settlements";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "./auth";
import { capabilities } from "./capabilities";
import { query, scopeParameter } from "./database";

export const SettlementHandlers = HttpApiBuilder.group(Api, "settlements", (handlers) =>
  handlers
    .handle("prepareBankAllocation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.bank_prepare_allocation.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getBankAllocation", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.bank_get_allocation.execute(token, {
          scope: params,
          planId: params.id,
        }),
      ),
    )
    .handle("approveBankAllocation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "approveBankAllocation",
          [
            token,
            scopeParameter(params),
            headers["idempotency-key"],
            params.id,
            JSON.stringify(payload),
          ],
          Settlement.BankAllocationApproval,
        ),
      ),
    )
    .handle("executeBankAllocation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.bank_execute_allocation.execute(token, {
          scope: params,
          planId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("reconcileBankCapacity", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.bank_reconcile_capacity.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getBankCapacityReconciliation", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.bank_get_capacity_reconciliation.execute(token, {
          scope: params,
          reconciliationId: params.id,
        }),
      ),
    ),
);
