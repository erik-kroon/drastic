import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { SupplierSettlementOperations } from "../../../application/operations/supplier-settlements";
import { operationHandlers } from "../operation-handlers";

export const SupplierSettlementHandlers = HttpApiBuilder.group(
  Api,
  "supplierSettlements",
  (handlers) => handlers.handleAll(operationHandlers(SupplierSettlementOperations)),
);
