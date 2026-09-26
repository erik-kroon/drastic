import { Client } from "pg";
import * as Schema from "effect/Schema";
import {
  EvidenceInventory,
  ReceiptInventory,
  RecoveryControls,
  TableFingerprint,
} from "../../../../packages/contracts/src/operations";
import { refuse } from "./safety";

export async function recoveryControls(
  client: Client,
  tables: ReadonlyArray<typeof TableFingerprint.Type>,
  originalsVerified = false,
) {
  const integrity = await client.query<{ invalid: boolean }>(`
    SELECT EXISTS(SELECT FROM openerp.books WHERE profile <> 'synthetic-core-v1')
      OR EXISTS(SELECT FROM openerp_auth.account WHERE access_token IS NOT NULL OR refresh_token IS NOT NULL OR id_token IS NOT NULL)
      OR EXISTS(SELECT FROM openerp.evidence WHERE sha256 IS DISTINCT FROM encode(sha256(convert_to(content,'UTF8')), 'hex'))
      OR EXISTS(SELECT FROM openerp.books b WHERE b.committed_sequence IS DISTINCT FROM
        (SELECT coalesce(max(v.sequence),0) FROM openerp.vouchers v WHERE v.book_id=b.id))
      OR EXISTS(SELECT FROM openerp.vouchers v LEFT JOIN openerp.journal_lines l ON l.book_id=v.book_id AND l.voucher_id=v.id
        GROUP BY v.book_id,v.id HAVING count(l.id)<2 OR sum(l.debit_minor) IS DISTINCT FROM sum(l.credit_minor))
      OR EXISTS(SELECT FROM openerp.vouchers v LEFT JOIN openerp.execution_receipts r ON r.book_id=v.book_id AND r.voucher_id=v.id WHERE r.id IS NULL)
      OR EXISTS(SELECT FROM openerp.execution_receipts r LEFT JOIN openerp.vouchers v ON v.book_id=r.book_id AND v.id=r.voucher_id
        LEFT JOIN openerp.approvals a ON a.book_id=r.book_id AND a.id=r.approval_id
        WHERE v.id IS NULL OR a.id IS NULL OR r.change_set_id IS DISTINCT FROM v.change_set_id
          OR r.body->>'id' IS DISTINCT FROM r.id OR r.body->>'voucherId' IS DISTINCT FROM r.voucher_id
          OR r.body->>'changeSetId' IS DISTINCT FROM r.change_set_id)
      OR EXISTS(SELECT FROM openerp.change_sets s CROSS JOIN LATERAL jsonb_path_query(s.plan, '$.groups[*].actions[*]') a
        WHERE a->>'kind'='post_voucher' AND (jsonb_typeof(a->'evidenceRefs') IS DISTINCT FROM 'array' OR jsonb_array_length(a->'evidenceRefs')=0)) AS invalid`);

  if (integrity.rows[0]?.invalid !== false)
    refuse(
      "Inline evidence, voucher balance/watermark or execution-receipt links failed recovery controls.",
    );
  let jsonReferences = 0n;
  let relationalReferences = 0n;

  for (const table of tables) {
    const columns = await client.query<{ name: string; json: boolean }>(
      `
      SELECT a.attname AS name, a.atttypid IN ('json'::regtype,'jsonb'::regtype) AS json
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped`,
      [table.schema, table.table],
    );

    if (
      columns.rows.some(
        (column) =>
          /^(object_key|storage_key|blob_key|object_version|storage_version)$/.test(column.name) &&
          !(
            originalsVerified &&
            table.schema === "openerp" &&
            table.table === "intake_contents" &&
            column.name === "object_key"
          ),
      )
    ) {
      refuse(
        "Database object-storage references require a reviewed closure adapter; inline-only recovery cannot omit them.",
      );
    }

    const identifier = `${client.escapeIdentifier(table.schema)}.${client.escapeIdentifier(table.table)}`;

    if (columns.rows.some((column) => column.name === "evidence_id")) {
      if (!columns.rows.some((column) => column.name === "book_id"))
        refuse("Unscoped evidence link is unsupported.");

      const links = await client.query<{
        count: string;
        invalid: boolean;
      }>(`SELECT count(*) FILTER (WHERE r.evidence_id IS NOT NULL)::text AS count,
        EXISTS(SELECT FROM ONLY ${identifier} r
          LEFT JOIN openerp.evidence e ON e.book_id=r.book_id AND e.id=r.evidence_id
          WHERE r.evidence_id IS NOT NULL AND e.id IS NULL) AS invalid FROM ONLY ${identifier} r`);

      if (links.rows[0]?.invalid !== false)
        refuse("A retained relational evidence reference has no original content.");
      relationalReferences += BigInt(links.rows[0]?.count ?? "0");
    }

    for (const column of columns.rows.filter((column) => column.json)) {
      const field = client.escapeIdentifier(column.name);

      // Saved intent needs strict closure when a committed outcome or reserved-key receipt exists.
      // A missing outcome alone is not proof of nonexecution through older kernel endpoints.
      const requiresEvidence =
        table.schema === "openerp" &&
        table.table === "posting_saved_requests" &&
        column.name === "command"
          ? `EXISTS(SELECT FROM openerp.posting_request_outcomes o
              WHERE o.book_id=r.book_id AND o.key=r.key AND o.state IS DISTINCT FROM 'refused')
            OR EXISTS(SELECT FROM openerp.command_receipts c
              WHERE c.book_id=r.book_id AND c.key=r.command_key)`
          : "true";

      const refs = await client.query<{ count: string; invalid: boolean; external: boolean }>(`
        WITH objects AS (SELECT to_jsonb(r)->>'book_id' AS book, (${requiresEvidence}) AS requires_evidence, j.value
          FROM ONLY ${identifier} r CROSS JOIN LATERAL jsonb_path_query(r.${field}::jsonb, '$.** ? (@.type() == "object")') j(value)),
        refs AS (SELECT * FROM objects WHERE value ? 'evidenceId')
        SELECT (SELECT count(*)::text FROM refs) AS count,
          EXISTS(SELECT FROM refs r LEFT JOIN openerp.evidence e ON e.book_id=r.book AND e.id=r.value->>'evidenceId'
            WHERE r.requires_evidence AND (e.id IS NULL OR (r.value ? 'sha256' AND r.value->>'sha256' IS DISTINCT FROM e.sha256)
              OR (r.value ? 'evidenceSha256' AND r.value->>'evidenceSha256' IS DISTINCT FROM e.sha256))) AS invalid,
          EXISTS(SELECT FROM objects WHERE value ?| ARRAY['objectKey','storageKey','blobKey','objectVersion','storageVersion','blobVersion','object_key','storage_key','blob_key','object_version','storage_version','blob_version']) AS external`);

      const result = refs.rows[0];

      if (!result || result.invalid || result.external)
        refuse(
          "JSON evidence closure is missing/mismatched or contains unsupported external object pointers.",
        );
      jsonReferences += BigInt(result.count);
    }
  }

  const reportControl = await client.query<{ invalid: boolean }>(`
    SELECT EXISTS(SELECT FROM openerp.report_snapshots r JOIN openerp.books b ON b.id=r.book_id
      WHERE r.body->>'kind'='trial_balance_v1' AND (r.sequence>b.committed_sequence
        OR (r.body->>'accountCount')::bigint IS DISTINCT FROM (SELECT count(*) FROM openerp.report_lines x WHERE x.book_id=r.book_id AND x.report_id=r.id)
        OR (r.body->>'voucherCount')::bigint IS DISTINCT FROM (SELECT count(*) FROM openerp.vouchers v WHERE v.book_id=r.book_id AND v.sequence<=r.sequence AND v.posting_date BETWEEN r.starts_on AND r.ends_on)
        OR (r.body->>'debitMinor')::numeric IS DISTINCT FROM (SELECT coalesce(sum(l.debit_minor),0) FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id WHERE v.book_id=r.book_id AND v.sequence<=r.sequence AND v.posting_date BETWEEN r.starts_on AND r.ends_on)
        OR (r.body->>'creditMinor')::numeric IS DISTINCT FROM (SELECT coalesce(sum(l.credit_minor),0) FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id WHERE v.book_id=r.book_id AND v.sequence<=r.sequence AND v.posting_date BETWEEN r.starts_on AND r.ends_on))
      OR EXISTS(SELECT FROM openerp.report_lines x JOIN openerp.report_snapshots r ON r.book_id=x.book_id AND r.id=x.report_id
        LEFT JOIN LATERAL (SELECT coalesce(sum(l.debit_minor-l.credit_minor) FILTER(WHERE v.posting_date<r.starts_on),0) AS opening,
          coalesce(sum(l.debit_minor) FILTER(WHERE v.posting_date>=r.starts_on),0) AS debit,
          coalesce(sum(l.credit_minor) FILTER(WHERE v.posting_date>=r.starts_on),0) AS credit
          FROM openerp.journal_lines l JOIN openerp.vouchers v ON v.book_id=l.book_id AND v.id=l.voucher_id
          WHERE v.book_id=r.book_id AND v.sequence<=r.sequence AND v.posting_date<=r.ends_on AND l.account_id=x.account_id) amounts ON true
        WHERE (x.body->>'openingMinor')::numeric IS DISTINCT FROM amounts.opening
          OR (x.body->>'debitMinor')::numeric IS DISTINCT FROM amounts.debit
          OR (x.body->>'creditMinor')::numeric IS DISTINCT FROM amounts.credit
           OR (x.body->>'closingMinor')::numeric IS DISTINCT FROM amounts.opening+amounts.debit-amounts.credit)) AS invalid`);

  if (reportControl.rows[0]?.invalid !== false)
    refuse(
      "Historical trial-balance controls do not reconstruct from their pinned ledger boundary.",
    );

  const counts = await client.query<{ body: unknown }>(
    `
    SELECT jsonb_build_object('evidenceCount',(SELECT count(*)::text FROM openerp.evidence),
      'evidenceBytes',(SELECT coalesce(sum(octet_length(content)),0)::text FROM openerp.evidence),
      'jsonEvidenceReferences',$1::text,'voucherCount',(SELECT count(*)::text FROM openerp.vouchers),
      'executionReceiptCount',(SELECT count(*)::text FROM openerp.execution_receipts),
      'commandReceiptCount',(SELECT count(*)::text FROM openerp.command_receipts),
      'reportCount',(SELECT count(*)::text FROM openerp.report_snapshots),
      'ledgerDebitMinor',(SELECT coalesce(sum(debit_minor),0)::text FROM openerp.journal_lines),
      'ledgerCreditMinor',(SELECT coalesce(sum(credit_minor),0)::text FROM openerp.journal_lines),
      'inlineEvidenceClosure','matched','receiptLinks','matched','historicalReportControls','matched',
      'externalObjects',$2::text) AS body`,
    [
      String(jsonReferences),
      originalsVerified ? "retained-originals-matched" : "unsupported-pointers-refused",
    ],
  );

  const controls = Schema.decodeUnknownSync(RecoveryControls)(counts.rows[0]?.body);

  const evidenceTable = tables.find(
    (table) => table.schema === "openerp" && table.table === "evidence",
  );

  if (!evidenceTable) refuse("The database is missing the owned evidence table.");

  const evidence = Schema.decodeSync(EvidenceInventory)({
    version: 1,
    table: evidenceTable,
    contentBytes: controls.evidenceBytes,
    relationalReferences: relationalReferences.toString(),
    jsonReferences: jsonReferences.toString(),
    integrity: "matched",
    references: "matched",
  });

  const receiptTables = tables.filter((table) => table.table.endsWith("receipts"));

  if (
    !receiptTables.some(
      (table) => table.schema === "openerp" && table.table === "execution_receipts",
    ) ||
    !receiptTables.some((table) => table.schema === "openerp" && table.table === "command_receipts")
  )
    refuse("The database is missing required accounting receipt tables.");

  return {
    controls,
    evidence,
    receipts: Schema.decodeSync(ReceiptInventory)({
      version: 1,
      tables: receiptTables,
      content: "matched",
    }),
  };
}
