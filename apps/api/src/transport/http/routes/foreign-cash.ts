import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { ForeignCashOperations } from "../../../application/operations/foreign-cash";
import { operationHandlers } from "../operation-handlers";

export const ForeignCashHandlers = HttpApiBuilder.group(Api, "foreignCash", (handlers) =>
  handlers.handleAll(operationHandlers(ForeignCashOperations)),
);
