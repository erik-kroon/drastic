import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { ServicePurchaseOperations } from "../../../application/operations/service-purchases";
import { operationHandlers } from "../operation-handlers";

export const ServicePurchaseHandlers = HttpApiBuilder.group(Api, "servicePurchases", (handlers) =>
  handlers.handleAll(operationHandlers(ServicePurchaseOperations)),
);
