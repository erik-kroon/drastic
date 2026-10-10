import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { CommerceOperations } from "../../../application/operations/commerce";
import { operationHandlers } from "../operation-handlers";

export const CommerceHandlers = HttpApiBuilder.group(Api, "commerce", (handlers) =>
  handlers.handleAll(operationHandlers(CommerceOperations)),
);
