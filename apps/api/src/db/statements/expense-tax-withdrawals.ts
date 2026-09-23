import { sql, type SQL } from "drizzle-orm";
export const expenseTaxWithdrawalStatements = {
  withdrawExpenseTaxSource: (parameters) =>
    sql`select openerp.withdraw_expense_tax_source(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
