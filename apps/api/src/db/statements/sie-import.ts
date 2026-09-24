import { sql, type SQL } from "drizzle-orm";

export const sieImportStatements = {
  listSieSourcePreviews: (p) =>
    sql`select openerp.list_sie_source_previews(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  captureSieSource: (p) =>
    sql`select openerp.capture_sie_source(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
  getSieSource: (p) =>
    sql`select openerp.get_sie_source(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  sealSieSourcePlan: (p) =>
    sql`select openerp.seal_sie_source_plan(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
  getSieSourcePlan: (p) =>
    sql`select openerp.get_sie_source_plan(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  startSieSourceRun: (p) =>
    sql`select openerp.start_sie_source_run(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::text) as result`,
  getSieSourceRun: (p) =>
    sql`select openerp.sie_source_run_view(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  advanceSieSourceRun: (p) =>
    sql`select openerp.advance_sie_source_run(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
  reclaimSieSourceRun: (p) =>
    sql`select openerp.reclaim_sie_source_run(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
