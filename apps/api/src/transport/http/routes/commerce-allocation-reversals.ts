import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Commerce from "../../../application/commerce/allocation-reversals";

export const CommerceAllocationReversalHandlers = HttpApiBuilder.group(
  Api,
  "commerceAllocationReversals",
  (handlers) =>
    handlers
      .handle("prepareCommerceAllocationReversal", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Commerce.prepareAllocationReversal(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getCommerceAllocationReversal", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Commerce.getAllocationReversal(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      )
      .handle("listCommerceAllocationReversals", ({ params, query: page }) =>
        Effect.flatMap(authenticate, (token) =>
          Commerce.listAllocationReversals(token, {
            scope: scopeFromPath(params),
            after: page.after ?? "",
          }),
        ),
      )
      .handle("getCommerceAllocationStatus", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Commerce.getAllocationStatus(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      )
      .handle("getCommerceRegisterAllocationStatus", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Commerce.getRegisterAllocationStatus(token, {
            scope: scopeFromPath(params),
            id: params.id,
          }),
        ),
      )
      .handle("approveCommerceAllocationReversal", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Commerce.approveAllocationReversal(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("executeCommerceAllocationReversal", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Commerce.executeAllocationReversal(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("revokeCommerceAllocationReversalApproval", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Commerce.revokeAllocationReversalApproval(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      ),
);
