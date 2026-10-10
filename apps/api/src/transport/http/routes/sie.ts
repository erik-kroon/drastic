import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { SieOperations } from "../../../application/operations/sie";
import { operationHandlers } from "../operation-handlers";

export const SieHandlers = HttpApiBuilder.group(Api, "sie", (handlers) =>
  handlers.handleAll(operationHandlers(SieOperations)),
);
