import { sql, type SQL } from "drizzle-orm";
export const firmStatements = {
  listFirms: (parameters) => sql`select openerp.firm_list(${parameters[0]}::text) as result`,
  getFirm: (parameters) =>
    sql`select openerp.firm_get(${parameters[0]}::text,${parameters[1]}::text) as result`,
  createFirm: (parameters) =>
    sql`select openerp.firm_create(${parameters[0]}::text,${parameters[1]}::text,${parameters[2]}::jsonb) as result`,
  saveFirmClient: (parameters) =>
    sql`select openerp.firm_save_client(${parameters[0]}::text,${parameters[1]}::text,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  removeFirmClient: (parameters) =>
    sql`select openerp.firm_remove_client(${parameters[0]}::text,${parameters[1]}::text,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  saveFirmMember: (parameters) =>
    sql`select openerp.firm_save_member(${parameters[0]}::text,${parameters[1]}::text,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
