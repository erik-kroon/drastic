import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { VariablePayReviewOperations } from "../../../application/operations/variable-pay-review";
import { operationHandlers } from "../operation-handlers";

export const VariablePayReviewHandlers = HttpApiBuilder.group(
  Api,
  "variablePayReview",
  (handlers) => handlers.handleAll(operationHandlers(VariablePayReviewOperations)),
);
