import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { CashFlowOperations } from "../../../application/operations/cash-flow";
import { operationHandlers } from "../operation-handlers";

export const CashFlowHandlers = HttpApiBuilder.group(Api, "cashFlow", (handlers) =>
  handlers.handleAll(operationHandlers(CashFlowOperations)),
);
