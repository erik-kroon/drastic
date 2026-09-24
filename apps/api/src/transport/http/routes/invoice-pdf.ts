import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  prepareInvoicePdf,
  getInvoicePdf,
  invoicePdfHistory,
  resumeInvoicePdf,
} from "../../../application/invoice-pdf";

export const InvoicePdfHandlers = HttpApiBuilder.group(Api, "invoicePdfs", (handlers) =>
  handlers
    .handle("prepareInvoicePdf", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareInvoicePdf(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getInvoicePdf", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getInvoicePdf(token, { scope: params, id: params.id }),
      ),
    )
    .handle("resumeInvoicePdf", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        resumeInvoicePdf(token, { scope: params, id: params.id }),
      ),
    )
    .handle("invoicePdfHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        invoicePdfHistory(token, { scope: params, id: params.id }),
      ),
    ),
);
