import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Owner from "../../../application/treasury/loans";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const TreasuryLoanHandlers = HttpApiBuilder.group(Api, "treasuryLoan", (handlers) =>
  handlers
    .handle("listLoans", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.list(token, { scope: scopeFromPath(params), after: query.after }),
      ),
    )
    .handle("listLoanReviews", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.listReviews(token, {
          scope: scopeFromPath(params),
          id: params.id,
          after: query.after,
        }),
      ),
    )
    .handle("adoptLoan", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.adopt(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("recordLoanRate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.recordRate(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("prepareLoanReview", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.prepare(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveLoanReview", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.approve(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeLoanReview", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getLoan", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.get(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("getLoanReview", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.getReview(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    ),
);
