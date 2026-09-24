import { sql, type SQL } from "drizzle-orm";

export const legalInvoicePdfStatements = {
  captureLegalInvoicePdf: (p) =>
    sql`select openerp.capture_ar_legal_pdf(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  getLegalInvoicePdf: (p) =>
    sql`select openerp.get_ar_legal_pdf(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  sealLegalInvoicePdf: (p) =>
    sql`select openerp.seal_ar_legal_pdf(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  legalInvoicePdfHistory: (p) =>
    sql`select openerp.ar_legal_pdf_history(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
