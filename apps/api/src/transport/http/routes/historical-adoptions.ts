import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { HistoricalAdoptionsOperations } from "../../../application/operations/historical-adoptions";
import { operationHandlers } from "../operation-handlers";

export const HistoricalAdoptionsHandlers = HttpApiBuilder.group(
  Api,
  "historicalAdoptions",
  (handlers) => handlers.handleAll(operationHandlers(HistoricalAdoptionsOperations)),
);
