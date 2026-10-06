import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Owner from "../../../application/payroll/mileage-corrections";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const MileageCorrectionHandlers = HttpApiBuilder.group(
  Api,
  "mileageCorrections",
  (handlers) =>
    handlers
      .handle("prepareMileageCorrection", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.prepareMileageCorrection(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("reviewMileageCorrection", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.reviewMileageCorrection(token, {
            scope: scopeFromPath(params),
            proposalId: params.proposalId,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("submitMileageCorrection", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.submitMileageCorrection(token, {
            scope: scopeFromPath(params),
            proposalId: params.proposalId,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("cancelMileageCorrection", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.cancelMileageCorrection(token, {
            scope: scopeFromPath(params),
            proposalId: params.proposalId,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getMileageCorrection", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.getMileageCorrection(token, {
            scope: scopeFromPath(params),
            proposalId: params.proposalId,
          }),
        ),
      )
      .handle("listMileageCorrections", ({ params, query }) =>
        Effect.flatMap(authenticate, (token) =>
          Owner.listMileageCorrections(token, { scope: scopeFromPath(params), input: query }),
        ),
      ),
);
