import { sql, type SQL } from "drizzle-orm";

export const bankSourceCoverageStatements = {
  createBankSourceCoverage: (parameters) =>
    sql`select openerp.create_bank_source_coverage(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  getBankSourceCoverage: (parameters) =>
    sql`select openerp.get_bank_source_coverage(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listBankSourceCoverage: (parameters) =>
    sql`select openerp.list_bank_source_coverage(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
