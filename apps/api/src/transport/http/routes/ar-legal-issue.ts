import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import * as Commerce from "../../../application/commerce/legal";

export const ArLegalIssueHandlers = HttpApiBuilder.group(Api, "arLegalIssue", (handlers) =>
  handlers
    .handle("activateArLegalAccountingProfile", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.activateArLegalAccountingProfile(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getArLegalAccountingProfile", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_get_ar_legal_accounting_profile.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
        }),
      ),
    )
    .handle("prepareArLegalIssue", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.prepareArLegalIssue(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveArLegalIssue", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.approveArLegalIssue(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeArLegalIssue", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.executeArLegalIssue(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getArLegalIssueReview", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_get_ar_legal_issue_review.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
        }),
      ),
    )
    .handle("getArLegalIssue", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_get_ar_legal_issue.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
        }),
      ),
    )
    .handle("arLegalIssueHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_ar_legal_issue_history.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
        }),
      ),
    ),
);
