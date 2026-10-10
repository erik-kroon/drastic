import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { BankSyncWindowsOperations } from "../../../application/operations/bank-sync-windows";
import { operationHandlers } from "../operation-handlers";

export const BankSyncWindowsHandlers = HttpApiBuilder.group(Api, "bankSyncWindows", (handlers) =>
  handlers.handleAll(operationHandlers(BankSyncWindowsOperations)),
);
