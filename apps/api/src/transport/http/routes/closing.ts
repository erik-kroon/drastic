import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { ClosingOperations } from "../../../application/operations/closing";
import { operationHandlers } from "../operation-handlers";

export const ClosingHandlers = HttpApiBuilder.group(Api, "closing", (handlers) =>
  handlers.handleAll(operationHandlers(ClosingOperations)),
);
