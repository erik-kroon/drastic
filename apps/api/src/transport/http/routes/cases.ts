import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { CaseOperations } from "../../../application/operations/cases";
import { operationHandlers } from "../operation-handlers";

export const CaseHandlers = HttpApiBuilder.group(Api, "cases", (handlers) =>
  handlers.handleAll(operationHandlers(CaseOperations)),
);
