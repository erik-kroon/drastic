import { sql, type SQL } from "drizzle-orm";

export const bankSignoffStatements = {
  prepareBankSignoff: (parameters) =>
    sql`select openerp.prepare_bank_signoff(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  signBankReconciliation: (parameters) =>
    sql`select openerp.sign_bank_reconciliation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getBankSignoff: (parameters) =>
    sql`select openerp.get_bank_signoff(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listBankSignoffs: (parameters) =>
    sql`select openerp.list_bank_signoffs(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
