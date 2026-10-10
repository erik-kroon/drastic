import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { saveDimension, saveDimensionValue } from "../dimensions/registry";

import { applyDimensionRestatement, prepareDimensionRestatement } from "../dimensions/restatement";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const DimensionOperations = {
  saveDimensionValue: defineHttpOperation(
    Api.groups.dimensions.endpoints.saveDimensionValue,
    (token, { params, headers, payload }) =>
      saveDimensionValue(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  saveDimension: defineHttpOperation(
    Api.groups.dimensions.endpoints.saveDimension,
    (token, { params, headers, payload }) =>
      saveDimension(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  restatementView: bindHttpOperation(
    Api.groups.dimensions.endpoints.restatementView,
    capabilities.dimensions_restatement_view,
    ({ params, payload }) => ({ scope: scopeFromPath(params), input: payload }),
  ),
  classificationView: bindHttpOperation(
    Api.groups.dimensions.endpoints.classificationView,
    capabilities.dimensions_classification_view,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      input: {
        voucherId: params.voucherId,
        lineId: params.lineId,
        mode: query.mode,
        classificationCutoff: query.classificationCutoff,
      },
    }),
  ),
  applyRestatement: defineHttpOperation(
    Api.groups.dimensions.endpoints.applyRestatement,
    (token, { params, headers, payload }) =>
      applyDimensionRestatement(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        planId: params.id,
        input: payload,
      }),
  ),
  prepareRestatement: defineHttpOperation(
    Api.groups.dimensions.endpoints.prepareRestatement,
    (token, { params, headers, payload }) =>
      prepareDimensionRestatement(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  assignmentReport: bindHttpOperation(
    Api.groups.dimensions.endpoints.assignmentReport,
    capabilities.dimensions_assignment_report,
    ({ params, payload }) => ({ scope: scopeFromPath(params), input: payload }),
  ),
  listDimensions: bindHttpOperation(
    Api.groups.dimensions.endpoints.listDimensions,
    capabilities.dimensions_list,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
};
