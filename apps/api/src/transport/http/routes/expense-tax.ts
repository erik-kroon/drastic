import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { ExpenseTaxOperations } from "../../../application/operations/expense-tax";
import { operationHandlers } from "../operation-handlers";

export const ExpenseTaxHandlers = HttpApiBuilder.group(Api, "expenseTax", (handlers) =>
  handlers.handleAll(operationHandlers(ExpenseTaxOperations)),
);
