import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import * as Sie4E from "../../../application/sie4e";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const Sie4EHandlers = HttpApiBuilder.group(Api, "sieFullBook", (handlers) =>
  handlers
    .handle("prepareSie4E", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie4E.prepareSie4E(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getSie4E", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie4E.getSie4E(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("sie4ERows", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie4E.sie4ERows(token, { scope: scopeFromPath(params), id: params.id, after: query.after }),
      ),
    )
    .handle("listSie4E", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie4E.listSie4Es(token, { scope: scopeFromPath(params), after: query.after }),
      ),
    )
    .handle("resumeSie4E", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie4E.resumeSie4E(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    ),
);
