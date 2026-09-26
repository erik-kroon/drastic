import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { listDimensions, saveDimension, saveDimensionValue } from "../../../application/dimensions";

export const DimensionHandlers = HttpApiBuilder.group(Api, "dimensions", (handlers) =>
  handlers
    .handle("listDimensions", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        listDimensions(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("saveDimension", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        saveDimension(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("saveDimensionValue", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        saveDimensionValue(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
