import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { BankConnectorOperations } from "../../../application/operations/bank-connector";
import { operationHandlers } from "../operation-handlers";

export const BankConnectorHandlers = HttpApiBuilder.group(Api, "bankConnector", (handlers) =>
  handlers.handleAll(operationHandlers(BankConnectorOperations)),
);
