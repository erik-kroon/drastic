import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { InvoiceDeliveryOperations } from "../../../application/operations/invoice-delivery";
import { operationHandlers } from "../operation-handlers";

export const InvoiceDeliveryHandlers = HttpApiBuilder.group(Api, "invoiceDeliveries", (handlers) =>
  handlers.handleAll(operationHandlers(InvoiceDeliveryOperations)),
);
