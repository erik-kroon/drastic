import { Api } from "@open-erp/contracts/api";
import * as Policy from "@open-erp/contracts/legal-sales-policy";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const LegalSalesPolicyHandlers = HttpApiBuilder.group(Api, "legalSalesPolicies", (handlers) =>
  handlers
    .handle("activateLegalSalesPolicy", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query("activateLegalSalesPolicy", [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)], Policy.LegalSalesPolicy),
      ),
    )
    .handle("legalSalesPolicyHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("legalSalesPolicyHistory", [token, scopeParameter(params)], Policy.LegalSalesPolicyHistory),
      ),
    )
    .handle("getLegalSalesPolicy", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("getLegalSalesPolicy", [token, scopeParameter(params), params.id], Policy.LegalSalesPolicy),
      ),
    ),
);
