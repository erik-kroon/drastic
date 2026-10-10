import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { DecisionQuestionOperations } from "../../../application/operations/decision-questions";
import { operationHandlers } from "../operation-handlers";

export const DecisionQuestionHandlers = HttpApiBuilder.group(Api, "decisionQuestions", (handlers) =>
  handlers.handleAll(operationHandlers(DecisionQuestionOperations)),
);
