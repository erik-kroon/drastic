import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";
import {
  sealDecisionExamples,
  getDecisionExamples,
} from "../../../application/automation/decision-examples";

export const DecisionExampleHandlers = HttpApiBuilder.group(Api, "decisionExamples", (handlers) =>
  handlers
    .handle("sealDecisionExamples", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        sealDecisionExamples(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getDecisionExamples", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getDecisionExamples(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    ),
);
