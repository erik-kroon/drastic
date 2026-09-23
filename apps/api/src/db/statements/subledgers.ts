import { sql, type SQL } from "drizzle-orm";

export const subledgerStatements = {
  prepareAssetDisposal: (parameters) =>
    sql`select openerp.prepare_subledger_disposal(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  approveAssetDisposal: (parameters) =>
    sql`select openerp.approve_subledger_disposal(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeAssetDisposal: (parameters) =>
    sql`select openerp.execute_subledger_disposal(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getAssetDisposalReview: (parameters) =>
    sql`select openerp.get_subledger_disposal_review(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listAssetDisposalReviews: (parameters) =>
    sql`select openerp.list_subledger_disposal_reviews(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,

  amendScheduleEstimate: (parameters) =>
    sql`select openerp.amend_schedule_estimate(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  amendScheduleFutureDates: (parameters) =>
    sql`select openerp.amend_schedule_future_dates(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
