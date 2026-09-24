import { sql, type SQL } from "drizzle-orm";

export const companySetupStatements = {
  createCompany: (parameters) =>
    sql`select openerp.company_create(${parameters[0]}::text,${parameters[1]}::text,${parameters[2]}::jsonb) as result`,
  getCompanySetup: (parameters) =>
    sql`select openerp.company_get_setup(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
  saveCompanySetup: (parameters) =>
    sql`select openerp.company_save_setup(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
