import { sql, type SQL } from "drizzle-orm";

export const legalSalesPolicyStatements = {
  activateLegalSalesPolicy: (p) =>
    sql`select openerp.activate_ar_legal_policy(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  legalSalesPolicyHistory: (p) =>
    sql`select openerp.ar_legal_policy_history(${p[0]}::text,${p[1]}::jsonb) as result`,
  getLegalSalesPolicy: (p) =>
    sql`select openerp.get_ar_legal_policy(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
