import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Commerce from "../../../application/commerce/documents";

export const InvoicePdfHandlers = HttpApiBuilder.group(Api, "invoicePdfs", (handlers) =>
  handlers
    .handle("prepareInvoicePdf", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.prepareInvoicePdf(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getInvoicePdf", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.getInvoicePdf(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("resumeInvoicePdf", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.resumeInvoicePdf(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("invoicePdfHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.invoicePdfHistory(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    ),
);
