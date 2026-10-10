import { Api } from "@open-erp/contracts/api";

import { scopeFromPath } from "../operation-scope";
import { getDecisionQuestionCatalog } from "../automation/decision-questions";

import { defineHttpOperation } from "../capabilities/http-operation";

export const DecisionQuestionOperations = {
  getDecisionQuestionCatalog: defineHttpOperation(
    Api.groups.decisionQuestions.endpoints.getDecisionQuestionCatalog,
    (token, { params }) => getDecisionQuestionCatalog(token, { scope: scopeFromPath(params) }),
  ),
};
