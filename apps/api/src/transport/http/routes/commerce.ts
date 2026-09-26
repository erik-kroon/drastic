import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import * as Allocations from "../../../application/commerce/allocation-reversals";

export const CommerceHandlers = HttpApiBuilder.group(Api, "commerce", (handlers) =>
  handlers
    .handle("commerceCreateCounterparty", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_create_counterparty.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("commerceReviseCounterparty", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_revise_counterparty.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
          id: params.id,
        }),
      ),
    )
    .handle("commerceGetCounterparty", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_get_counterparty.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
          revision: query.revision,
        }),
      ),
    )
    .handle("commerceListCounterparties", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_list_counterparties.execute(token, {
          scope: scopeFromPath(params),
          after: query.after,
        }),
      ),
    )
    .handle("commerceSupplierInvoiceDuplicates", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_supplier_invoice_duplicates.execute(token, {
          scope: scopeFromPath(params),
          ...query,
        }),
      ),
    )
    .handle("commerceCreateInvoice", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_create_invoice.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("commerceReviseInvoice", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_revise_invoice.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
          id: params.id,
        }),
      ),
    )
    .handle("commerceGetInvoice", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_get_invoice.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
        }),
      ),
    )
    .handle("commerceInvoicePayments", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_invoice_payments.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
          ...query,
        }),
      ),
    )
    .handle("commerceInvoiceHistory", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_invoice_history.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
          after: query.after,
        }),
      ),
    )
    .handle("commerceListInvoices", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_list_invoices.execute(token, {
          scope: scopeFromPath(params),
          after: query.after,
        }),
      ),
    )
    .handle("commerceGetPaymentCapacity", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_get_payment_capacity.execute(token, {
          scope: scopeFromPath(params),
          voucherId: params.voucherId,
          lineId: params.lineId,
        }),
      ),
    )
    .handle("commercePrepareAllocation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_prepare_allocation.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("commerceGetAllocation", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_get_allocation.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
        }),
      ),
    )
    .handle("commerceApproveAllocation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Allocations.approveAllocation(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("commerceApplyAllocation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_apply_allocation.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
          id: params.id,
        }),
      ),
    ),
);
