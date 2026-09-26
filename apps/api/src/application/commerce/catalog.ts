import * as Catalog from "@open-erp/contracts/catalog";
import * as Effect from "effect/Effect";
import * as CatalogDb from "../../db/commerce/catalog";
import { replay, saveCommand } from "../posting";
import { lockBookForUpdate } from "../../db/posting";
import { failure } from "../failures";
import { decode, requireTableAccess, withBook, type JsonObject, type Scope } from "./support";

const ArticleSchema = Catalog.Article;

const ArticlePageSchema = Catalog.ArticlePage;

const SaveArticleSchema = Catalog.SaveArticle;

const pageSize = 50;

function minorPattern(value: string) {
  return /^(0|[1-9][0-9]{0,17})$/u.test(value);
}

export const listArticles = Effect.fn("commerce.catalog.listArticles")(function* (
  token: string,
  input: { scope: Scope; after: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, CatalogDb.catalogTables, false);

    if (input.after.length > 64) return yield* failure("InvalidJournal");

    const rows = yield* CatalogDb.readCurrentArticlePage(
      transaction,
      input.scope.bookId,
      input.after,
      pageSize,
    );

    const last = rows[rows.length - 1];

    return yield* decode(ArticlePageSchema, {
      items: rows.map((row) => row.body),
      next: last?.hasMore === true ? last.code : null,
    });
  });
});

export const getArticle = Effect.fn("commerce.catalog.getArticle")(function* (
  token: string,
  input: { scope: Scope; code: string; revision: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, CatalogDb.catalogTables, false);

    if (BigInt(input.revision) < 1n) return yield* failure("InvalidJournal");

    const rows = yield* CatalogDb.readArticleRevision(
      transaction,
      input.scope.bookId,
      input.code,
      input.revision,
    );

    const row = rows[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(ArticleSchema, row.body);
  });
});

export const saveArticle = Effect.fn("commerce.catalog.saveArticle")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Catalog.SaveArticle.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "catalog_save_article",
        principal.actorId,
        command.input,
        ArticleSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, CatalogDb.catalogTables, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const input = yield* decode(SaveArticleSchema, command.input);

      if (
        input.description.length > 500 ||
        input.unit.length > 32 ||
        (input.unitPriceMinor !== null && !minorPattern(input.unitPriceMinor)) ||
        (input.taxDescription !== null && input.taxDescription.length > 200)
      ) {
        return yield* failure("InvalidJournal");
      }

      const pointers = yield* CatalogDb.readArticlePointer(
        transaction,
        command.scope.bookId,
        input.code,
        "update",
      );

      const current = pointers[0]?.currentRevision ?? 0n;

      if (current !== BigInt(input.expectedRevision)) return yield* failure("StaleDependency");
      const next = current + 1n;

      const body: JsonObject = {
        code: input.code,
        revision: Number(next),
        description: input.description,
        unit: input.unit,
        unitPriceMinor: input.unitPriceMinor,
        taxDescription: input.taxDescription,
      };

      const pointer = {
        bookId: command.scope.bookId,
        code: input.code,
        currentRevision: next.toString(),
      };

      if (input.expectedRevision === 0) {
        yield* CatalogDb.insertArticlePointer(transaction, pointer);
      } else {
        yield* CatalogDb.advanceArticlePointer(transaction, pointer);
      }

      yield* CatalogDb.insertArticleRevision(transaction, {
        bookId: command.scope.bookId,
        code: input.code,
        revision: next.toString(),
        body,
        recordedBy: principal.actorId,
      });
      const result = yield* decode(ArticleSchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "catalog_save_article",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});
