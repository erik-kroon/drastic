import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Commerce from "../../../application/commerce/catalog";

export const CatalogHandlers = HttpApiBuilder.group(Api, "catalog", (handlers) =>
  handlers
    .handle("catalogArticles", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.listArticles(token, { scope: scopeFromPath(params), after: query.after ?? "" }),
      ),
    )
    .handle("catalogArticleRevision", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.getArticle(token, {
          scope: scopeFromPath(params),
          code: params.code,
          revision: params.revision,
        }),
      ),
    )
    .handle("catalogSaveArticle", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.saveArticle(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
