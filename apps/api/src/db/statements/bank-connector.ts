import { sql, type SQL } from "drizzle-orm";

export const bankConnectorStatements = {
  listConnectorFeeds: (p) =>
    sql`select openerp.list_bank_connector_feeds(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text) as result`,
  listConnectorConsents: (p) =>
    sql`select openerp.list_bank_connector_consents(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  listConnectorBatches: (p) =>
    sql`select openerp.list_bank_connector_batches(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text) as result`,
  saveConnectorConsent: (parameters) =>
    sql`select openerp.save_bank_connector_consent(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  getConnectorConsent: (parameters) =>
    sql`select openerp.get_bank_connector_consent(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  revokeConnectorConsent: (parameters) =>
    sql`select openerp.revoke_bank_connector_consent(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  ingestConnectorBatch: (parameters) =>
    sql`select openerp.ingest_bank_connector_batch(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  recoverConnectorBatch: (parameters) =>
    sql`select openerp.recover_bank_connector_batch(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  getConnectorBatch: (parameters) =>
    sql`select openerp.get_bank_connector_batch(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
