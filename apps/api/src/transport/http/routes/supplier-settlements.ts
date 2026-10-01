import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";
import {
  prepareSupplierSettlement,
  getSupplierSettlement,
  executeSupplierSettlement,
  getSupplierSettlementReceipt,
  prepareSupplierSettlementCancellation,
  executeSupplierSettlementCancellation,
  approveSupplierSettlementCancellation,
  approveSupplierSettlement,
  revokeSupplierSettlementApproval,
} from "../../../application/purchases/supplier-settlements";

export const SupplierSettlementHandlers = HttpApiBuilder.group(
  Api,
  "supplierSettlements",
  (handlers) =>
    handlers
      .handle("prepareSupplierSettlement", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          prepareSupplierSettlement(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getSupplierSettlement", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          getSupplierSettlement(token, { scope: scopeFromPath(params), planId: params.id }),
        ),
      )
      .handle("approveSupplierSettlement", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          approveSupplierSettlement(token, {
            scope: scopeFromPath(params),
            planId: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("revokeSupplierSettlementApproval", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          revokeSupplierSettlementApproval(token, {
            scope: scopeFromPath(params),
            approvalId: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("executeSupplierSettlement", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          executeSupplierSettlement(token, {
            scope: scopeFromPath(params),
            planId: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getSupplierSettlementReceipt", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          getSupplierSettlementReceipt(token, {
            scope: scopeFromPath(params),
            receiptId: params.id,
          }),
        ),
      )
      .handle("prepareSupplierSettlementCancellation", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          prepareSupplierSettlementCancellation(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("executeSupplierSettlementCancellation", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          executeSupplierSettlementCancellation(token, {
            scope: scopeFromPath(params),
            planId: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("approveSupplierSettlementCancellation", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          approveSupplierSettlementCancellation(token, {
            scope: scopeFromPath(params),
            planId: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      ),
);
