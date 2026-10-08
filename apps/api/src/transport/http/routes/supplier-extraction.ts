import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "@open-erp/contracts/api";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";
import {
  cancelSupplierExtraction,
  commitSupplierExtractionReview,
  getSupplierExtractionState,
  prepareSupplierExtractionReview,
  requestSupplierExtraction,
  studySupplierExtractionDiagnostics,
} from "../../../application/purchases/extraction";

export const SupplierExtractionHandlers = HttpApiBuilder.group(
  Api,
  "supplierExtraction",
  (handlers) =>
    handlers
      .handle("studySupplierExtractionDiagnostics", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          studySupplierExtractionDiagnostics(token, {
            scope: scopeFromPath(params),
            occurrenceId: params.id,
            requestId: params.requestId,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("requestSupplierExtraction", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          requestSupplierExtraction(token, {
            scope: scopeFromPath(params),
            occurrenceId: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("cancelSupplierExtraction", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          cancelSupplierExtraction(token, {
            scope: scopeFromPath(params),
            occurrenceId: params.id,
            requestId: params.requestId,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getSupplierExtractionState", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          getSupplierExtractionState(token, {
            scope: scopeFromPath(params),
            occurrenceId: params.id,
          }),
        ),
      )
      .handle("prepareSupplierExtractionReview", ({ params, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          prepareSupplierExtractionReview(token, {
            scope: scopeFromPath(params),
            occurrenceId: params.id,
            requestId: params.requestId,
            attemptId: payload.attemptId,
          }),
        ),
      )
      .handle("commitSupplierExtractionReview", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          commitSupplierExtractionReview(token, {
            scope: scopeFromPath(params),
            occurrenceId: params.id,
            requestId: params.requestId,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      ),
);
