import { Api } from "@open-erp/contracts/api";

import * as Owner from "../payroll/employee-claims";
import * as Payments from "../payroll/employee-claim-payments";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation } from "../capabilities/http-operation";

export const EmployeeClaimOperations = {
  approveClaimSettlement: defineHttpOperation(
    Api.groups.employeeClaims.endpoints.approveClaimSettlement,
    (token, { params, headers, payload }) =>
      Payments.approveClaimSettlement(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
        id: params.id,
      }),
  ),
  prepareClaimSettlement: defineHttpOperation(
    Api.groups.employeeClaims.endpoints.prepareClaimSettlement,
    (token, { params, headers, payload }) =>
      Payments.prepareClaimSettlement(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
        instructionId: params.instructionId,
      }),
  ),
  approveClaimPaymentFile: defineHttpOperation(
    Api.groups.employeeClaims.endpoints.approveClaimPaymentFile,
    (token, { params, headers, payload }) =>
      Payments.approveClaimPaymentFile(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
        id: params.id,
      }),
  ),
  prepareClaimPaymentFile: defineHttpOperation(
    Api.groups.employeeClaims.endpoints.prepareClaimPaymentFile,
    (token, { params, headers, payload }) =>
      Payments.prepareClaimPaymentFile(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
        instructionId: params.instructionId,
      }),
  ),
  verifyEmployeePayee: defineHttpOperation(
    Api.groups.employeeClaims.endpoints.verifyEmployeePayee,
    (token, { params, headers, payload }) =>
      Payments.verifyEmployeePayee(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
        id: params.id,
      }),
  ),
  proposeEmployeePayee: defineHttpOperation(
    Api.groups.employeeClaims.endpoints.proposeEmployeePayee,
    (token, { params, headers, payload }) =>
      Payments.proposeEmployeePayee(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  requestClaimCompletion: defineHttpOperation(
    Api.groups.employeeClaims.endpoints.requestClaimCompletion,
    (token, { params, headers, payload }) =>
      Owner.requestClaimCompletion(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
        claimId: params.claimId,
      }),
  ),
  approveEmployeeClaim: defineHttpOperation(
    Api.groups.employeeClaims.endpoints.approveEmployeeClaim,
    (token, { params, headers, payload }) =>
      Owner.approveEmployeeClaim(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
        reviewId: params.reviewId,
      }),
  ),
  reviewEmployeeClaim: defineHttpOperation(
    Api.groups.employeeClaims.endpoints.reviewEmployeeClaim,
    (token, { params, headers, payload }) =>
      Owner.reviewEmployeeClaim(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
        claimId: params.claimId,
      }),
  ),
  reviseEmployeeClaim: defineHttpOperation(
    Api.groups.employeeClaims.endpoints.reviseEmployeeClaim,
    (token, { params, headers, payload }) =>
      Owner.reviseEmployeeClaim(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
        claimId: params.claimId,
      }),
  ),
  getEmployeeClaim: defineHttpOperation(
    Api.groups.employeeClaims.endpoints.getEmployeeClaim,
    (token, { params }) =>
      Owner.getEmployeeClaim(token, { scope: scopeFromPath(params), claimId: params.claimId }),
  ),
  listEmployeeClaims: defineHttpOperation(
    Api.groups.employeeClaims.endpoints.listEmployeeClaims,
    (token, { params, query }) =>
      Owner.listEmployeeClaims(token, { scope: scopeFromPath(params), after: query.after }),
  ),
  submitEmployeeClaim: defineHttpOperation(
    Api.groups.employeeClaims.endpoints.submitEmployeeClaim,
    (token, { params, headers, payload }) =>
      Owner.submitEmployeeClaim(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
