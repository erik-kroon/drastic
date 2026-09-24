import { sql, type SQL } from "drizzle-orm";

export const catalogStatements = {
  catalogSaveArticle: (parameters) =>
    sql`select openerp.catalog_save_article(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  catalogArticles: (parameters) =>
    sql`select openerp.catalog_list_articles(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  catalogArticleRevision: (parameters) =>
    sql`select openerp.catalog_get_article(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::bigint) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
