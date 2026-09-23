import { sql, type SQL } from "drizzle-orm";

export const invoiceDocumentStatements = {
  captureInvoiceDocument: (p) =>
    sql`select openerp.capture_invoice_document(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  getInvoiceDocument: (p) =>
    sql`select openerp.get_invoice_document(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  sealInvoiceDocument: (p) =>
    sql`select openerp.seal_invoice_document(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  invoiceDocumentHistory: (p) =>
    sql`select openerp.invoice_document_history(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
