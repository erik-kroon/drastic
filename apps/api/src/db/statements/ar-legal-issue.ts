import { sql, type SQL } from "drizzle-orm";

export const arLegalIssueStatements = {
  activateArLegalAccountingProfile: (p) =>
    sql`select openerp.activate_ar_legal_accounting_profile(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  getArLegalAccountingProfile: (p) =>
    sql`select openerp.get_ar_legal_accounting_profile(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  prepareArLegalIssue: (p) =>
    sql`select openerp.prepare_ar_legal_issue(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  approveArLegalIssue: (p) =>
    sql`select openerp.approve_ar_legal_issue(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
  executeArLegalIssue: (p) =>
    sql`select openerp.execute_ar_legal_issue(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
  getArLegalIssueReview: (p) =>
    sql`select openerp.get_ar_legal_issue_review(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  getArLegalIssue: (p) =>
    sql`select openerp.get_ar_legal_issue(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  arLegalIssueHistory: (p) =>
    sql`select openerp.ar_legal_issue_history(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
