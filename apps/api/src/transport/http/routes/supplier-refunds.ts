import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import {
  approvePaidSupplierCredit,
  approveSupplierRefund,
  executePaidSupplierCredit,
  executeSupplierRefund,
  getPaidSupplierCreditReview,
  getSupplierRefundPosition,
  getSupplierRefundReview,
  preparePaidSupplierCredit,
  prepareSupplierRefund,
  supplierRefundHistory,
} from "../../../application/purchases/refunds";

export const SupplierRefundHandlers = HttpApiBuilder.group(Api, "supplierRefunds", (handlers) =>
  handlers
    .handle("preparePaidSupplierCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        preparePaidSupplierCredit(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approvePaidSupplierCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        approvePaidSupplierCredit(token, {
          scope: scopeFromPath(params),
          reviewId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executePaidSupplierCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        executePaidSupplierCredit(token, {
          scope: scopeFromPath(params),
          reviewId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getPaidSupplierCreditReview", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getPaidSupplierCreditReview(token, { scope: scopeFromPath(params), reviewId: params.id }),
      ),
    )
    .handle("prepareSupplierRefund", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareSupplierRefund(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveSupplierRefund", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        approveSupplierRefund(token, {
          scope: scopeFromPath(params),
          reviewId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeSupplierRefund", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        executeSupplierRefund(token, {
          scope: scopeFromPath(params),
          reviewId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getSupplierRefundReview", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getSupplierRefundReview(token, { scope: scopeFromPath(params), reviewId: params.id }),
      ),
    )
    .handle("getSupplierRefundPosition", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getSupplierRefundPosition(token, { scope: scopeFromPath(params), invoiceId: params.id }),
      ),
    )
    .handle("supplierRefundHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        supplierRefundHistory(token, { scope: scopeFromPath(params), invoiceId: params.id }),
      ),
    ),
);
