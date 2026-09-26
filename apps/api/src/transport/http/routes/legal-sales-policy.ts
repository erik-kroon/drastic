import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Commerce from "../../../application/commerce/legal";

export const LegalSalesPolicyHandlers = HttpApiBuilder.group(
  Api,
  "legalSalesPolicies",
  (handlers) =>
    handlers
      .handle("activateLegalSalesPolicy", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Commerce.activateLegalSalesPolicy(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("legalSalesPolicyHistory", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Commerce.readLegalSalesPolicyHistory(token, { scope: scopeFromPath(params) }),
        ),
      )
      .handle("getLegalSalesPolicy", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Commerce.getLegalSalesPolicy(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      ),
);
