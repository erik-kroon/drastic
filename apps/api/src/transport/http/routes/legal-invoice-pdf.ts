import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { LegalInvoicePdfOperations } from "../../../application/operations/legal-invoice-pdf";
import { operationHandlers } from "../operation-handlers";

export const LegalInvoicePdfHandlers = HttpApiBuilder.group(Api, "legalInvoicePdfs", (handlers) =>
  handlers.handleAll(operationHandlers(LegalInvoicePdfOperations)),
);
