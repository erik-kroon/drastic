import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { CustomerCreditOperations } from "../../../application/operations/customer-credit-notes";
import { operationHandlers } from "../operation-handlers";

export const CustomerCreditHandlers = HttpApiBuilder.group(Api, "customerCreditNotes", (handlers) =>
  handlers.handleAll(operationHandlers(CustomerCreditOperations)),
);
