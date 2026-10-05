import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Owner from "../../../application/payroll/settlements";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const PayrollSettlementHandlers = HttpApiBuilder.group(
  Api,
  "payrollSettlement",
  (handlers) =>
    handlers
      .handle("preparePayrollSettlement", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.prepareSettlement(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("approvePayrollSettlement", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.approveSettlement(token, {
            scope: scopeFromPath(params),
            reviewId: params.reviewId,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("executePayrollSettlement", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.executeSettlement(token, {
            scope: scopeFromPath(params),
            reviewId: params.reviewId,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("preparePayrollComparison", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.prepareComparison(token, {
            scope: scopeFromPath(params),
            paidEventId: params.paidEventId,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("recordPayrollAdjustmentBasis", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.recordAdjustmentBasis(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("preparePayrollPeriod", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.preparePeriod(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getPayrollSettlement", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.getSettlement(token, { scope: scopeFromPath(params), reviewId: params.reviewId }),
        ),
      )
      .handle("getPayrollPeriod", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.getPeriod(token, { scope: scopeFromPath(params), periodId: params.periodId }),
        ),
      ),
);
