import { sql, type SQL } from "drizzle-orm";

export const invoiceCancellationStatements = {
  prepareInvoiceCancellation: (parameters) =>
    sql`select openerp.prepare_invoice_cancellation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  approveInvoiceCancellation: (parameters) =>
    sql`select openerp.approve_invoice_cancellation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeInvoiceCancellation: (parameters) =>
    sql`select openerp.execute_invoice_cancellation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  revokeInvoiceCancellationApproval: (parameters) =>
    sql`select openerp.revoke_invoice_cancellation_approval(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getInvoiceCancellation: (parameters) =>
    sql`select openerp.get_invoice_cancellation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  getInvoiceCancellationStatus: (parameters) =>
    sql`select openerp.get_invoice_cancellation_status(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
