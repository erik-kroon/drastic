import { sql, type SQL } from "drizzle-orm";

export const supplierInboxStatements = {
  listSupplierInboxes: (p) =>
    sql`select openerp.list_supplier_inboxes(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  registerSupplierInbox: (p) =>
    sql`select openerp.register_supplier_inbox(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  getSupplierInbox: (p) =>
    sql`select openerp.supplier_inbox_view(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  recordSupplierExtraction: (p) =>
    sql`select openerp.record_supplier_extraction(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
  reviewSupplierInbox: (p) =>
    sql`select openerp.review_supplier_inbox(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
