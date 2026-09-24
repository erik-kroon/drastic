import { Api } from "@open-erp/contracts/api";
import * as Dimensions from "@open-erp/contracts/dimensions";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const DimensionHandlers = HttpApiBuilder.group(Api, "dimensions", (handlers) =>
  handlers
    .handle("listDimensions", ({ params }) =>
      Effect.flatMap(authenticate, (token) => query("listDimensions", [token, scopeParameter(params)], Dimensions.DimensionList)),
    )
    .handle("saveDimension", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) => query("saveDimension", [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)], Dimensions.DimensionSaved)),
    )
    .handle("saveDimensionValue", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) => query("saveDimensionValue", [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)], Dimensions.DimensionValueSaved)),
    ),
);
