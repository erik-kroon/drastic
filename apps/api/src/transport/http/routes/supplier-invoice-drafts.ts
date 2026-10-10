import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { SupplierInvoiceDraftOperations } from "../../../application/operations/supplier-invoice-drafts";
import { operationHandlers } from "../operation-handlers";

export const SupplierInvoiceDraftHandlers = HttpApiBuilder.group(
  Api,
  "supplierInvoiceDrafts",
  (handlers) => handlers.handleAll(operationHandlers(SupplierInvoiceDraftOperations)),
);
