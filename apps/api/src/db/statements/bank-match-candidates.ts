import { sql, type SQL } from "drizzle-orm";

export const bankMatchCandidateStatements = {
  discoverBankMatchCandidates: (parameters) =>
    sql`select openerp.discover_bank_match_candidates(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
