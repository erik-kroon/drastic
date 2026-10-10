import { Api } from "@open-erp/contracts/api";

import * as Owner from "../payroll/mileage-corrections";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation } from "../capabilities/http-operation";

export const MileageCorrectionOperations = {
  listMileageCorrections: defineHttpOperation(
    Api.groups.mileageCorrections.endpoints.listMileageCorrections,
    (token, { params, query }) =>
      Owner.listMileageCorrections(token, { scope: scopeFromPath(params), input: query }),
  ),
  getMileageCorrection: defineHttpOperation(
    Api.groups.mileageCorrections.endpoints.getMileageCorrection,
    (token, { params }) =>
      Owner.getMileageCorrection(token, {
        scope: scopeFromPath(params),
        proposalId: params.proposalId,
      }),
  ),
  cancelMileageCorrection: defineHttpOperation(
    Api.groups.mileageCorrections.endpoints.cancelMileageCorrection,
    (token, { params, headers, payload }) =>
      Owner.cancelMileageCorrection(token, {
        scope: scopeFromPath(params),
        proposalId: params.proposalId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  submitMileageCorrection: defineHttpOperation(
    Api.groups.mileageCorrections.endpoints.submitMileageCorrection,
    (token, { params, headers, payload }) =>
      Owner.submitMileageCorrection(token, {
        scope: scopeFromPath(params),
        proposalId: params.proposalId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  reviewMileageCorrection: defineHttpOperation(
    Api.groups.mileageCorrections.endpoints.reviewMileageCorrection,
    (token, { params, headers, payload }) =>
      Owner.reviewMileageCorrection(token, {
        scope: scopeFromPath(params),
        proposalId: params.proposalId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareMileageCorrection: defineHttpOperation(
    Api.groups.mileageCorrections.endpoints.prepareMileageCorrection,
    (token, { params, headers, payload }) =>
      Owner.prepareMileageCorrection(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
