import { sql, type SQL } from "drizzle-orm";

export const supplierAcceptanceStatements = {
  prepareSupplierAcceptance: (parameters) =>
    sql`select openerp.prepare_supplier_acceptance(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  approveSupplierAcceptance: (parameters) =>
    sql`select openerp.approve_supplier_acceptance(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeSupplierAcceptance: (parameters) =>
    sql`select openerp.execute_supplier_acceptance(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getSupplierAcceptanceReview: (parameters) =>
    sql`select openerp.get_supplier_acceptance_review(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  supplierAcceptanceHistory: (parameters) =>
    sql`select openerp.supplier_acceptance_history(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
