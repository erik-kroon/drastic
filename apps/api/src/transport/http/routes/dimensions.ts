import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { DimensionOperations } from "../../../application/operations/dimensions";
import { operationHandlers } from "../operation-handlers";

export const DimensionHandlers = HttpApiBuilder.group(Api, "dimensions", (handlers) =>
  handlers.handleAll(operationHandlers(DimensionOperations)),
);
