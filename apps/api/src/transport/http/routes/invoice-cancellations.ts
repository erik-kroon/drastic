import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { InvoiceCancellationOperations } from "../../../application/operations/invoice-cancellations";
import { operationHandlers } from "../operation-handlers";

export const InvoiceCancellationHandlers = HttpApiBuilder.group(
  Api,
  "invoiceCancellations",
  (handlers) => handlers.handleAll(operationHandlers(InvoiceCancellationOperations)),
);
