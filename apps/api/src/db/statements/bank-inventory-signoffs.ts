import { sql, type SQL } from "drizzle-orm";

export const bankInventorySignoffStatements = {
  prepareBankInventorySignoff: (parameters) =>
    sql`select openerp.prepare_bank_inventory_signoff(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  signBankInventory: (parameters) =>
    sql`select openerp.sign_bank_inventory(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getBankInventorySignoff: (parameters) =>
    sql`select openerp.get_bank_inventory_signoff(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listBankInventorySignoffs: (parameters) =>
    sql`select openerp.list_bank_inventory_signoffs(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
