import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  captureConversionReview,
  createExchangeRate,
  getConversionReview,
  getExchangeRate,
  listConversionReviews,
  listExchangeRates,
  reviseExchangeRate,
  withdrawExchangeRate,
} from "../../../application/exchange-rates";

export const ExchangeRatesHandlers = HttpApiBuilder.group(Api, "exchangeRates", (handlers) =>
  handlers
    .handle("withdrawExchangeRate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        withdrawExchangeRate(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("createExchangeRate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        createExchangeRate(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("reviseExchangeRate", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        reviseExchangeRate(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getExchangeRate", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getExchangeRate(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("listExchangeRates", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        listExchangeRates(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("captureConversionReview", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        captureConversionReview(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getConversionReview", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getConversionReview(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("listConversionReviews", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        listConversionReviews(token, { scope: scopeFromPath(params) }),
      ),
    ),
);
