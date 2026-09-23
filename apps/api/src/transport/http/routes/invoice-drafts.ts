import { Api } from "@open-erp/contracts/api";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import { query, scopeParameter } from "../../../db/query";

export const InvoiceDraftHandlers = HttpApiBuilder.group(Api, "invoiceDrafts", (handlers) =>
  handlers
    .handle("salesRegister", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_sales_register.execute(token, { scope: params, ...query }),
      ),
    )
    .handle("createInvoiceDraft", ({ params, headers, payload }) =>
      Effect.gen(function* () {
        const token = yield* authenticate;
        return yield* query(
          "createInvoiceDraft",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Drafts.InvoiceDraftRevision,
        );
      }),
    )
    .handle("reviseInvoiceDraft", ({ params, headers, payload }) =>
      Effect.gen(function* () {
        const token = yield* authenticate;
        return yield* query(
          "reviseInvoiceDraft",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          Drafts.InvoiceDraftRevision,
        );
      }),
    )
    .handle("getInvoiceDraft", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_get_invoice_draft.execute(token, {
          scope: params,
          id: params.id,
          revision: query.revision,
        }),
      ),
    )
    .handle("listInvoiceDrafts", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_list_invoice_drafts.execute(token, { scope: params }),
      ),
    )
    .handle("invoiceDraftHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_invoice_draft_history.execute(token, {
          scope: params,
          id: params.id,
        }),
      ),
    ),
);
