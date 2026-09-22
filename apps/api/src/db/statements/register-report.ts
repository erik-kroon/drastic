import { sql, type SQL } from "drizzle-orm";

export const registerReportStatements = {
  createRegisterReport: (parameters) =>
    sql`select openerp.create_register_report(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  getRegisterReport: (parameters) =>
    sql`select openerp.get_register_report(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listRegisterReports: (parameters) =>
    sql`select openerp.list_register_reports(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
