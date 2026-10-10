import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { SubledgerOperations } from "../../../application/operations/subledgers";
import { operationHandlers } from "../operation-handlers";

export const SubledgerHandlers = HttpApiBuilder.group(Api, "subledgers", (handlers) =>
  handlers.handleAll(operationHandlers(SubledgerOperations)),
);
