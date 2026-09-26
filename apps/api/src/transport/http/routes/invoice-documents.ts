import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Commerce from "../../../application/commerce/documents";

export const InvoiceDocumentHandlers = HttpApiBuilder.group(Api, "invoiceDocuments", (handlers) =>
  handlers
    .handle("prepareInvoiceDocument", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.prepareInvoiceDocument(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getInvoiceDocument", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.getInvoiceDocument(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("resumeInvoiceDocument", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.resumeInvoiceDocument(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("invoiceDocumentHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.invoiceDocumentHistory(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    ),
);
