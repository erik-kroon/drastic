import { Api } from "@open-erp/contracts/api";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import { query, scopeParameter } from "../../../db/query";

export const ArLegalIssueHandlers = HttpApiBuilder.group(Api, "arLegalIssue", (handlers) =>
  handlers
    .handle("activateArLegalAccountingProfile", ({ params, headers, payload }) =>
      Effect.gen(function* () {
        const token = yield* authenticate;
        return yield* query(
          "activateArLegalAccountingProfile",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Ar.ArLegalAccountingProfile,
        );
      }),
    )
    .handle("getArLegalAccountingProfile", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_get_ar_legal_accounting_profile.execute(token, {
          scope: params,
          id: params.id,
        }),
      ),
    )
    .handle("prepareArLegalIssue", ({ params, headers, payload }) =>
      Effect.gen(function* () {
        const token = yield* authenticate;
        return yield* query(
          "prepareArLegalIssue",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Ar.ArLegalIssueReview,
        );
      }),
    )
    .handle("approveArLegalIssue", ({ params, headers, payload }) =>
      Effect.gen(function* () {
        const token = yield* authenticate;
        return yield* query(
          "approveArLegalIssue",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          Ar.ArLegalIssueApproval,
        );
      }),
    )
    .handle("executeArLegalIssue", ({ params, headers, payload }) =>
      Effect.gen(function* () {
        const token = yield* authenticate;
        return yield* query(
          "executeArLegalIssue",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          Ar.ArLegalIssueReceipt,
        );
      }),
    )
    .handle("getArLegalIssueReview", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_get_ar_legal_issue_review.execute(token, {
          scope: params,
          id: params.id,
        }),
      ),
    )
    .handle("getArLegalIssue", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_get_ar_legal_issue.execute(token, { scope: params, id: params.id }),
      ),
    )
    .handle("arLegalIssueHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_ar_legal_issue_history.execute(token, {
          scope: params,
          id: params.id,
        }),
      ),
    ),
);
