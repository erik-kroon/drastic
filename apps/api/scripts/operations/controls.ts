import { Client } from "pg";
import * as Schema from "effect/Schema";
import { RecoveryControls, TableFingerprint } from "../../../../packages/contracts/src/operations";
import { refuse } from "./safety";

export async function recoveryControls(
  client: Client,
  tables: ReadonlyArray<typeof TableFingerprint.Type>,
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
  for (const table of tables) {
    const columns = await client.query<{ name: string; json: boolean }>(
      `
      SELECT a.attname AS name, a.atttypid IN ('json'::regtype,'jsonb'::regtype) AS json
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped`,
      [table.schema, table.table],
    );
    if (
      columns.rows.some((column) =>
        /^(object_key|storage_key|blob_key|object_version|storage_version)$/.test(column.name),
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
        invalid: boolean;
      }>(`SELECT EXISTS(SELECT FROM ONLY ${identifier} r
        LEFT JOIN openerp.evidence e ON e.book_id=r.book_id AND e.id=r.evidence_id WHERE r.evidence_id IS NOT NULL AND e.id IS NULL) AS invalid`);
      if (links.rows[0]?.invalid !== false)
        refuse("A retained relational evidence reference has no original content.");
    }
    for (const column of columns.rows.filter((column) => column.json)) {
      const field = client.escapeIdentifier(column.name);
      const refs = await client.query<{ count: string; invalid: boolean; external: boolean }>(`
        WITH objects AS (SELECT to_jsonb(r)->>'book_id' AS book, j.value
          FROM ONLY ${identifier} r CROSS JOIN LATERAL jsonb_path_query(r.${field}::jsonb, '$.** ? (@.type() == "object")') j(value)),
        refs AS (SELECT * FROM objects WHERE value ? 'evidenceId')
        SELECT (SELECT count(*)::text FROM refs) AS count,
          EXISTS(SELECT FROM refs r LEFT JOIN openerp.evidence e ON e.book_id=r.book AND e.id=r.value->>'evidenceId'
            WHERE e.id IS NULL OR (r.value ? 'sha256' AND r.value->>'sha256' IS DISTINCT FROM e.sha256)
              OR (r.value ? 'evidenceSha256' AND r.value->>'evidenceSha256' IS DISTINCT FROM e.sha256)) AS invalid,
          EXISTS(SELECT FROM objects WHERE value ?| ARRAY['objectKey','storageKey','blobKey','objectVersion','storageVersion','object_key','storage_key','blob_key']) AS external`);
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
      WHERE r.sequence>b.committed_sequence OR r.body->>'kind' IS DISTINCT FROM 'trial_balance_v1'
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
          OR (x.body->>'closingMinor')::numeric IS DISTINCT FROM amounts.opening+amounts.debit-amounts.credit) AS invalid`);
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
      'externalObjects','unsupported-pointers-refused') AS body`,
    [String(jsonReferences)],
  );
  return Schema.decodeUnknownSync(RecoveryControls)(counts.rows[0]?.body);
}
