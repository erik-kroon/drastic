import { sql, type SQL } from "drizzle-orm";

export const supplierInvoiceDraftStatements = {
  supplierAccountSuggestions: (parameters) =>
    sql`select openerp.supplier_account_suggestions(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  supplierInvoiceDraftDuplicates: (parameters) =>
    sql`select openerp.supplier_invoice_draft_duplicates(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,
  createSupplierInvoiceDraft: (parameters) =>
    sql`select openerp.create_supplier_invoice_draft(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  reviseSupplierInvoiceDraft: (parameters) =>
    sql`select openerp.revise_supplier_invoice_draft(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getSupplierInvoiceDraft: (parameters) =>
    sql`select openerp.get_supplier_invoice_draft(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,
  listSupplierInvoiceDrafts: (parameters) =>
    sql`select openerp.list_supplier_invoice_drafts(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
  supplierInvoiceDraftHistory: (parameters) =>
    sql`select openerp.supplier_invoice_draft_history(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
