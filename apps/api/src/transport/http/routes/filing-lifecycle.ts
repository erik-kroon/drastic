import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { FilingLifecycleOperations } from "../../../application/operations/filing-lifecycle";
import { operationHandlers } from "../operation-handlers";

export const FilingLifecycleHandlers = HttpApiBuilder.group(Api, "filingLifecycle", (handlers) =>
  handlers.handleAll(operationHandlers(FilingLifecycleOperations)),
);
