import { Api } from "@open-erp/contracts/api";
import * as Issuance from "@open-erp/contracts/invoice-issuance";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import { query, scopeParameter } from "../../../db/query";

export const InvoiceIssuanceHandlers = HttpApiBuilder.group(Api, "invoiceIssuance", (handlers) =>
  handlers
    .handle("prepareInvoiceIssue", ({ params, headers, payload }) =>
      Effect.gen(function* () {
        const token = yield* authenticate;
        return yield* query(
          "prepareInvoiceIssue",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Issuance.InvoiceIssueReview,
        );
      }),
    )
    .handle("approveInvoiceIssue", ({ params, headers, payload }) =>
      Effect.gen(function* () {
        const token = yield* authenticate;
        return yield* query(
          "approveInvoiceIssue",
          [token, scopeParameter(params), params.id, headers["idempotency-key"], JSON.stringify(payload)],
          Issuance.InvoiceIssueApproval,
        );
      }),
    )
    .handle("executeInvoiceIssue", ({ params, headers, payload }) =>
      Effect.gen(function* () {
        const token = yield* authenticate;
        return yield* query(
          "executeInvoiceIssue",
          [token, scopeParameter(params), params.id, headers["idempotency-key"], JSON.stringify(payload)],
          Issuance.InvoiceIssueReceipt,
        );
      }),
    )
    .handle("getInvoiceIssueReview", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_get_invoice_issue_review.execute(token, { scope: params, id: params.id }),
      ),
    )
    .handle("invoiceIssueHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_invoice_issue_history.execute(token, { scope: params, id: params.id }),
      ),
    ),
);
