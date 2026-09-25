import { sql, type SQL } from "drizzle-orm";

export const commerceFxStatements = {
  prepareCommerceFxRecognition: (parameters) =>
    sql`select openerp.prepare_commerce_fx_recognition(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  approveCommerceFxRecognition: (parameters) =>
    sql`select openerp.approve_commerce_fx_recognition(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeCommerceFxRecognition: (parameters) =>
    sql`select openerp.execute_commerce_fx_recognition(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  prepareCommerceFxSettlement: (parameters) =>
    sql`select openerp.prepare_commerce_fx_settlement(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  approveCommerceFxSettlement: (parameters) =>
    sql`select openerp.approve_commerce_fx_settlement(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeCommerceFxSettlement: (parameters) =>
    sql`select openerp.execute_commerce_fx_settlement(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  prepareCommerceFxPartialSettlement: (parameters) =>
    sql`select openerp.prepare_commerce_fx_partial_settlement(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  approveCommerceFxPartialSettlement: (parameters) =>
    sql`select openerp.approve_commerce_fx_partial_settlement(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeCommerceFxPartialSettlement: (parameters) =>
    sql`select openerp.execute_commerce_fx_partial_settlement(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  prepareCommerceFxSettlementCorrection: (parameters) =>
    sql`select openerp.prepare_commerce_fx_settlement_correction(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  approveCommerceFxSettlementCorrection: (parameters) =>
    sql`select openerp.approve_commerce_fx_settlement_correction(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeCommerceFxSettlementCorrection: (parameters) =>
    sql`select openerp.execute_commerce_fx_settlement_correction(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getCommerceFxItem: (parameters) =>
    sql`select openerp.get_commerce_fx_item(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  recoverCommerceFxCommand: (parameters) =>
    sql`select openerp.recover_commerce_fx_command(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
