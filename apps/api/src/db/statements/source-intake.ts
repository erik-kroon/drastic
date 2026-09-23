import { sql, type SQL } from "drizzle-orm";

export const sourceIntakeStatements = {
  recoverSourceRetention: (parameters) =>
    sql`select openerp.recover_source_retention(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  captureSourceReview: (parameters) =>
    sql`select openerp.capture_source_review(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getSourceReviewArtifact: (parameters) =>
    sql`select openerp.get_source_review_artifact(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listSourceReviewArtifacts: (parameters) =>
    sql`select openerp.list_source_review_artifacts(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
  reparseSourceCsv: (parameters) =>
    sql`select openerp.reparse_source_csv(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getSourceRevisionHistory: (parameters) =>
    sql`select openerp.get_source_revision_history(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  beginSourceUpload: (parameters) =>
    sql`select openerp.begin_source_upload(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  completeSourceUpload: (parameters) =>
    sql`select openerp.complete_source_upload(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  getSourceOccurrenceMetadata: (parameters) =>
    sql`with retained as materialized (
      select openerp.get_source_storage(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as body
    ) select jsonb_build_object(
      'occurrence',body->'occurrence',
      'latestPreviewId',body->'latestPreviewId',
      'previewIds',body->'previewIds',
      'originalAvailability','not_checked',
      'admission',case when body->'admission'='null'::jsonb then null else jsonb_build_object(
        'previewId',body->'admission'->'previewId',
        'digest',body->'admission'->'digest',
        'admittedAt',body->'admission'->'admittedAt',
        'admittedBy',body->'admission'->'receipt'->'actorId',
        'statementId',body->'admission'->'imported'->'statement'->'id',
        'evidenceId',body->'admission'->'imported'->'statement'->'evidenceId',
        'checkpoint',body->'admission'->'imported'->'checkpoint'
      ) end
    ) as result from retained`,
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
