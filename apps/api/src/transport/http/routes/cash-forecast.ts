import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { CashForecastOperations } from "../../../application/operations/cash-forecast";
import { operationHandlers } from "../operation-handlers";

export const CashForecastHandlers = HttpApiBuilder.group(Api, "cashForecast", (handlers) =>
  handlers.handleAll(operationHandlers(CashForecastOperations)),
);
