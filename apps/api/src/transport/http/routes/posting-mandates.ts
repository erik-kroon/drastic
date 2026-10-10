import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import * as Mandates from "../../../application/purchases/posting-mandates";

const scopeOf = (params: { readonly entityId: string; readonly bookId: string }) => ({
  entityId: params.entityId,
  bookId: params.bookId,
});

export const PostingMandateHandlers = HttpApiBuilder.group(Api, "postingMandates", (handlers) =>
  handlers
    .handle("grantPostingMandate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Mandates.grantPostingMandate(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("revokePostingMandate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Mandates.revokePostingMandate(token, {
          scope: scopeOf(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getPostingMandate", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Mandates.getPostingMandate(token, { scope: scopeOf(params), id: params.id }),
      ),
    )
    .handle("listPostingMandates", ({ params }) =>
      Effect.flatMap(authenticate, (token) => Mandates.listPostingMandates(token, params)),
    )
    .handle("executeSupplierAcceptanceUnderMandate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Mandates.executeSupplierAcceptanceUnderMandate(token, {
          scope: scopeOf(params),
          reviewId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
