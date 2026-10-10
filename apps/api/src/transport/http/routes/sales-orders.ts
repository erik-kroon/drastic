import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { SalesOrderOperations } from "../../../application/operations/sales-orders";
import { operationHandlers } from "../operation-handlers";

export const SalesOrderHandlers = HttpApiBuilder.group(Api, "salesOrders", (handlers) =>
  handlers.handleAll(operationHandlers(SalesOrderOperations)),
);
