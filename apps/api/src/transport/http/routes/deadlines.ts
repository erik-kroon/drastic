import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { DeadlineOperations } from "../../../application/operations/deadlines";
import { operationHandlers } from "../operation-handlers";

export const DeadlineHandlers = HttpApiBuilder.group(Api, "deadlines", (handlers) =>
  handlers.handleAll(operationHandlers(DeadlineOperations)),
);
