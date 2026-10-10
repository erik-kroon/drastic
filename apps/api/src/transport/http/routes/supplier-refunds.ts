import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { SupplierRefundOperations } from "../../../application/operations/supplier-refunds";
import { operationHandlers } from "../operation-handlers";

export const SupplierRefundHandlers = HttpApiBuilder.group(Api, "supplierRefunds", (handlers) =>
  handlers.handleAll(operationHandlers(SupplierRefundOperations)),
);
