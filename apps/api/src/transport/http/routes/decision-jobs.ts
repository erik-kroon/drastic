import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";
import {
  admitDecisionRequest,
  getDecisionRequest,
  processDecisionRequest,
} from "../../../application/automation/decision-jobs";

export const DecisionJobHandlers = HttpApiBuilder.group(Api, "decisionJobs", (handlers) =>
  handlers
    .handle("admitDecisionRequest", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        admitDecisionRequest(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getDecisionRequest", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getDecisionRequest(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("processDecisionRequest", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        processDecisionRequest(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    ),
);
