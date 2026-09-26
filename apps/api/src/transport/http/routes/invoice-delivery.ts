import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Commerce from "../../../application/commerce/invoice-delivery";

export const InvoiceDeliveryHandlers = HttpApiBuilder.group(Api, "invoiceDeliveries", (handlers) =>
  handlers
    .handle("prepareInvoiceDelivery", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.prepareDelivery(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveInvoiceDelivery", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.approveDelivery(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("startInvoiceDeliverySimulation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.startSimulation(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("resolveInvoiceDeliverySimulation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.resolveSimulation(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getInvoiceDelivery", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.getDelivery(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("invoiceDeliveryHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.readDeliveryHistory(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    ),
);
