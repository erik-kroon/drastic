import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { PaymentIdentifierOperations } from "../../../application/operations/payment-identifiers";
import { operationHandlers } from "../operation-handlers";

export const PaymentIdentifierHandlers = HttpApiBuilder.group(
  Api,
  "paymentIdentifiers",
  (handlers) => handlers.handleAll(operationHandlers(PaymentIdentifierOperations)),
);
