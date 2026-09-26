import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  approveSupplierCredit,
  executeSupplierCredit,
  getSupplierCreditReview,
  prepareSupplierCredit,
  supplierCreditHistory,
} from "../../../application/purchases/credits";

export const SupplierCreditHandlers = HttpApiBuilder.group(Api, "supplierCredits", (handlers) =>
  handlers
    .handle("prepareSupplierCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareSupplierCredit(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveSupplierCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        approveSupplierCredit(token, {
          scope: scopeFromPath(params),
          reviewId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeSupplierCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        executeSupplierCredit(token, {
          scope: scopeFromPath(params),
          reviewId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getSupplierCreditReview", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getSupplierCreditReview(token, { scope: scopeFromPath(params), reviewId: params.id }),
      ),
    )
    .handle("supplierCreditHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        supplierCreditHistory(token, { scope: scopeFromPath(params), invoiceId: params.id }),
      ),
    ),
);
