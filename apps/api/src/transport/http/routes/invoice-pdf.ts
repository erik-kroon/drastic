import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { InvoicePdfOperations } from "../../../application/operations/invoice-pdf";
import { operationHandlers } from "../operation-handlers";

export const InvoicePdfHandlers = HttpApiBuilder.group(Api, "invoicePdfs", (handlers) =>
  handlers.handleAll(operationHandlers(InvoicePdfOperations)),
);
