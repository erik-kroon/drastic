import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Commerce from "../../../application/commerce/legal";

export const LegalDeliveryHandlers = HttpApiBuilder.group(Api, "legalDeliveries", (handlers) =>
  handlers
    .handle("prepareLegalDelivery", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.prepareLegalDelivery(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveLegalDelivery", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.approveLegalDelivery(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("startLegalDeliveryAttempt", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.startLegalDeliveryAttempt(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("reconcileLegalDeliveryAttempt", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.reconcileLegalDeliveryAttempt(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getLegalDelivery", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.getLegalDelivery(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("legalDeliveryHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.readLegalDeliveryHistory(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    ),
);
