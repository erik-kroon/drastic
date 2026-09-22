import { sql, type SQL } from "drizzle-orm";

export const sieStatements = {
  captureSieTransaction: (p) =>
    sql`select openerp.capture_sie_transaction(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  getSieTransaction: (p) =>
    sql`select openerp.get_sie_transaction(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  sealSieTransaction: (p) =>
    sql`select openerp.seal_sie_transaction(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  listSieTransactions: (p) =>
    sql`select openerp.list_sie_transactions(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
