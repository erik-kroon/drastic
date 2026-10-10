import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { WorkspaceOperations } from "../../../application/operations/workspace";
import { operationHandlers } from "../operation-handlers";

export const WorkspaceHandlers = HttpApiBuilder.group(Api, "workspace", (handlers) =>
  handlers.handleAll(operationHandlers(WorkspaceOperations)),
);
