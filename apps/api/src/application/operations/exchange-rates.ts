import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { createExchangeRate, reviseExchangeRate, withdrawExchangeRate } from "../exchange-rates";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const ExchangeRatesOperations = {
  listConversionReviews: bindHttpOperation(
    Api.groups.exchangeRates.endpoints.listConversionReviews,
    capabilities.fx_list_conversions,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  getConversionReview: bindHttpOperation(
    Api.groups.exchangeRates.endpoints.getConversionReview,
    capabilities.fx_get_conversion,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  captureConversionReview: bindHttpOperation(
    Api.groups.exchangeRates.endpoints.captureConversionReview,
    capabilities.fx_capture_conversion,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  listExchangeRates: bindHttpOperation(
    Api.groups.exchangeRates.endpoints.listExchangeRates,
    capabilities.fx_list_rates,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  getExchangeRate: bindHttpOperation(
    Api.groups.exchangeRates.endpoints.getExchangeRate,
    capabilities.fx_get_rate,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  reviseExchangeRate: defineHttpOperation(
    Api.groups.exchangeRates.endpoints.reviseExchangeRate,
    (token, { params, headers, payload }) =>
      reviseExchangeRate(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  createExchangeRate: defineHttpOperation(
    Api.groups.exchangeRates.endpoints.createExchangeRate,
    (token, { params, headers, payload }) =>
      createExchangeRate(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  withdrawExchangeRate: defineHttpOperation(
    Api.groups.exchangeRates.endpoints.withdrawExchangeRate,
    (token, { params, headers, payload }) =>
      withdrawExchangeRate(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
