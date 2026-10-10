import { Api } from "@open-erp/contracts/api";

import * as Owner from "../payroll/inputs";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation } from "../capabilities/http-operation";

export const PayrollInputOperations = {
  getPayrollInput: defineHttpOperation(
    Api.groups.payrollInput.endpoints.getPayrollInput,
    (token, { params }) =>
      Owner.getInput(token, { scope: scopeFromPath(params), inputId: params.inputId }),
  ),
  executePayrollInput: defineHttpOperation(
    Api.groups.payrollInput.endpoints.executePayrollInput,
    (token, { params, headers, payload }) =>
      Owner.executeInput(token, {
        scope: scopeFromPath(params),
        reviewId: params.reviewId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approvePayrollInput: defineHttpOperation(
    Api.groups.payrollInput.endpoints.approvePayrollInput,
    (token, { params, headers, payload }) =>
      Owner.approveInput(token, {
        scope: scopeFromPath(params),
        reviewId: params.reviewId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  preparePayrollInputPayment: defineHttpOperation(
    Api.groups.payrollInput.endpoints.preparePayrollInputPayment,
    (token, { params, headers, payload }) =>
      Owner.prepareDirectPayment(token, {
        scope: scopeFromPath(params),
        inputId: params.inputId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  reviewPayrollInput: defineHttpOperation(
    Api.groups.payrollInput.endpoints.reviewPayrollInput,
    (token, { params, headers, payload }) =>
      Owner.reviewInput(token, {
        scope: scopeFromPath(params),
        inputId: params.inputId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  submitPayrollInput: defineHttpOperation(
    Api.groups.payrollInput.endpoints.submitPayrollInput,
    (token, { params, headers, payload }) =>
      Owner.submitInput(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
