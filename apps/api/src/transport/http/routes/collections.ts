import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { CollectionsOperations } from "../../../application/operations/collections";
import { operationHandlers } from "../operation-handlers";

export const CollectionsHandlers = HttpApiBuilder.group(Api, "collections", (handlers) =>
  handlers.handleAll(operationHandlers(CollectionsOperations)),
);
