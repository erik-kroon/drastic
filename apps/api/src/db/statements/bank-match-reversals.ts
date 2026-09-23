import { sql, type SQL } from "drizzle-orm";

export const bankMatchReversalStatements = {
  prepareBankMatchReversal: (parameters) =>
    sql`select openerp.prepare_bank_match_reversal(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  getBankMatchReversal: (parameters) =>
    sql`select openerp.get_bank_match_reversal(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listBankMatchReversals: (parameters) =>
    sql`select openerp.list_bank_match_reversals(${parameters[0]}::text,${parameters[1]}::jsonb,NULLIF(${parameters[2]}::text,'')) as result`,
  approveBankMatchReversal: (parameters) =>
    sql`select openerp.approve_bank_match_reversal(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeBankMatchReversal: (parameters) =>
    sql`select openerp.execute_bank_match_reversal(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  revokeBankMatchReversalApproval: (parameters) =>
    sql`select openerp.revoke_bank_match_reversal_approval(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
