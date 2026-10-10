import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { InvoicePolicyOperations } from "../../../application/operations/invoice-policy";
import { operationHandlers } from "../operation-handlers";

export const InvoicePolicyHandlers = HttpApiBuilder.group(Api, "invoicePolicies", (handlers) =>
  handlers.handleAll(operationHandlers(InvoicePolicyOperations)),
);
