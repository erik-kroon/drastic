import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Commerce from "../../../application/commerce/collections";

export const CollectionsHandlers = HttpApiBuilder.group(Api, "collections", (handlers) =>
  handlers
    .handle("collectionWorklist", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.readWorklist(token, { scope: scopeFromPath(params), page: search.page ?? "1" }),
      ),
    )
    .handle("collectionStatementExport", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.readStatementExport(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("captureCollectionStatement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.captureStatement(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("openCollectionDispute", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.openDispute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("recordCollectionAction", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.recordAction(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("collectionHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.readHistory(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("collectionHistoryPage", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.readHistoryPage(token, {
          scope: scopeFromPath(params),
          id: params.id,
          after: search.after ?? "",
        }),
      ),
    ),
);
