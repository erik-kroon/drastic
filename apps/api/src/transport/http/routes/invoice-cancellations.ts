import { Api } from "@open-erp/contracts/api";
import * as Cancellation from "@open-erp/contracts/invoice-cancellations";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import { query, scopeParameter } from "../../../db/query";

export const InvoiceCancellationHandlers = HttpApiBuilder.group(Api, "invoiceCancellations", (handlers) =>
  handlers
    .handle("prepareInvoiceCancellation", ({ params, headers, payload }) =>
      Effect.gen(function* () {
        const token = yield* authenticate;
        return yield* query("prepareInvoiceCancellation", [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)], Cancellation.InvoiceCancellationReview);
      }),
    )
    .handle("approveInvoiceCancellation", ({ params, headers, payload }) =>
      Effect.gen(function* () {
        const token = yield* authenticate;
        return yield* query("approveInvoiceCancellation", [token, scopeParameter(params), params.id, headers["idempotency-key"], JSON.stringify(payload)], Cancellation.InvoiceCancellationApproval);
      }),
    )
    .handle("executeInvoiceCancellation", ({ params, headers, payload }) =>
      Effect.gen(function* () {
        const token = yield* authenticate;
        return yield* query("executeInvoiceCancellation", [token, scopeParameter(params), params.id, headers["idempotency-key"], JSON.stringify(payload)], Cancellation.InvoiceCancellationReceipt);
      }),
    )
    .handle("revokeInvoiceCancellationApproval", ({ params, headers, payload }) =>
      Effect.gen(function* () {
        const token = yield* authenticate;
        return yield* query("revokeInvoiceCancellationApproval", [token, scopeParameter(params), params.id, headers["idempotency-key"], JSON.stringify(payload)], Cancellation.InvoiceCancellationRevocation);
      }),
    )
    .handle("getInvoiceCancellation", ({ params }) =>
      Effect.flatMap(authenticate, (token) => capabilities.commerce_get_invoice_cancellation.execute(token, { scope: params, id: params.id })),
    )
    .handle("getInvoiceCancellationStatus", ({ params }) =>
      Effect.flatMap(authenticate, (token) => capabilities.commerce_get_invoice_cancellation_status.execute(token, { scope: params, id: params.id })),
    ),
);
