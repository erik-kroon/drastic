import { sql, type SQL } from "drizzle-orm";

export const invoicePdfStatements = {
  captureInvoicePdf: (p) =>
    sql`select openerp.capture_invoice_pdf(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  getInvoicePdf: (p) =>
    sql`select openerp.get_invoice_pdf(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  sealInvoicePdf: (p) =>
    sql`select openerp.seal_invoice_pdf(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  invoicePdfHistory: (p) =>
    sql`select openerp.invoice_pdf_history(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
