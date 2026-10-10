import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { HistoricalMigrationOperations } from "../../../application/operations/historical-migration";
import { operationHandlers } from "../operation-handlers";

export const HistoricalMigrationHandlers = HttpApiBuilder.group(
  Api,
  "historicalMigration",
  (handlers) => handlers.handleAll(operationHandlers(HistoricalMigrationOperations)),
);
