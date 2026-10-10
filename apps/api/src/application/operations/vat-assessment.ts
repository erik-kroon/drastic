import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import {
  approveAssessment,
  approveRoundingBridge,
  executeAssessment,
  executeRoundingBridge,
  prepareAssessment,
  prepareRoundingBridge,
} from "../vat/assessment";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const VatAssessmentOperations = {
  vatAssessmentHistory: bindHttpOperation(
    Api.groups.vatAssessment.endpoints.vatAssessmentHistory,
    capabilities.vat_assessment_history,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getVatAssessmentStatus: bindHttpOperation(
    Api.groups.vatAssessment.endpoints.getVatAssessmentStatus,
    capabilities.vat_get_assessment_status,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  executeAssessment: defineHttpOperation(
    Api.groups.vatAssessment.endpoints.executeAssessment,
    (token, { params, headers, payload }) =>
      executeAssessment(token, {
        scope: scopeFromPath(params),
        assessmentId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveAssessment: defineHttpOperation(
    Api.groups.vatAssessment.endpoints.approveAssessment,
    (token, { params, headers, payload }) =>
      approveAssessment(token, {
        scope: scopeFromPath(params),
        assessmentId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareAssessment: defineHttpOperation(
    Api.groups.vatAssessment.endpoints.prepareAssessment,
    (token, { params, headers, payload }) =>
      prepareAssessment(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  executeRoundingBridge: defineHttpOperation(
    Api.groups.vatAssessment.endpoints.executeRoundingBridge,
    (token, { params, headers, payload }) =>
      executeRoundingBridge(token, {
        scope: scopeFromPath(params),
        bridgeId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveRoundingBridge: defineHttpOperation(
    Api.groups.vatAssessment.endpoints.approveRoundingBridge,
    (token, { params, headers, payload }) =>
      approveRoundingBridge(token, {
        scope: scopeFromPath(params),
        bridgeId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareRoundingBridge: defineHttpOperation(
    Api.groups.vatAssessment.endpoints.prepareRoundingBridge,
    (token, { params, headers, payload }) =>
      prepareRoundingBridge(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
