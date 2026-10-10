import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { OwnerOperationOperations } from "../../../application/operations/owner-operations";
import { operationHandlers } from "../operation-handlers";

export const OwnerOperationHandlers = HttpApiBuilder.group(Api, "ownerOperations", (handlers) =>
  handlers.handleAll(operationHandlers(OwnerOperationOperations)),
);
