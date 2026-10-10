import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { LegalDeliveryOperations } from "../../../application/operations/legal-delivery";
import { operationHandlers } from "../operation-handlers";

export const LegalDeliveryHandlers = HttpApiBuilder.group(Api, "legalDeliveries", (handlers) =>
  handlers.handleAll(operationHandlers(LegalDeliveryOperations)),
);
