import { sql, type SQL } from "drizzle-orm";

export const subledgerControlStatements = {
  recordSubledgerBasis: (parameters) =>
    sql`select openerp.record_subledger_basis(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  getSubledgerBasis: (parameters) =>
    sql`select openerp.get_subledger_basis(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listSubledgerBases: (parameters) =>
    sql`select openerp.list_subledger_bases(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
  createSubledgerControl: (parameters) =>
    sql`select openerp.create_subledger_control(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  getSubledgerControl: (parameters) =>
    sql`select openerp.get_subledger_control(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listSubledgerControls: (parameters) =>
    sql`select openerp.list_subledger_controls(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
