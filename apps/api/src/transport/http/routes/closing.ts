import { Api } from "@open-erp/contracts/api";
import * as Closing from "@open-erp/contracts/closing";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import { query, scopeParameter } from "../../../db/query";

export const ClosingHandlers = HttpApiBuilder.group(Api, "closing", (handlers) =>
  handlers
    .handle("listClosingProposals", ({ params, query: cursor }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.periods_list_closing_proposals.execute(token, {
          scope: params,
          periodId: params.periodId,
          after: cursor.after,
        }),
      ),
    )
    .handle("declareClosingInventory", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "declareClosingInventory",
          [
            token,
            scopeParameter(params),
            params.periodId,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          Closing.ClosingInventory,
        ),
      ),
    )
    .handle("closingReadiness", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.periods_closing_readiness.execute(token, {
          scope: params,
          periodId: params.periodId,
        }),
      ),
    )
    .handle("prepareClosing", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.periods_prepare_closing.execute(token, {
          scope: params,
          periodId: params.periodId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getClosingProposal", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.periods_get_closing_proposal.execute(token, {
          scope: params,
          proposalId: params.id,
        }),
      ),
    )
    .handle("approveClosing", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "approveClosing",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          Closing.ClosingApproval,
        ),
      ),
    )
    .handle("executeClosing", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.periods_execute_closing.execute(token, {
          scope: params,
          proposalId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("closingHistory", ({ params, query: cursor }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.periods_closing_history.execute(token, {
          scope: params,
          periodId: params.periodId,
          after: cursor.after,
        }),
      ),
    )
    .handle("getClosingCertificate", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.periods_get_closing_certificate.execute(token, {
          scope: params,
          certificateId: params.id,
        }),
      ),
    ),
);
