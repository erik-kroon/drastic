import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { SupplierCreditOperations } from "../../../application/operations/supplier-credits";
import { operationHandlers } from "../operation-handlers";

export const SupplierCreditHandlers = HttpApiBuilder.group(Api, "supplierCredits", (handlers) =>
  handlers.handleAll(operationHandlers(SupplierCreditOperations)),
);
