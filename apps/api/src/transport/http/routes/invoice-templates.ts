import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "@open-erp/contracts/api";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";
import * as Templates from "../../../application/commerce/invoice-templates";

export const InvoiceTemplateHandlers = HttpApiBuilder.group(Api, "invoiceTemplates", (handlers) =>
  handlers
    .handle("listInvoiceTemplates", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Templates.listInvoiceTemplates(token, { scope: scopeFromPath(params), after: query.after }),
      ),
    )
    .handle("getInvoiceTemplate", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Templates.getInvoiceTemplate(token, {
          scope: scopeFromPath(params),
          id: params.id,
          revision: query.revision,
        }),
      ),
    )
    .handle("createInvoiceTemplate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Templates.createInvoiceTemplate(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("reviseInvoiceTemplate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Templates.reviseInvoiceTemplate(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("archiveInvoiceTemplate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Templates.archiveInvoiceTemplate(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("applyInvoiceTemplate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Templates.applyInvoiceTemplate(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
