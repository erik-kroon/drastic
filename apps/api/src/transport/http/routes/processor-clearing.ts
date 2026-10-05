import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Owner from "../../../application/banking/processor-clearing";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const ProcessorClearingHandlers = HttpApiBuilder.group(
  Api,
  "processorClearing",
  (handlers) =>
    handlers
      .handle("registerProcessorNativeCredit", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.registerProcessorNativeCredit(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("registerProcessorAccount", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.registerProcessorAccount(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getProcessorAccount", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.getProcessorAccount(token, scopeFromPath(params), params.id),
        ),
      )
      .handle("fetchProcessorObservations", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.fetchProcessorObservations(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            accountId: params.id,
            input: payload,
          }),
        ),
      )
      .handle("getProcessorFetch", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.getProcessorFetch(token, scopeFromPath(params), params.id),
        ),
      )
      .handle("prepareProcessorClearing", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.prepareProcessorClearing(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getProcessorReview", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.getProcessorReview(token, scopeFromPath(params), params.id),
        ),
      )
      .handle("approveProcessorClearing", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.approveProcessorClearing(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            reviewId: params.id,
            input: payload,
          }),
        ),
      )
      .handle("executeProcessorClearing", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.executeProcessorClearing(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            reviewId: params.id,
            input: payload,
          }),
        ),
      )
      .handle("reconcileProcessorClearing", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.reconcileProcessorClearing(token, scopeFromPath(params), params.id, params.fetchId),
        ),
      ),
);
