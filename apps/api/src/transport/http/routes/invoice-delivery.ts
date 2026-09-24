import { Api } from "@open-erp/contracts/api";
import * as Delivery from "@open-erp/contracts/invoice-delivery";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const InvoiceDeliveryHandlers = HttpApiBuilder.group(Api, "invoiceDeliveries", (handlers) =>
  handlers
    .handle("prepareInvoiceDelivery", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "prepareInvoiceDelivery",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Delivery.InvoiceDeliveryView,
        ),
      ),
    )
    .handle("approveInvoiceDelivery", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "approveInvoiceDelivery",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          Delivery.InvoiceDeliveryView,
        ),
      ),
    )
    .handle("startInvoiceDeliverySimulation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "startInvoiceDeliverySimulation",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          Delivery.InvoiceDeliveryView,
        ),
      ),
    )
    .handle("resolveInvoiceDeliverySimulation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "resolveInvoiceDeliverySimulation",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          Delivery.InvoiceDeliveryView,
        ),
      ),
    )
    .handle("getInvoiceDelivery", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "getInvoiceDelivery",
          [token, scopeParameter(params), params.id],
          Delivery.InvoiceDeliveryView,
        ),
      ),
    )
    .handle("invoiceDeliveryHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "invoiceDeliveryHistory",
          [token, scopeParameter(params), params.id],
          Delivery.InvoiceDeliveryHistory,
        ),
      ),
    ),
);
