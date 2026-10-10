import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";
import { getDecisionQuestionCatalog } from "../../../application/automation/decision-questions";

export const DecisionQuestionHandlers = HttpApiBuilder.group(Api, "decisionQuestions", (handlers) =>
  handlers.handle("getDecisionQuestionCatalog", ({ params }) =>
    Effect.flatMap(authenticate, (token) =>
      getDecisionQuestionCatalog(token, { scope: scopeFromPath(params) }),
    ),
  ),
);
