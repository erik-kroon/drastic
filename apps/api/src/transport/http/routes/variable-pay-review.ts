import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Owner from "../../../application/payroll/variable-pay";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const VariablePayReviewHandlers = HttpApiBuilder.group(
  Api,
  "variablePayReview",
  (handlers) =>
    handlers
      .handle("assessVariablePay", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.assessVariablePay(token, {
            scope: scopeFromPath(params),
            inputId: params.inputId,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("selectVariablePay", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.selectVariablePay(token, {
            scope: scopeFromPath(params),
            assessmentId: params.assessmentId,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("disposeVariablePay", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.disposeVariablePay(token, {
            scope: scopeFromPath(params),
            assessmentId: params.assessmentId,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getVariablePayAssessment", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.getVariablePayAssessment(token, {
            scope: scopeFromPath(params),
            assessmentId: params.assessmentId,
          }),
        ),
      )
      .handle("listVariablePayAssessments", ({ params, query }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.listVariablePayAssessments(token, {
            scope: scopeFromPath(params),
            ...query,
          }),
        ),
      ),
);
