import { Api } from "@open-erp/contracts/api";
import * as Collections from "@open-erp/contracts/collections";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const CollectionsHandlers = HttpApiBuilder.group(Api, "collections", (handlers) =>
  handlers
    .handle("captureCollectionStatement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "captureCollectionStatement",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Collections.CollectionStatement,
        ),
      ),
    )
    .handle("openCollectionDispute", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "openCollectionDispute",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Collections.CollectionDispute,
        ),
      ),
    )
    .handle("recordCollectionAction", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "recordCollectionAction",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Collections.CollectionAction,
        ),
      ),
    )
    .handle("collectionHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "collectionHistory",
          [token, scopeParameter(params), params.id],
          Collections.CollectionHistory,
        ),
      ),
    ),
);
