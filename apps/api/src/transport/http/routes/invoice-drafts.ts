import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { InvoiceDraftOperations } from "../../../application/operations/invoice-drafts";
import { operationHandlers } from "../operation-handlers";

export const InvoiceDraftHandlers = HttpApiBuilder.group(Api, "invoiceDrafts", (handlers) =>
  handlers.handleAll(operationHandlers(InvoiceDraftOperations)),
);
