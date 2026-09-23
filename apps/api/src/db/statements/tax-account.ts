import { sql, type SQL } from "drizzle-orm";

export const taxAccountStatements = {
  listUnclassifiedTaxAccountEvents: (parameters) =>
    sql`select openerp.list_unclassified_tax_account_events(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,
  resolveTaxAccountEventClassification: (parameters) =>
    sql`select openerp.resolve_tax_account_event_classification(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getTaxAccountEventClassification: (parameters) =>
    sql`select openerp.get_tax_account_event_classification(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  previewTaxAccountMatch: (parameters) =>
    sql`select openerp.preview_tax_account_match(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::jsonb) as result`,
  matchTaxAccountEvent: (parameters) =>
    sql`select openerp.match_tax_account_event(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  unmatchTaxAccountEvent: (parameters) =>
    sql`select openerp.unmatch_tax_account_event(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getTaxAccountMatch: (parameters) =>
    sql`select openerp.get_tax_account_match(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listTaxAccountMatches: (parameters) =>
    sql`select openerp.list_tax_account_matches(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
  recordTaxAccountStatement: (parameters) =>
    sql`select openerp.record_tax_account_statement(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  getTaxAccountStatement: (parameters) =>
    sql`select openerp.get_tax_account_statement(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listTaxAccountStatements: (parameters) =>
    sql`select openerp.list_tax_account_statements(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
  createTaxAccountControl: (parameters) =>
    sql`select openerp.create_tax_account_control(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  getTaxAccountControl: (parameters) =>
    sql`select openerp.get_tax_account_control(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  listTaxAccountControls: (parameters) =>
    sql`select openerp.list_tax_account_controls(${parameters[0]}::text,${parameters[1]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
