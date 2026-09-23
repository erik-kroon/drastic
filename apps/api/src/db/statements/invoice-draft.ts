import { sql, type SQL } from "drizzle-orm";

export const invoiceDraftStatements = {
  salesRegister: (parameters) =>
    sql`select openerp.sales_register(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::jsonb) as result`,
  createInvoiceDraft: (parameters) =>
    sql`select openerp.create_invoice_draft(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  reviseInvoiceDraft: (parameters) =>
    sql`select openerp.revise_invoice_draft(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getInvoiceDraft: (parameters) =>
    sql`select openerp.get_invoice_draft(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,
  listInvoiceDrafts: (parameters) =>
    sql`select openerp.list_invoice_drafts(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
  invoiceDraftHistory: (parameters) =>
    sql`select openerp.invoice_draft_history(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
