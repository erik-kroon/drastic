import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Owner from "../../../application/banking/foreign-cash";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const ForeignCashHandlers = HttpApiBuilder.group(Api, "foreignCash", (handlers) =>
  handlers
    .handle("prepareForeignCash", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.prepareForeignCash(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveForeignCash", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.approveForeignCash(token, {
          scope: scopeFromPath(params),
          reviewId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeForeignCash", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.executeForeignCash(token, {
          scope: scopeFromPath(params),
          reviewId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getForeignCashHolding", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.getForeignCashHolding(token, { scope: scopeFromPath(params), accountId: params.id }),
      ),
    )
    .handle("getForeignCashReview", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.getForeignCashReview(token, { scope: scopeFromPath(params), reviewId: params.id }),
      ),
    )
    .handle("reconcileForeignCash", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.reconcileForeignCash(token, {
          scope: scopeFromPath(params),
          accountId: params.id,
          statementId: params.statementId,
        }),
      ),
    ),
);
