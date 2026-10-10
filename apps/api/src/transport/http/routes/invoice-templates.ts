import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { InvoiceTemplateOperations } from "../../../application/operations/invoice-templates";
import { operationHandlers } from "../operation-handlers";

export const InvoiceTemplateHandlers = HttpApiBuilder.group(Api, "invoiceTemplates", (handlers) =>
  handlers.handleAll(operationHandlers(InvoiceTemplateOperations)),
);
