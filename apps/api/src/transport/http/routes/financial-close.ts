import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { FinancialCloseOperations } from "../../../application/operations/financial-close";
import { operationHandlers } from "../operation-handlers";

export const FinancialCloseHandlers = HttpApiBuilder.group(Api, "financialClose", (handlers) =>
  handlers.handleAll(operationHandlers(FinancialCloseOperations)),
);
