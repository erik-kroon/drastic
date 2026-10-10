import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { PurchaseRecognitionOperations } from "../../../application/operations/purchase-recognition";
import { operationHandlers } from "../operation-handlers";

export const PurchaseRecognitionHandlers = HttpApiBuilder.group(
  Api,
  "purchaseRecognition",
  (handlers) => handlers.handleAll(operationHandlers(PurchaseRecognitionOperations)),
);
