import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { PeppolExchangeOperations } from "../../../application/operations/peppol-exchange";
import { operationHandlers } from "../operation-handlers";

export const PeppolExchangeHandlers = HttpApiBuilder.group(Api, "peppolExchange", (handlers) =>
  handlers.handleAll(operationHandlers(PeppolExchangeOperations)),
);
