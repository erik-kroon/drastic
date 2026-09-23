import { sql, type SQL } from "drizzle-orm";

export const reportComparisonStatements = {
  compareReports: (parameters) =>
    sql`select openerp.compare_reports(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
