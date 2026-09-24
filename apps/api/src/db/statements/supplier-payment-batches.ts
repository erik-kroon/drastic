import { sql, type SQL } from "drizzle-orm";

export const supplierPaymentBatchStatements = {
  prepareSupplierPaymentBatch: (parameters) =>
    sql`select openerp.prepare_supplier_payment_batch(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  exportSupplierPaymentBatch: (parameters) =>
    sql`select openerp.export_supplier_payment_batch(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getSupplierPaymentBatch: (parameters) =>
    sql`select openerp.get_supplier_payment_batch(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
