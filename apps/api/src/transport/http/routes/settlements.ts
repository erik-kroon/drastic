import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { SettlementOperations } from "../../../application/operations/settlements";
import { operationHandlers } from "../operation-handlers";

export const SettlementHandlers = HttpApiBuilder.group(Api, "settlements", (handlers) =>
  handlers.handleAll(operationHandlers(SettlementOperations)),
);
