import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { SupplierInboxOperations } from "../../../application/operations/supplier-inbox";
import { operationHandlers } from "../operation-handlers";

export const SupplierInboxHandlers = HttpApiBuilder.group(Api, "supplierInbox", (handlers) =>
  handlers.handleAll(operationHandlers(SupplierInboxOperations)),
);
