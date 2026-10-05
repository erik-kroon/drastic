import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { captureCashBasis, getCashBasis, listCashBases } from "../../../application/cash/basis";
import {
  captureCashForecast,
  getCashForecast,
  listCashForecasts,
} from "../../../application/cash/forecast";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const CashForecastHandlers = HttpApiBuilder.group(Api, "cashForecast", (handlers) =>
  handlers
    .handle("listCashBases", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        listCashBases(token, { scope: scopeFromPath(params), ...query }),
      ),
    )
    .handle("listCashForecasts", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        listCashForecasts(token, { scope: scopeFromPath(params), ...query }),
      ),
    )
    .handle("captureCashForecast", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        captureCashForecast(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getCashForecast", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getCashForecast(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("exportCashForecast", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getCashForecast(token, { scope: scopeFromPath(params), id: params.id }).pipe(
          Effect.map((view) => view.artifact.content),
        ),
      ),
    )
    .handle("captureCashBasis", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        captureCashBasis(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getCashBasis", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getCashBasis(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("exportCashBasis", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getCashBasis(token, { scope: scopeFromPath(params), id: params.id }).pipe(
          Effect.map((view) => view.artifact.content),
        ),
      ),
    ),
);
