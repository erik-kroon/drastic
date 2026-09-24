import { sql, type SQL } from "drizzle-orm";
export const salesOrderStatements = {
  salesDocumentCommand: (p) => sql`select openerp.sales_document_command(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::text,${p[5]}::jsonb) as result`,
  salesDocumentList: (p) => sql`select openerp.sales_document_list(${p[0]}::text,${p[1]}::jsonb) as result`,
  salesDocumentView: (p) => sql`select openerp.sales_document_view(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  convertSalesOrder: (p) => sql`select openerp.convert_sales_order(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
