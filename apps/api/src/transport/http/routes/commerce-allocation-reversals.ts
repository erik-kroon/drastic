import { Api } from "@open-erp/contracts/api";
import * as Reversal from "@open-erp/contracts/commerce-allocation-reversals";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const CommerceAllocationReversalHandlers = HttpApiBuilder.group(Api, "commerceAllocationReversals", (handlers) =>
  handlers
    .handle("prepareCommerceAllocationReversal", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query("prepareCommerceAllocationReversal", [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)], Reversal.CommerceAllocationReversalPlan),
      ),
    )
    .handle("getCommerceAllocationReversal", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("getCommerceAllocationReversal", [token, scopeParameter(params), params.id], Reversal.CommerceAllocationReversalView),
      ),
    )
    .handle("listCommerceAllocationReversals", ({ params, query: page }) =>
      Effect.flatMap(authenticate, (token) =>
        query("listCommerceAllocationReversals", [token, scopeParameter(params), page.after ?? ""], Reversal.CommerceAllocationReversalList),
      ),
    )
    .handle("getCommerceAllocationStatus", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("getCommerceAllocationStatus", [token, scopeParameter(params), params.id], Reversal.CommerceAllocationStatus),
      ),
    )
    .handle("getCommerceRegisterAllocationStatus", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("getCommerceRegisterAllocationStatus", [token, scopeParameter(params), params.id], Reversal.CommerceRegisterAllocationStatus),
      ),
    )
    .handle("approveCommerceAllocationReversal", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query("approveCommerceAllocationReversal", [token, scopeParameter(params), headers["idempotency-key"], params.id, JSON.stringify(payload)], Reversal.CommerceAllocationReversalApproval),
      ),
    )
    .handle("executeCommerceAllocationReversal", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query("executeCommerceAllocationReversal", [token, scopeParameter(params), headers["idempotency-key"], params.id, JSON.stringify(payload)], Reversal.CommerceAllocationReversalExecution),
      ),
    )
    .handle("revokeCommerceAllocationReversalApproval", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query("revokeCommerceAllocationReversalApproval", [token, scopeParameter(params), headers["idempotency-key"], params.id, JSON.stringify(payload)], Reversal.CommerceAllocationReversalRevocation),
      ),
    ),
);
