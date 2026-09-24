import { sql, type SQL } from "drizzle-orm";

export const supplierCreditStatements = {
  prepareSupplierCredit: (parameters) =>
    sql`select openerp.prepare_supplier_credit(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  approveSupplierCredit: (parameters) =>
    sql`select openerp.approve_supplier_credit(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeSupplierCredit: (parameters) =>
    sql`select openerp.execute_supplier_credit(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getSupplierCreditReview: (parameters) =>
    sql`select openerp.get_supplier_credit_review(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  supplierCreditHistory: (parameters) =>
    sql`select openerp.supplier_credit_history(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
