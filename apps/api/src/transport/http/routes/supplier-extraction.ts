import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { SupplierExtractionOperations } from "../../../application/operations/supplier-extraction";
import { operationHandlers } from "../operation-handlers";

export const SupplierExtractionHandlers = HttpApiBuilder.group(
  Api,
  "supplierExtraction",
  (handlers) => handlers.handleAll(operationHandlers(SupplierExtractionOperations)),
);
