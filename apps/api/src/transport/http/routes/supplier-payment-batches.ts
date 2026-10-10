import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { SupplierPaymentBatchOperations } from "../../../application/operations/supplier-payment-batches";
import { operationHandlers } from "../operation-handlers";

export const SupplierPaymentBatchHandlers = HttpApiBuilder.group(
  Api,
  "supplierPaymentBatches",
  (handlers) => handlers.handleAll(operationHandlers(SupplierPaymentBatchOperations)),
);
