import { sql, type SQL } from "drizzle-orm";

export const collectionStatements = {
  collectionWorklist: (p) =>
    sql`select openerp.collection_worklist(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  collectionStatementExport: (p) =>
    sql`select openerp.collection_statement_export(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  captureCollectionStatement: (p) =>
    sql`select openerp.capture_collection_statement(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  openCollectionDispute: (p) =>
    sql`select openerp.open_collection_dispute(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  recordCollectionAction: (p) =>
    sql`select openerp.record_collection_action(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  collectionHistory: (p) =>
    sql`select openerp.collection_history(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  collectionHistoryPage: (p) =>
    sql`select openerp.collection_history_page(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
