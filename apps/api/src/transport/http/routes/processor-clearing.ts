import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { ProcessorClearingOperations } from "../../../application/operations/processor-clearing";
import { operationHandlers } from "../operation-handlers";

export const ProcessorClearingHandlers = HttpApiBuilder.group(
  Api,
  "processorClearing",
  (handlers) => handlers.handleAll(operationHandlers(ProcessorClearingOperations)),
);
