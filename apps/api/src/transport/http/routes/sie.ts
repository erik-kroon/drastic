import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { prepareSie, getSie, listSie, resumeSie } from "../../../application/sie";

export const SieHandlers = HttpApiBuilder.group(Api, "sie", (handlers) =>
  handlers
    .handle("prepareSie", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareSie(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getSie", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getSie(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("listSie", ({ params, query: cursor }) =>
      Effect.flatMap(authenticate, (token) =>
        listSie(token, { scope: scopeFromPath(params), ...cursor }),
      ),
    )
    .handle("resumeSie", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        resumeSie(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    ),
);
