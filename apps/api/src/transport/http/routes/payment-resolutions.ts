import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { PaymentResolutionOperations } from "../../../application/operations/payment-resolutions";
import { operationHandlers } from "../operation-handlers";

export const PaymentResolutionHandlers = HttpApiBuilder.group(
  Api,
  "paymentResolutions",
  (handlers) => handlers.handleAll(operationHandlers(PaymentResolutionOperations)),
);
