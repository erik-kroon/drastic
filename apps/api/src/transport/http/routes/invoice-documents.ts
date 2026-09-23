import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { prepareInvoiceDocument, getInvoiceDocument, invoiceDocumentHistory, resumeInvoiceDocument } from "../../../application/invoice-documents";

export const InvoiceDocumentHandlers = HttpApiBuilder.group(Api, "invoiceDocuments", (handlers) =>
  handlers
    .handle("prepareInvoiceDocument", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) => prepareInvoiceDocument(token, {
        scope: params, idempotencyKey: headers["idempotency-key"], input: payload,
      })),
    )
    .handle("getInvoiceDocument", ({ params }) =>
      Effect.flatMap(authenticate, (token) => getInvoiceDocument(token, { scope: params, id: params.id })),
    )
    .handle("resumeInvoiceDocument", ({ params }) =>
      Effect.flatMap(authenticate, (token) => resumeInvoiceDocument(token, { scope: params, id: params.id })),
    )
    .handle("invoiceDocumentHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) => invoiceDocumentHistory(token, { scope: params, id: params.id })),
    ),
);
