import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { captureCashBasis, getCashBasis } from "../../../application/cash/basis";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const CashForecastHandlers = HttpApiBuilder.group(Api, "cashForecast", (handlers) =>
  handlers
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
