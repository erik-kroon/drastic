import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { BankInventorySignoffOperations } from "../../../application/operations/bank-inventory-signoffs";
import { operationHandlers } from "../operation-handlers";

export const BankInventorySignoffHandlers = HttpApiBuilder.group(
  Api,
  "bankInventorySignoffs",
  (handlers) => handlers.handleAll(operationHandlers(BankInventorySignoffOperations)),
);
