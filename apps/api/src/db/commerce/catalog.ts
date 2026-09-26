import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export const catalogTables = ["catalog_articles", "catalog_article_revisions"] as const;

export type ArticlePointerRow = {
  readonly code: string;
  readonly currentRevision: bigint | null;
};

export type ArticleRevisionRow = {
  readonly code: string;
  readonly revision: bigint;
  readonly body: JsonObject;
};

export type ArticlePageRow = {
  readonly code: string;
  readonly body: JsonObject;
  readonly hasMore: boolean;
};

export function readArticlePointer(
  transaction: Transaction,
  bookId: string,
  code: string,
  lock: "share" | "update",
) {
  const lockClause = lock === "update" ? sql`for update` : sql`for share`;
  return transaction.execute<ArticlePointerRow>(
    sql`
      select code, current_revision as "currentRevision"
      from openerp.catalog_articles
      where book_id = ${bookId} and code = ${code}
      ${lockClause}
    `,
    "objects",
  );
}

export function readCurrentArticlePage(
  transaction: Transaction,
  bookId: string,
  after: string,
  limit: number,
) {
  return transaction.execute<ArticlePageRow>(
    sql`
      select page.code, page.body, page.total > ${limit} as "hasMore"
      from (
        select a.code, r.body, count(*) over () as total, row_number() over (order by a.code) as position
        from openerp.catalog_articles a
        join openerp.catalog_article_revisions r
          on r.book_id = a.book_id and r.code = a.code and r.revision = a.current_revision
        where a.book_id = ${bookId} and a.code collate "C" > ${after} collate "C"
        order by a.code collate "C"
        limit ${limit + 1}
      ) page
      where page.position <= ${limit}
      order by page.code collate "C"
    `,
    "objects",
  );
}

export function readArticleRevision(
  transaction: Transaction,
  bookId: string,
  code: string,
  revision: string,
) {
  return transaction.execute<ArticleRevisionRow>(
    sql`
      select code, revision, body
      from openerp.catalog_article_revisions
      where book_id = ${bookId} and code = ${code} and revision = ${revision}::bigint
    `,
    "objects",
  );
}

export function insertArticlePointer(
  transaction: Transaction,
  row: { bookId: string; code: string; currentRevision: string },
) {
  return transaction.execute(
    sql`
      insert into openerp.catalog_articles (book_id, code, current_revision)
      values (${row.bookId}, ${row.code}, ${row.currentRevision}::bigint)
    `,
    "objects",
  );
}

export function advanceArticlePointer(
  transaction: Transaction,
  row: { bookId: string; code: string; currentRevision: string },
) {
  return transaction.execute(
    sql`
      update openerp.catalog_articles set current_revision = ${row.currentRevision}::bigint
      where book_id = ${row.bookId} and code = ${row.code}
    `,
    "objects",
  );
}

export function insertArticleRevision(
  transaction: Transaction,
  row: {
    bookId: string;
    code: string;
    revision: string;
    body: JsonObject;
    recordedBy: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.catalog_article_revisions (book_id, code, revision, body, recorded_by)
      values (${row.bookId}, ${row.code}, ${row.revision}::bigint, ${JSON.stringify(row.body)}::jsonb,
        ${row.recordedBy})
    `,
    "objects",
  );
}
