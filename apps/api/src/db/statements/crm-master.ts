import { sql, type SQL } from "drizzle-orm";

export const crmMasterStatements = {
  crmAddAnnotation: (parameters) =>
    sql`select openerp.crm_add_annotation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  crmDirectory: (parameters) =>
    sql`select openerp.crm_directory(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
