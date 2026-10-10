import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { BankSignoffOperations } from "../../../application/operations/bank-signoffs";
import { operationHandlers } from "../operation-handlers";

export const BankSignoffHandlers = HttpApiBuilder.group(Api, "bankSignoffs", (handlers) =>
  handlers.handleAll(operationHandlers(BankSignoffOperations)),
);
