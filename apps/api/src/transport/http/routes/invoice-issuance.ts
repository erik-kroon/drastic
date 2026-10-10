import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { InvoiceIssuanceOperations } from "../../../application/operations/invoice-issuance";
import { operationHandlers } from "../operation-handlers";

export const InvoiceIssuanceHandlers = HttpApiBuilder.group(Api, "invoiceIssuance", (handlers) =>
  handlers.handleAll(operationHandlers(InvoiceIssuanceOperations)),
);
