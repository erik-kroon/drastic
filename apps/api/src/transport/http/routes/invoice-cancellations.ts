import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import * as Commerce from "../../../application/commerce/invoice-lifecycle";

export const InvoiceCancellationHandlers = HttpApiBuilder.group(
  Api,
  "invoiceCancellations",
  (handlers) =>
    handlers
      .handle("prepareInvoiceCancellation", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Commerce.prepareInvoiceCancellation(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("approveInvoiceCancellation", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Commerce.approveInvoiceCancellation(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("executeInvoiceCancellation", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Commerce.executeInvoiceCancellation(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("revokeInvoiceCancellationApproval", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Commerce.revokeInvoiceCancellationApproval(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getInvoiceCancellation", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          capabilities.commerce_get_invoice_cancellation.execute(token, {
            scope: scopeFromPath(params),
            id: params.id,
          }),
        ),
      )
      .handle("getInvoiceCancellationStatus", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          capabilities.commerce_get_invoice_cancellation_status.execute(token, {
            scope: scopeFromPath(params),
            id: params.id,
          }),
        ),
      ),
);
