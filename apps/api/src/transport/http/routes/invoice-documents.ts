import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { InvoiceDocumentOperations } from "../../../application/operations/invoice-documents";
import { operationHandlers } from "../operation-handlers";

export const InvoiceDocumentHandlers = HttpApiBuilder.group(Api, "invoiceDocuments", (handlers) =>
  handlers.handleAll(operationHandlers(InvoiceDocumentOperations)),
);
