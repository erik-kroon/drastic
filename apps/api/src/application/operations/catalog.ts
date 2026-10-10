import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Commerce from "../commerce/catalog";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const CatalogOperations = {
  catalogSaveArticle: defineHttpOperation(
    Api.groups.catalog.endpoints.catalogSaveArticle,
    (token, { params, headers, payload }) =>
      Commerce.saveArticle(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  catalogArticleRevision: bindHttpOperation(
    Api.groups.catalog.endpoints.catalogArticleRevision,
    capabilities.catalog_get_article,
    ({ params }) => ({
      scope: scopeFromPath(params),
      code: params.code,
      revision: params.revision,
    }),
  ),
  catalogArticles: bindHttpOperation(
    Api.groups.catalog.endpoints.catalogArticles,
    capabilities.catalog_list_articles,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      after: query.after ?? "",
      status: query.status,
    }),
  ),
};
