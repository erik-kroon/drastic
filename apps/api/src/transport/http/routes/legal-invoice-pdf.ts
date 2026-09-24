import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { getLegalInvoicePdf, legalInvoicePdfHistory, prepareLegalInvoicePdf, resumeLegalInvoicePdf } from "../../../application/legal-invoice-pdf";

export const LegalInvoicePdfHandlers = HttpApiBuilder.group(Api, "legalInvoicePdfs", (handlers) =>
  handlers
    .handle("prepareLegalInvoicePdf", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) => prepareLegalInvoicePdf(token, {
        scope: params, idempotencyKey: headers["idempotency-key"], input: payload,
      })),
    )
    .handle("getLegalInvoicePdf", ({ params }) =>
      Effect.flatMap(authenticate, (token) => getLegalInvoicePdf(token, { scope: params, id: params.id })),
    )
    .handle("resumeLegalInvoicePdf", ({ params }) =>
      Effect.flatMap(authenticate, (token) => resumeLegalInvoicePdf(token, { scope: params, id: params.id })),
    )
    .handle("legalInvoicePdfHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) => legalInvoicePdfHistory(token, { scope: params, id: params.id })),
    ),
);
