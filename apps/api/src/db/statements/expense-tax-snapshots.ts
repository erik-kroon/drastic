import { sql, type SQL } from "drizzle-orm";
export const expenseTaxSnapshotStatements = {
  listExpenseTaxSnapshots: (parameters) =>
    sql`select openerp.list_expense_tax_snapshots(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
