import { Client } from "pg";
import * as Schema from "effect/Schema";
import {
  LocalPreflight,
  LocalTarget,
  TableFingerprint,
} from "../../../../packages/contracts/src/operations";
import { refuse } from "./safety";

export async function readPreflight(client: Client, target: typeof LocalTarget.Type) {
  const books = await client.query<{
    id: string;
    authority: "native";
    writerEpoch: string;
    committedSequence: string;
  }>(`
    SELECT id, authority, writer_epoch::text AS "writerEpoch", committed_sequence::text AS "committedSequence"
    FROM openerp.books ORDER BY id COLLATE "C"`);
  const state = await client.query<{
    sessions: number;
    pending: string;
    approvals: string;
    version: string;
  }>(`
    SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) AS sessions,
    (SELECT count(*)::text FROM openerp.outbox WHERE delivered_at IS NULL) AS pending,
    (SELECT count(*)::text FROM openerp.approvals WHERE consumed_at IS NULL AND expires_at > now()) AS approvals,
    current_setting('server_version') AS version`);
  const row = state.rows[0];
  if (!row) refuse("Database preflight returned no result.");
  const native =
    books.rows.length > 0 &&
    books.rows.every((book) => book.authority === "native" && BigInt(book.writerEpoch) > 0n);
  const blockers = [
    "Production actions are disabled.",
    "No independently verified archive/retention profile.",
    "No independently verified restore or company readiness.",
    "No write freeze or final-delta reconciliation.",
  ];
  if (!native) blockers.push("A book has no observed native writer authority.");
  if (row.sessions !== 0)
    blockers.push("Other database sessions exist; their write authority is not established.");
  if (row.pending !== "0") blockers.push("Undelivered outbox work exists.");
  if (row.approvals !== "0") blockers.push("Unconsumed approvals exist.");
  return Schema.decodeSync(LocalPreflight)({
    version: 1,
    checkedAt: new Date().toISOString(),
    database: target.database,
    systemIdentifier: target.expectedSystemIdentifier,
    serverVersion: row.version,
    books: books.rows,
    otherSessions: row.sessions,
    pendingOutbox: row.pending,
    unconsumedApprovals: row.approvals,
    singleWriterObservation: native ? "native-epochs-observed" : "blocked",
    writeFreeze: "not-established",
    productionAction: "disabled",
    blockers,
  });
}

export async function tableFingerprints(client: Client) {
  const unsupported = await client.query<{ found: boolean }>(`
    SELECT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND (c.relkind IN ('S','f','m') OR c.relpersistence <> 'p'))
      OR EXISTS(SELECT FROM pg_largeobject_metadata) AS found`);
  if (unsupported.rows[0]?.found !== false) {
    refuse(
      "Local backup supports permanent tables only; sequences, foreign/materialized/unlogged relations and large objects require a reviewed extension.",
    );
  }
  const tables = await client.query<{ schema: string; table: string }>(`
    SELECT n.nspname AS schema, c.relname AS table FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"`);
  const required = [
    "books",
    "evidence",
    "approvals",
    "execution_receipts",
    "command_receipts",
    "outbox",
    "vouchers",
    "journal_lines",
    "report_snapshots",
    "report_lines",
  ];
  if (
    required.some(
      (name) => !tables.rows.some((table) => table.schema === "openerp" && table.table === name),
    ) ||
    !tables.rows.some(
      (table) => table.schema === "public" && table.table === "openerp_migrations",
    ) ||
    ["user", "session", "account", "verification", "rate_limit"].some(
      (name) =>
        !tables.rows.some((table) => table.schema === "openerp_auth" && table.table === name),
    )
  ) {
    refuse("The database is missing required accounting or migration records.");
  }
  const result: Array<typeof TableFingerprint.Type> = [];
  for (const table of tables.rows) {
    // Only catalog-derived identifiers enter SQL; all data values use parameters.
    const identifier = `${client.escapeIdentifier(table.schema)}.${client.escapeIdentifier(table.table)}`;
    const count = await client.query<{ rows: string }>(
      `SELECT count(*)::text AS rows FROM ONLY ${identifier}`,
    );
    const rows = count.rows[0]?.rows;
    // ponytail: bounded synthetic inventory; replace aggregation with streamed hashing before larger books.
    if (rows === undefined || BigInt(rows) > 100000n)
      refuse("Local fingerprinting is limited to 100000 rows per table.");
    const hash = await client.query<{ sha256: string }>(`
      SELECT encode(sha256(convert_to(coalesce(string_agg(h, '' ORDER BY h COLLATE "C"), ''), 'UTF8')), 'hex') AS sha256
      FROM (SELECT encode(sha256(convert_to(row_to_json(r)::text, 'UTF8')), 'hex') AS h FROM ONLY ${identifier} r) hashes`);
    result.push(
      Schema.decodeUnknownSync(TableFingerprint)({ ...table, rows, sha256: hash.rows[0]?.sha256 }),
    );
  }
  return result;
}
