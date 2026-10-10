import { Api } from "@open-erp/contracts/api";

import { scopeFromPath } from "../operation-scope";
import { sealDecisionExamples, getDecisionExamples } from "../automation/decision-examples";

import { defineHttpOperation } from "../capabilities/http-operation";

export const DecisionExampleOperations = {
  getDecisionExamples: defineHttpOperation(
    Api.groups.decisionExamples.endpoints.getDecisionExamples,
    (token, { params }) =>
      getDecisionExamples(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  sealDecisionExamples: defineHttpOperation(
    Api.groups.decisionExamples.endpoints.sealDecisionExamples,
    (token, { params, headers, payload }) =>
      sealDecisionExamples(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
