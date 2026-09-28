import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  listDimensions,
  saveDimension,
  saveDimensionValue,
} from "../../../application/dimensions/registry";
import { dimensionAssignmentReport } from "../../../application/dimensions/assignments";
import {
  applyDimensionRestatement,
  dimensionClassificationView,
  prepareDimensionRestatement,
} from "../../../application/dimensions/restatement";

export const DimensionHandlers = HttpApiBuilder.group(Api, "dimensions", (handlers) =>
  handlers
    .handle("listDimensions", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        listDimensions(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("assignmentReport", ({ params, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        dimensionAssignmentReport(token, { scope: scopeFromPath(params), input: payload }),
      ),
    )
    .handle("prepareRestatement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareDimensionRestatement(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("applyRestatement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        applyDimensionRestatement(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          planId: params.id,
          input: payload,
        }),
      ),
    )
    .handle("classificationView", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        dimensionClassificationView(token, {
          scope: scopeFromPath(params),
          input: {
            voucherId: params.voucherId,
            lineId: params.lineId,
            mode: query.mode,
            classificationCutoff: query.classificationCutoff,
          },
        }),
      ),
    )
    .handle("saveDimension", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        saveDimension(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("saveDimensionValue", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        saveDimensionValue(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
