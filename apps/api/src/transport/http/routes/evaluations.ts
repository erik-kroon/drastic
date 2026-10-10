import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { EvaluationOperations } from "../../../application/operations/evaluations";
import { operationHandlers } from "../operation-handlers";

export const EvaluationHandlers = HttpApiBuilder.group(Api, "evaluations", (handlers) =>
  handlers.handleAll(operationHandlers(EvaluationOperations)),
);
