import { Api } from "@open-erp/contracts/api";
import * as Catalog from "@open-erp/contracts/catalog";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const CatalogHandlers = HttpApiBuilder.group(Api, "catalog", (handlers) =>
  handlers
    .handle("catalogArticles", ({ params, query: filters }) =>
      Effect.flatMap(authenticate, (token) => query("catalogArticles", [token, scopeParameter(params), filters.after ?? ""], Catalog.ArticlePage)))
    .handle("catalogArticleRevision", ({ params }) =>
      Effect.flatMap(authenticate, (token) => query("catalogArticleRevision", [token, scopeParameter(params), params.code, params.revision], Catalog.Article)))
    .handle("catalogSaveArticle", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) => query("catalogSaveArticle", [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)], Catalog.Article))),
);
