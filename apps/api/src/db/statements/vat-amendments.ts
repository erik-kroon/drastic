import { sql, type SQL } from "drizzle-orm";

export const vatAmendmentStatements = {
  withdrawVatFact: (parameters) =>
    sql`select openerp.withdraw_vat_fact(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text, ${parameters[4]}::jsonb) as result`,
  compareVatDrafts: (parameters) =>
    sql`select openerp.compare_vat_drafts(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::jsonb) as result`,
  reviewVatAmendment: (parameters) =>
    sql`select openerp.review_vat_amendment(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getVatAmendment: (parameters) =>
    sql`select openerp.get_vat_amendment(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  listVatAmendments: (parameters) =>
    sql`select openerp.list_vat_amendments(${parameters[0]}::text, ${parameters[1]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
