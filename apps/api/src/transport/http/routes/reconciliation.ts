import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { ReconciliationOperations } from "../../../application/operations/reconciliation";
import { operationHandlers } from "../operation-handlers";

export const ReconciliationHandlers = HttpApiBuilder.group(Api, "reconciliation", (handlers) =>
  handlers.handleAll(operationHandlers(ReconciliationOperations)),
);
