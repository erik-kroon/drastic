import { sql, type SQL } from "drizzle-orm";

export const closingDiscoveryStatements = {
  listClosingProposals: (parameters) =>
    sql`select openerp.list_closing_proposals(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
