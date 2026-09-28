import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  approveAssessment,
  approveRoundingBridge,
  executeAssessment,
  executeRoundingBridge,
  getVatAssessmentStatus,
  prepareAssessment,
  prepareRoundingBridge,
  vatAssessmentHistory,
} from "../../../application/vat/assessment";

export const VatAssessmentHandlers = HttpApiBuilder.group(Api, "vatAssessment", (handlers) =>
  handlers
    .handle("prepareRoundingBridge", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareRoundingBridge(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveRoundingBridge", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        approveRoundingBridge(token, {
          scope: scopeFromPath(params),
          bridgeId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeRoundingBridge", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        executeRoundingBridge(token, {
          scope: scopeFromPath(params),
          bridgeId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("prepareAssessment", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareAssessment(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveAssessment", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        approveAssessment(token, {
          scope: scopeFromPath(params),
          assessmentId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeAssessment", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        executeAssessment(token, {
          scope: scopeFromPath(params),
          assessmentId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getVatAssessmentStatus", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getVatAssessmentStatus(token, { scope: scopeFromPath(params), returnId: params.id }),
      ),
    )
    .handle("vatAssessmentHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        vatAssessmentHistory(token, { scope: scopeFromPath(params), returnId: params.id }),
      ),
    ),
);
