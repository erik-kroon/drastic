import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Evaluations from "../../../application/evaluations";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const EvaluationHandlers = HttpApiBuilder.group(Api, "evaluations", (handlers) =>
  handlers
    .handle("captureEvaluationContract", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Evaluations.captureEvaluationContract(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getEvaluationContract", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Evaluations.getEvaluationContract(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    ),
);
