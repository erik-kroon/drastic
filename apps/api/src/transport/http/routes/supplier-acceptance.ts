import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  approveSupplierAcceptance,
  executeSupplierAcceptance,
  getSupplierAcceptanceReview,
  prepareSupplierAcceptance,
  supplierAcceptanceHistory,
} from "../../../application/purchases/acceptance";

export const SupplierAcceptanceHandlers = HttpApiBuilder.group(
  Api,
  "supplierAcceptance",
  (handlers) =>
    handlers
      .handle("prepareSupplierAcceptance", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          prepareSupplierAcceptance(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("approveSupplierAcceptance", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          approveSupplierAcceptance(token, {
            scope: scopeFromPath(params),
            reviewId: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("executeSupplierAcceptance", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          executeSupplierAcceptance(token, {
            scope: scopeFromPath(params),
            reviewId: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getSupplierAcceptanceReview", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          getSupplierAcceptanceReview(token, { scope: scopeFromPath(params), reviewId: params.id }),
        ),
      )
      .handle("supplierAcceptanceHistory", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          supplierAcceptanceHistory(token, { scope: scopeFromPath(params), draftId: params.id }),
        ),
      ),
);
