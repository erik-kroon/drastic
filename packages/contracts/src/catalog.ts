import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { accountingErrors } from "./accounting-errors";
import * as Schema from "effect/Schema";
import * as Accounting from "./accounting";

export const Article = Schema.Struct({
  code: Schema.String,
  revision: Schema.Finite,
  description: Schema.String,
  unit: Schema.String,
  unitPriceMinor: Schema.NullOr(Schema.String),
  taxDescription: Schema.NullOr(Schema.String),
});
export const SaveArticle = Schema.Struct({
  code: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)),
  expectedRevision: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThan(100000)),
  description: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  unit: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  unitPriceMinor: Schema.NullOr(Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,17})$/))),
  taxDescription: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
});
export const ArticlePage = Schema.Struct({ items: Schema.Array(Article), next: Schema.NullOr(Schema.String) });
export const CatalogCapabilities = {
  catalog_list_articles: {
    description: "Read current book-scoped catalog article revisions with a stable page cursor.",
    input: Schema.Struct({ scope: Accounting.Scope, after: Schema.optional(Schema.String) }),
    output: ArticlePage,
    readOnly: true,
  },
  catalog_get_article: {
    description: "Read one immutable catalog article revision selected by code and revision.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      code: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)),
      revision: Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,5}$/)),
    }),
    output: Article,
    readOnly: true,
  },
};
const path = "/v1/entities/:entityId/books/:bookId/commerce/articles";
export const CatalogApi = HttpApiGroup.make("catalog")
  .add(HttpApiEndpoint.get("catalogArticles", path, {
    params: Accounting.Scope, query: Schema.Struct({ after: Schema.optional(Schema.String) }),
    success: ArticlePage, error: accountingErrors,
  }))
  .add(HttpApiEndpoint.get("catalogArticleRevision", `${path}/:code/revisions/:revision`, {
    params: Schema.Struct({ ...Accounting.Scope.fields, code: Schema.String, revision: Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,5}$/)) }),
    success: Article, error: accountingErrors,
  }))
  .add(HttpApiEndpoint.post("catalogSaveArticle", path, {
    params: Accounting.Scope, headers: Accounting.IdempotencyHeaders,
    payload: SaveArticle, success: Article, error: accountingErrors,
  }));
