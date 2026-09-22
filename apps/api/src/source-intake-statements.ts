import { sql, type SQL } from "drizzle-orm";

export const sourceIntakeStatements = {
  beginSourceUpload: (parameters) =>
    sql`select openerp.begin_source_upload(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  completeSourceUpload: (parameters) =>
    sql`select openerp.complete_source_upload(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  getSourceStorage: (parameters) =>
    sql`select openerp.get_source_storage(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  retainSource: (parameters) =>
    sql`select openerp.retain_source(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  listSourceOccurrences: (parameters) =>
    sql`select openerp.list_source_occurrences(${parameters[0]}::text,${parameters[1]}::jsonb,NULLIF(${parameters[2]}::text,'')) as result`,
  getSourceOccurrence: (parameters) =>
    sql`select openerp.get_source_occurrence(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  previewSourceCsv: (parameters) =>
    sql`select openerp.preview_source_csv(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getSourcePreview: (parameters) =>
    sql`select openerp.get_source_preview(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  approveSourcePreview: (parameters) =>
    sql`select openerp.approve_source_preview(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  admitSourcePreview: (parameters) =>
    sql`select openerp.admit_source_preview(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
