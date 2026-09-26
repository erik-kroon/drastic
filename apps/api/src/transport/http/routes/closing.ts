import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Inventories from "../../../application/closing/inventories";
import * as Proposals from "../../../application/closing/proposals";

export const ClosingHandlers = HttpApiBuilder.group(Api, "closing", (handlers) =>
  handlers
    .handle("listClosingProposals", ({ params, query: cursor }) =>
      Effect.flatMap(authenticate, (token) =>
        Proposals.listClosingProposals(token, {
          scope: scopeFromPath(params),
          periodId: params.periodId,
          after: cursor.after,
        }),
      ),
    )
    .handle("declareClosingInventory", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Inventories.declareInventory(token, {
          scope: scopeFromPath(params),
          periodId: params.periodId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("closingReadiness", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Proposals.closingReadiness(token, {
          scope: scopeFromPath(params),
          periodId: params.periodId,
        }),
      ),
    )
    .handle("prepareClosing", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Proposals.prepareClosing(token, {
          scope: scopeFromPath(params),
          periodId: params.periodId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getClosingProposal", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Proposals.getClosingProposal(token, {
          scope: scopeFromPath(params),
          proposalId: params.id,
        }),
      ),
    )
    .handle("approveClosing", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Inventories.approveProposal(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeClosing", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Proposals.executeClosing(token, {
          scope: scopeFromPath(params),
          proposalId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("closingHistory", ({ params, query: cursor }) =>
      Effect.flatMap(authenticate, (token) =>
        Proposals.closingHistory(token, {
          scope: scopeFromPath(params),
          periodId: params.periodId,
          after: cursor.after,
        }),
      ),
    )
    .handle("getClosingCertificate", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Proposals.getClosingCertificate(token, {
          scope: scopeFromPath(params),
          certificateId: params.id,
        }),
      ),
    ),
);
