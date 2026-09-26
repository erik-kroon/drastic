import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Deadlines from "../../../application/closing/deadlines";
import { linkFulfillment, listFulfillments } from "../../../application/closing/fulfillment";

export const DeadlineHandlers = HttpApiBuilder.group(Api, "deadlines", (handlers) =>
  handlers
    .handle("listDeadlines", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Deadlines.listObligations(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("listDeadlineFulfillments", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        listFulfillments(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("saveDeadline", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Deadlines.saveObligation(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          expectedRevision: payload.expectedRevision,
          input: payload.input,
        }),
      ),
    )
    .handle("deadlineActivity", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Deadlines.recordActivity(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          action: payload.action,
        }),
      ),
    )
    .handle("linkDeadlineFulfillment", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        linkFulfillment(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          reference: payload.reference,
        }),
      ),
    )
    .handle("createDeadlineFeed", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Deadlines.createFeed(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("revokeDeadlineFeed", ({ params, headers }) =>
      Effect.flatMap(authenticate, (token) =>
        Deadlines.revokeFeed(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
        }),
      ),
    ),
);
