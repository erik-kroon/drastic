import { sql, type SQL } from "drizzle-orm";

export const commerceAllocationReversalStatements = {
  prepareCommerceAllocationReversal: (parameters) =>
    sql`select openerp.prepare_commerce_allocation_reversal(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  getCommerceAllocationReversal: (parameters) =>
    sql`select openerp.get_commerce_allocation_reversal(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listCommerceAllocationReversals: (parameters) =>
    sql`select openerp.list_commerce_allocation_reversals(${parameters[0]}::text,${parameters[1]}::jsonb,NULLIF(${parameters[2]}::text,'')) as result`,
  approveCommerceAllocationReversal: (parameters) =>
    sql`select openerp.approve_commerce_allocation_reversal(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeCommerceAllocationReversal: (parameters) =>
    sql`select openerp.execute_commerce_allocation_reversal(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  revokeCommerceAllocationReversalApproval: (parameters) =>
    sql`select openerp.revoke_commerce_allocation_reversal_approval(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getCommerceAllocationStatus: (parameters) =>
    sql`select openerp.get_commerce_allocation_status(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  getCommerceRegisterAllocationStatus: (parameters) =>
    sql`select openerp.get_commerce_register_allocation_status(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
