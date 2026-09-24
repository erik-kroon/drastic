import { sql, type SQL } from "drizzle-orm";

export const invoicePolicyStatements = {
  saveInvoicePolicyCandidate: (p) =>
    sql`select openerp.save_invoice_policy_candidate(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  reviewInvoicePolicyCandidate: (p) =>
    sql`select openerp.review_invoice_policy_candidate(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
  getInvoicePolicyCandidate: (p) =>
    sql`select openerp.get_invoice_policy_candidate(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  invoicePolicyHistory: (p) =>
    sql`select openerp.invoice_policy_history(${p[0]}::text,${p[1]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
