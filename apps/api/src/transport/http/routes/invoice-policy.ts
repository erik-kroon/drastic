import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Commerce from "../../../application/commerce/invoice-policy";

export const InvoicePolicyHandlers = HttpApiBuilder.group(Api, "invoicePolicies", (handlers) =>
  handlers
    .handle("saveInvoicePolicyCandidate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.saveCandidate(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("reviewInvoicePolicyCandidate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.reviewCandidate(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getInvoicePolicyCandidate", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.getCandidate(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("invoicePolicyHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.readHistory(token, { scope: scopeFromPath(params) }),
      ),
    ),
);
