import { Api } from "@open-erp/contracts/api";
import * as Rates from "@open-erp/contracts/exchange-rates";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const ExchangeRatesHandlers = HttpApiBuilder.group(Api, "exchangeRates", (handlers) =>
  handlers
    .handle("createExchangeRate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) => query("createExchangeRate", [
        token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)
      ], Rates.ExchangeRateRevision)),
    )
    .handle("reviseExchangeRate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) => query("reviseExchangeRate", [
        token, scopeParameter(params), params.id, headers["idempotency-key"], JSON.stringify(payload)
      ], Rates.ExchangeRateRevision)),
    )
    .handle("getExchangeRate", ({ params }) =>
      Effect.flatMap(authenticate, (token) => query("getExchangeRate", [
        token, scopeParameter(params), params.id
      ], Rates.ExchangeRateView)),
    )
    .handle("listExchangeRates", ({ params }) =>
      Effect.flatMap(authenticate, (token) => query("listExchangeRates", [
        token, scopeParameter(params)
      ], Rates.ExchangeRateList)),
    )
    .handle("captureConversionReview", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) => query("captureConversionReview", [
        token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)
      ], Rates.ConversionReview)),
    )
    .handle("getConversionReview", ({ params }) =>
      Effect.flatMap(authenticate, (token) => query("getConversionReview", [
        token, scopeParameter(params), params.id
      ], Rates.ConversionReviewView)),
    )
    .handle("listConversionReviews", ({ params }) =>
      Effect.flatMap(authenticate, (token) => query("listConversionReviews", [
        token, scopeParameter(params)
      ], Rates.ConversionReviewList)),
    ),
);
