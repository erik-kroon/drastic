import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Partitions from "../../../application/sie/partitions";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const SiePartitionsHandlers = HttpApiBuilder.group(Api, "siePartitions", (handlers) =>
  handlers
    .handle("prepareSiePartition", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Partitions.prepareSiePartition(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getSiePartition", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Partitions.getSiePartition(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    ),
);
