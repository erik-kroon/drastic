import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  linkExpenseCostBasis,
  readAccruedCost,
  recordAccruedCost,
  resolveAccruedCost,
} from "../../../application/subledger/prepayments";

// Invoice-linked prepayments and accrued-cost true-up over the existing
// subledger schedule owner. The cost excludes deductible input VAT, so
// deferring changes expense timing and never a VAT tax point. A residual is a
// computed difference, never a plug, and one invoice resolves an accrual once.
export const PrepaymentsHandlers = HttpApiBuilder.group(Api, "prepayments", (handlers) =>
  handlers
    .handle("linkExpenseCostBasis", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        linkExpenseCostBasis(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("recordAccruedCost", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        recordAccruedCost(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("resolveAccruedCost", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        resolveAccruedCost(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("readAccruedCost", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        readAccruedCost(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
