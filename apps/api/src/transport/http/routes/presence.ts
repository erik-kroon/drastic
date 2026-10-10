import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { PresenceOperations } from "../../../application/operations/presence";
import { operationHandlers } from "../operation-handlers";

export const PresenceHandlers = HttpApiBuilder.group(Api, "presence", (handlers) =>
  handlers.handleAll(operationHandlers(PresenceOperations)),
);
