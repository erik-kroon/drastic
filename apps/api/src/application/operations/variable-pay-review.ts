import { Api } from "@open-erp/contracts/api";

import * as Owner from "../payroll/variable-pay";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation } from "../capabilities/http-operation";

export const VariablePayReviewOperations = {
  listVariablePayAssessments: defineHttpOperation(
    Api.groups.variablePayReview.endpoints.listVariablePayAssessments,
    (token, { params, query }) =>
      Owner.listVariablePayAssessments(token, {
        scope: scopeFromPath(params),
        ...query,
      }),
  ),
  getVariablePayAssessment: defineHttpOperation(
    Api.groups.variablePayReview.endpoints.getVariablePayAssessment,
    (token, { params }) =>
      Owner.getVariablePayAssessment(token, {
        scope: scopeFromPath(params),
        assessmentId: params.assessmentId,
      }),
  ),
  disposeVariablePay: defineHttpOperation(
    Api.groups.variablePayReview.endpoints.disposeVariablePay,
    (token, { params, headers, payload }) =>
      Owner.disposeVariablePay(token, {
        scope: scopeFromPath(params),
        assessmentId: params.assessmentId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  selectVariablePay: defineHttpOperation(
    Api.groups.variablePayReview.endpoints.selectVariablePay,
    (token, { params, headers, payload }) =>
      Owner.selectVariablePay(token, {
        scope: scopeFromPath(params),
        assessmentId: params.assessmentId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  assessVariablePay: defineHttpOperation(
    Api.groups.variablePayReview.endpoints.assessVariablePay,
    (token, { params, headers, payload }) =>
      Owner.assessVariablePay(token, {
        scope: scopeFromPath(params),
        inputId: params.inputId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
