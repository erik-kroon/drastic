import { sql, type SQL } from "drizzle-orm";

export const vatReclassificationStatements = {
  prepareVatControlReclassification: (parameters) =>
    sql`select openerp.prepare_vat_control_reclassification(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  approveVatControlReclassification: (parameters) =>
    sql`select openerp.approve_vat_control_reclassification(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeVatControlReclassification: (parameters) =>
    sql`select openerp.execute_vat_control_reclassification(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getVatControlReclassification: (parameters) =>
    sql`select openerp.get_vat_control_reclassification(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listVatControlReclassifications: (parameters) =>
    sql`select openerp.list_vat_control_reclassifications(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
  recoverVatControlReclassification: (parameters) =>
    sql`select openerp.recover_vat_control_reclassification_request(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
