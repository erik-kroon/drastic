import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import * as Commerce from "../../../application/commerce/invoice-lifecycle";

export const InvoiceIssuanceHandlers = HttpApiBuilder.group(Api, "invoiceIssuance", (handlers) =>
  handlers
    .handle("prepareInvoiceIssue", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.prepareInvoiceIssue(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveInvoiceIssue", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.approveInvoiceIssue(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeInvoiceIssue", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.executeInvoiceIssue(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getInvoiceIssueReview", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_get_invoice_issue_review.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
        }),
      ),
    )
    .handle("invoiceIssueHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_invoice_issue_history.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
        }),
      ),
    ),
);
