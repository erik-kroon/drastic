import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { PrepaymentsOperations } from "../../../application/operations/prepayments";
import { operationHandlers } from "../operation-handlers";

export const PrepaymentsHandlers = HttpApiBuilder.group(Api, "prepayments", (handlers) =>
  handlers.handleAll(operationHandlers(PrepaymentsOperations)),
);
