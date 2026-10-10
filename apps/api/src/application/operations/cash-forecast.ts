import { capabilities } from "../capabilities";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { getCashBasis } from "../cash/basis";
import { getCashForecast } from "../cash/forecast";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const CashForecastOperations = {
  exportCashBasis: defineHttpOperation(
    Api.groups.cashForecast.endpoints.exportCashBasis,
    (token, { params }) =>
      getCashBasis(token, { scope: scopeFromPath(params), id: params.id }).pipe(
        Effect.map((view) => view.artifact.content),
      ),
  ),
  getCashBasis: bindHttpOperation(
    Api.groups.cashForecast.endpoints.getCashBasis,
    capabilities.cash_get_basis,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  captureCashBasis: bindHttpOperation(
    Api.groups.cashForecast.endpoints.captureCashBasis,
    capabilities.cash_capture_basis,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  exportCashForecast: defineHttpOperation(
    Api.groups.cashForecast.endpoints.exportCashForecast,
    (token, { params }) =>
      getCashForecast(token, { scope: scopeFromPath(params), id: params.id }).pipe(
        Effect.map((view) => view.artifact.content),
      ),
  ),
  getCashForecast: bindHttpOperation(
    Api.groups.cashForecast.endpoints.getCashForecast,
    capabilities.cash_get_forecast,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  captureCashForecast: bindHttpOperation(
    Api.groups.cashForecast.endpoints.captureCashForecast,
    capabilities.cash_capture_forecast,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  listCashForecasts: bindHttpOperation(
    Api.groups.cashForecast.endpoints.listCashForecasts,
    capabilities.cash_list_forecasts,
    ({ params, query }) => ({ scope: scopeFromPath(params), ...query }),
  ),
  listCashBases: bindHttpOperation(
    Api.groups.cashForecast.endpoints.listCashBases,
    capabilities.cash_list_bases,
    ({ params, query }) => ({ scope: scopeFromPath(params), ...query }),
  ),
};
