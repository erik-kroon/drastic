import { Api } from "@open-erp/contracts/api";
import * as Policy from "@open-erp/contracts/invoice-policy";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const InvoicePolicyHandlers = HttpApiBuilder.group(Api, "invoicePolicies", (handlers) =>
  handlers
    .handle("saveInvoicePolicyCandidate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "saveInvoicePolicyCandidate",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Policy.InvoicePolicyCandidate,
        ),
      ),
    )
    .handle("reviewInvoicePolicyCandidate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "reviewInvoicePolicyCandidate",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          Policy.InvoicePolicyReview,
        ),
      ),
    )
    .handle("getInvoicePolicyCandidate", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "getInvoicePolicyCandidate",
          [token, scopeParameter(params), params.id],
          Policy.InvoicePolicyView,
        ),
      ),
    )
    .handle("invoicePolicyHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("invoicePolicyHistory", [token, scopeParameter(params)], Policy.InvoicePolicyHistory),
      ),
    ),
);
