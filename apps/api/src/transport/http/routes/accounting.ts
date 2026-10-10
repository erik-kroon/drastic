import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { AccountingOperations } from "../../../application/operations/accounting";
import { operationHandlers } from "../operation-handlers";

export const AccountingHandlers = HttpApiBuilder.group(Api, "accounting", (handlers) =>
  handlers.handleAll(operationHandlers(AccountingOperations)),
);
