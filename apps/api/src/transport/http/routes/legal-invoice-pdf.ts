import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Commerce from "../../../application/commerce/documents";

export const LegalInvoicePdfHandlers = HttpApiBuilder.group(Api, "legalInvoicePdfs", (handlers) =>
  handlers
    .handle("prepareLegalInvoicePdf", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.prepareLegalInvoicePdf(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getLegalInvoicePdf", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.getLegalInvoicePdf(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("resumeLegalInvoicePdf", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.resumeLegalInvoicePdf(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("legalInvoicePdfHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.legalInvoicePdfHistory(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    ),
);
