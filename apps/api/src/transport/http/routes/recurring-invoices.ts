import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { RecurringInvoiceOperations } from "../../../application/operations/recurring-invoices";
import { operationHandlers } from "../operation-handlers";

export const RecurringInvoiceHandlers = HttpApiBuilder.group(Api, "recurringInvoices", (handlers) =>
  handlers.handleAll(operationHandlers(RecurringInvoiceOperations)),
);
