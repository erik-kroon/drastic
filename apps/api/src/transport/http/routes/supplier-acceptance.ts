import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { SupplierAcceptanceOperations } from "../../../application/operations/supplier-acceptance";
import { operationHandlers } from "../operation-handlers";

export const SupplierAcceptanceHandlers = HttpApiBuilder.group(
  Api,
  "supplierAcceptance",
  (handlers) => handlers.handleAll(operationHandlers(SupplierAcceptanceOperations)),
);
