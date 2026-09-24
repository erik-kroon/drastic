import { sql, type SQL } from "drizzle-orm";

export const historicalMigrationStatements = {
  compareSieClosing: (p) =>
    sql`select openerp.compare_sie_closing(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  prepareHistoricalOpening: (p) =>
    sql`select openerp.prepare_historical_opening(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  getSieFinancialWorkspace: (p) =>
    sql`select openerp.get_sie_financial_workspace(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  prepareSieFinancialVoucher: (p) =>
    sql`select openerp.prepare_sie_financial_voucher(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
  admitHistoricalItems: (p) =>
    sql`select openerp.admit_historical_items(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
  getPlanHistoricalItems: (p) =>
    sql`select openerp.get_plan_historical_items(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  getHistoricalItems: (p) =>
    sql`select openerp.get_historical_items(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  listHistoricalBases: (p) =>
    sql`select openerp.list_historical_bases(${p[0]}::text,${p[1]}::jsonb) as result`,
  selectHistoricalBasis: (p) =>
    sql`select openerp.select_historical_basis(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  getHistoricalBasis: (p) =>
    sql`select openerp.get_historical_basis(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  postHistoricalOpening: (p) =>
    sql`select openerp.post_historical_opening(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::text,${p[5]}::text) as result`,
  startSieFinancialRun: (p) =>
    sql`select openerp.start_sie_financial_run(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::text,${p[5]}::text) as result`,
  getSieFinancialRun: (p) =>
    sql`select openerp.sie_financial_run_view(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  advanceSieFinancialRun: (p) =>
    sql`select openerp.advance_sie_financial_run(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
  reclaimSieFinancialRun: (p) =>
    sql`select openerp.reclaim_sie_financial_run(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
