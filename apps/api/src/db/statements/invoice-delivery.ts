import { sql, type SQL } from "drizzle-orm";

export const invoiceDeliveryStatements = {
  prepareInvoiceDelivery: (p) =>
    sql`select openerp.prepare_invoice_delivery(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  approveInvoiceDelivery: (p) =>
    sql`select openerp.approve_invoice_delivery(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
  startInvoiceDeliverySimulation: (p) =>
    sql`select openerp.start_invoice_delivery_simulation(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
  resolveInvoiceDeliverySimulation: (p) =>
    sql`select openerp.resolve_invoice_delivery_simulation(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
  getInvoiceDelivery: (p) =>
    sql`select openerp.get_invoice_delivery(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  invoiceDeliveryHistory: (p) =>
    sql`select openerp.invoice_delivery_history(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
