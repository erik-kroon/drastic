import { sql, type SQL } from "drizzle-orm";

export const payrollFoundationStatements = {
  setPayrollAccess: (p) =>
    sql`select openerp.set_payroll_access(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::boolean) as result`,
  capturePayrollRevision: (p) =>
    sql`select openerp.capture_payroll_revision(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::text,${p[5]}::date,nullif(nullif(${p[6]}::text,''),''),${p[7]}::text,${p[8]}::jsonb) as result`,
  listPayrollRevisions: (p) =>
    sql`select openerp.list_payroll_revisions(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
