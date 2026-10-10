import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { ExchangeRatesOperations } from "../../../application/operations/exchange-rates";
import { operationHandlers } from "../operation-handlers";

export const ExchangeRatesHandlers = HttpApiBuilder.group(Api, "exchangeRates", (handlers) =>
  handlers.handleAll(operationHandlers(ExchangeRatesOperations)),
);
