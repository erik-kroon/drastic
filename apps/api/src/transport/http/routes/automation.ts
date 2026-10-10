import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { AutomationOperations } from "../../../application/operations/automation";
import { operationHandlers } from "../operation-handlers";

export const AutomationHandlers = HttpApiBuilder.group(Api, "automation", (handlers) =>
  handlers.handleAll(operationHandlers(AutomationOperations)),
);
