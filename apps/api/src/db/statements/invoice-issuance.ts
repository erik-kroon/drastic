import { sql, type SQL } from "drizzle-orm";

export const invoiceIssuanceStatements = {
  prepareInvoiceIssue: (parameters) =>
    sql`select openerp.prepare_invoice_issue(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  approveInvoiceIssue: (parameters) =>
    sql`select openerp.approve_invoice_issue(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeInvoiceIssue: (parameters) =>
    sql`select openerp.execute_invoice_issue(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getInvoiceIssueReview: (parameters) =>
    sql`select openerp.get_invoice_issue_review(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  invoiceIssueHistory: (parameters) =>
    sql`select openerp.invoice_issue_history(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
