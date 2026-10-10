import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { DecisionExampleOperations } from "../../../application/operations/decision-examples";
import { operationHandlers } from "../operation-handlers";

export const DecisionExampleHandlers = HttpApiBuilder.group(Api, "decisionExamples", (handlers) =>
  handlers.handleAll(operationHandlers(DecisionExampleOperations)),
);
