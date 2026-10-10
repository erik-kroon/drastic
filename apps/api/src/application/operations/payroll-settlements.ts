import { Api } from "@open-erp/contracts/api";

import * as Owner from "../payroll/settlements";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation } from "../capabilities/http-operation";

export const PayrollSettlementOperations = {
  getPayrollPeriod: defineHttpOperation(
    Api.groups.payrollSettlement.endpoints.getPayrollPeriod,
    (token, { params }) =>
      Owner.getPeriod(token, { scope: scopeFromPath(params), periodId: params.periodId }),
  ),
  getPayrollSettlement: defineHttpOperation(
    Api.groups.payrollSettlement.endpoints.getPayrollSettlement,
    (token, { params }) =>
      Owner.getSettlement(token, { scope: scopeFromPath(params), reviewId: params.reviewId }),
  ),
  preparePayrollPeriod: defineHttpOperation(
    Api.groups.payrollSettlement.endpoints.preparePayrollPeriod,
    (token, { params, headers, payload }) =>
      Owner.preparePeriod(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  recordPayrollAdjustmentBasis: defineHttpOperation(
    Api.groups.payrollSettlement.endpoints.recordPayrollAdjustmentBasis,
    (token, { params, headers, payload }) =>
      Owner.recordAdjustmentBasis(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  preparePayrollComparison: defineHttpOperation(
    Api.groups.payrollSettlement.endpoints.preparePayrollComparison,
    (token, { params, headers, payload }) =>
      Owner.prepareComparison(token, {
        scope: scopeFromPath(params),
        paidEventId: params.paidEventId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  executePayrollSettlement: defineHttpOperation(
    Api.groups.payrollSettlement.endpoints.executePayrollSettlement,
    (token, { params, headers, payload }) =>
      Owner.executeSettlement(token, {
        scope: scopeFromPath(params),
        reviewId: params.reviewId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approvePayrollSettlement: defineHttpOperation(
    Api.groups.payrollSettlement.endpoints.approvePayrollSettlement,
    (token, { params, headers, payload }) =>
      Owner.approveSettlement(token, {
        scope: scopeFromPath(params),
        reviewId: params.reviewId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  preparePayrollSettlement: defineHttpOperation(
    Api.groups.payrollSettlement.endpoints.preparePayrollSettlement,
    (token, { params, headers, payload }) =>
      Owner.prepareSettlement(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  cancelPayrollAdjustmentInstruction: defineHttpOperation(
    Api.groups.payrollSettlement.endpoints.cancelPayrollAdjustmentInstruction,
    (token, { params, headers, payload }) =>
      Owner.cancelAdjustmentInstruction(token, {
        scope: scopeFromPath(params),
        instructionId: params.instructionId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
