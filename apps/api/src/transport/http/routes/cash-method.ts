import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { CashMethodOperations } from "../../../application/operations/cash-method";
import { operationHandlers } from "../operation-handlers";

export const CashMethodHandlers = HttpApiBuilder.group(Api, "cashMethod", (handlers) =>
  handlers.handleAll(operationHandlers(CashMethodOperations)),
);
