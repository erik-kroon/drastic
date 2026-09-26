import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import * as Commerce from "../../../application/commerce/invoice-lifecycle";

export const InvoiceDraftHandlers = HttpApiBuilder.group(Api, "invoiceDrafts", (handlers) =>
  handlers
    .handle("salesRegister", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_sales_register.execute(token, {
          scope: scopeFromPath(params),
          ...query,
        }),
      ),
    )
    .handle("createInvoiceDraft", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.createInvoiceDraft(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("reviseInvoiceDraft", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.reviseInvoiceDraft(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getInvoiceDraft", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.getInvoiceDraft(token, {
          scope: scopeFromPath(params),
          id: params.id,
          revision: query.revision,
        }),
      ),
    )
    .handle("listInvoiceDrafts", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.listInvoiceDrafts(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("invoiceDraftHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.invoiceDraftHistory(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    ),
);
