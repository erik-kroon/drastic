import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { CommerceFxOperations } from "../../../application/operations/commerce-fx";
import { operationHandlers } from "../operation-handlers";

export const CommerceFxHandlers = HttpApiBuilder.group(Api, "commerceFx", (handlers) =>
  handlers.handleAll(operationHandlers(CommerceFxOperations)),
);
