import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";
import {
  captureClosePredicate,
  getClosePredicate,
} from "../../../application/automation/verification-coverage";

export const CoverageHandlers = HttpApiBuilder.group(Api, "verificationCoverage", (handlers) =>
  handlers
    .handle("captureClosePredicate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        captureClosePredicate(token, {
          scope: scopeFromPath(params),
          periodId: params.periodId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getClosePredicate", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        getClosePredicate(token, {
          scope: scopeFromPath(params),
          periodId: params.periodId,
          captureId: query.captureId,
        }),
      ),
    ),
);
