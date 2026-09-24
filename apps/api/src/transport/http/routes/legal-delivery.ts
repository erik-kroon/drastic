import { Api } from "@open-erp/contracts/api";
import * as Delivery from "@open-erp/contracts/legal-delivery";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const LegalDeliveryHandlers = HttpApiBuilder.group(Api, "legalDeliveries", (handlers) =>
  handlers
    .handle("prepareLegalDelivery", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) => query("prepareLegalDelivery", [token, scopeParameter(params),
        headers["idempotency-key"], JSON.stringify(payload)], Delivery.LegalDeliveryView)),
    )
    .handle("approveLegalDelivery", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) => query("approveLegalDelivery", [token, scopeParameter(params), params.id,
        headers["idempotency-key"], JSON.stringify(payload)], Delivery.LegalDeliveryView)),
    )
    .handle("startLegalDeliveryAttempt", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) => query("startLegalDeliveryAttempt", [token, scopeParameter(params), params.id,
        headers["idempotency-key"], JSON.stringify(payload)], Delivery.LegalDeliveryView)),
    )
    .handle("reconcileLegalDeliveryAttempt", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) => query("reconcileLegalDeliveryAttempt", [token, scopeParameter(params), params.id,
        headers["idempotency-key"], JSON.stringify(payload)], Delivery.LegalDeliveryView)),
    )
    .handle("getLegalDelivery", ({ params }) =>
      Effect.flatMap(authenticate, (token) => query("getLegalDelivery", [token, scopeParameter(params), params.id], Delivery.LegalDeliveryView)),
    )
    .handle("legalDeliveryHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) => query("legalDeliveryHistory", [token, scopeParameter(params), params.id], Delivery.LegalDeliveryHistory)),
    ),
);
