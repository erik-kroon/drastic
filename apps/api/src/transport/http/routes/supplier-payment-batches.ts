import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  exportSupplierPaymentBatch,
  getSupplierPayee,
  getSupplierPaymentBatch,
  listSupplierPaymentEligibility,
  prepareSupplierPaymentBatch,
  proposeSupplierPayee,
  reportSupplierPaymentOutcome,
  verifySupplierPayee,
} from "../../../application/purchases/payments";

export const SupplierPaymentBatchHandlers = HttpApiBuilder.group(
  Api,
  "supplierPaymentBatches",
  (handlers) =>
    handlers
      .handle("prepareSupplierPaymentBatch", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          prepareSupplierPaymentBatch(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("exportSupplierPaymentBatch", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          exportSupplierPaymentBatch(token, {
            scope: scopeFromPath(params),
            previewId: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("listSupplierPaymentEligibility", ({ params, query: search }) =>
        Effect.flatMap(authenticate, (token) =>
          listSupplierPaymentEligibility(token, {
            scope: scopeFromPath(params),
            after: search.after,
          }),
        ),
      )
      .handle("proposeSupplierPayee", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          proposeSupplierPayee(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getSupplierPayee", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          getSupplierPayee(token, { scope: scopeFromPath(params), proposalId: params.id }),
        ),
      )
      .handle("verifySupplierPayee", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          verifySupplierPayee(token, {
            scope: scopeFromPath(params),
            proposalId: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("reportSupplierPaymentOutcome", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          reportSupplierPaymentOutcome(token, {
            scope: scopeFromPath(params),
            exportId: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getSupplierPaymentBatch", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          getSupplierPaymentBatch(token, { scope: scopeFromPath(params), previewId: params.id }),
        ),
      ),
);
