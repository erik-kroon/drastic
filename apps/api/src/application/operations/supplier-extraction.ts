import { capabilities } from "../capabilities";
import { Api } from "@open-erp/contracts/api";
import { scopeFromPath } from "../operation-scope";
import {
  cancelSupplierExtraction,
  commitSupplierExtractionReview,
  requestSupplierExtraction,
  studySupplierExtractionDiagnostics,
} from "../purchases/extraction";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const SupplierExtractionOperations = {
  commitSupplierExtractionReview: defineHttpOperation(
    Api.groups.supplierExtraction.endpoints.commitSupplierExtractionReview,
    (token, { params, headers, payload }) =>
      commitSupplierExtractionReview(token, {
        scope: scopeFromPath(params),
        occurrenceId: params.id,
        requestId: params.requestId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareSupplierExtractionReview: bindHttpOperation(
    Api.groups.supplierExtraction.endpoints.prepareSupplierExtractionReview,
    capabilities.supplier_inbox_extraction_review_preparation,
    ({ params, payload }) => ({
      scope: scopeFromPath(params),
      occurrenceId: params.id,
      requestId: params.requestId,
      attemptId: payload.attemptId,
    }),
  ),
  getSupplierExtractionState: bindHttpOperation(
    Api.groups.supplierExtraction.endpoints.getSupplierExtractionState,
    capabilities.supplier_inbox_extraction_state,
    ({ params }) => ({
      scope: scopeFromPath(params),
      occurrenceId: params.id,
    }),
  ),
  cancelSupplierExtraction: defineHttpOperation(
    Api.groups.supplierExtraction.endpoints.cancelSupplierExtraction,
    (token, { params, headers, payload }) =>
      cancelSupplierExtraction(token, {
        scope: scopeFromPath(params),
        occurrenceId: params.id,
        requestId: params.requestId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  requestSupplierExtraction: defineHttpOperation(
    Api.groups.supplierExtraction.endpoints.requestSupplierExtraction,
    (token, { params, headers, payload }) =>
      requestSupplierExtraction(token, {
        scope: scopeFromPath(params),
        occurrenceId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  studySupplierExtractionDiagnostics: defineHttpOperation(
    Api.groups.supplierExtraction.endpoints.studySupplierExtractionDiagnostics,
    (token, { params, headers, payload }) =>
      studySupplierExtractionDiagnostics(token, {
        scope: scopeFromPath(params),
        occurrenceId: params.id,
        requestId: params.requestId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
