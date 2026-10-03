import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arch, platform, totalmem } from "node:os";
import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import * as Source from "@open-erp/contracts/source-intake";
import * as Accounting from "@open-erp/contracts/accounting";
import { supplierFixture, createDraft } from "./support/supplier-review";
import { database, decoded, environment, post, request } from "./support/fixtures";

const Page = Schema.Struct({
  items: Schema.Array(Source.SourceOccurrence),
  nextCursor: Schema.NullOr(Schema.String),
});

test("P05 comparable exact-filename archive latency over 10000 retained supplier originals", async () => {
  const { book, content } = await supplierFixture();

  const occurrence = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "archive_performance",
      sourceAccountId: "synthetic_supplier",
      occurrenceKey: "seed",
      sourceRevision: "1",
      filename: "performance.csv",
      mediaType: "text/csv",
      contentBase64: Buffer.from("synthetic original\n").toString("base64"),
    },
    Source.SourceOccurrence,
  );

  const reference = await post(
    book,
    "/evidence",
    {
      title: "Performance original",
      mediaType: "application/json",
      origin: "Synthetic fixture",
      content: JSON.stringify({
        kind: "supplier_invoice_source_v1",
        source: { occurrenceId: occurrence.id, sha256: occurrence.sha256 },
      }),
    },
    Accounting.Evidence,
  );

  const draft = await createDraft(book, { ...content, sourceEvidenceId: reference.id });
  const admin = await database();

  try {
    await admin.query(
      `insert into openerp.intake_occurrences (book_id,id,sha256,source_system,source_account_id,occurrence_key,source_revision,body)
      select $1,'library_' || lpad(n::text,6,'0'),$2,'archive_performance','synthetic_supplier','bulk_' || n,'1',
        $3::jsonb || jsonb_build_object('id','library_' || lpad(n::text,6,'0'),'occurrenceKey','bulk_' || n)
      from generate_series(1,9999) n`,
      [book.bookId, occurrence.sha256, occurrence],
    );
    await admin.query("BEGIN");
    await admin.query(
      `insert into openerp.evidence (book_id,id,title,content,media_type,origin,sha256,created_by)
      select $1,'library_evidence_' || n,'Synthetic reference',reference,'application/json','Synthetic fixture',
        encode(sha256(convert_to(reference,'UTF8')),'hex'),$3
      from (select n,jsonb_build_object('kind','supplier_invoice_source_v1','source',
        jsonb_build_object('occurrenceId','library_' || lpad(n::text,6,'0'),'sha256',$2::text))::text as reference
        from generate_series(1,9999) n) fixture`,
      [book.bookId, occurrence.sha256, book.actorId],
    );
    await admin.query(
      `insert into openerp.supplier_invoice_drafts (book_id,id,draft_key,current_revision)
      select $1,'library_draft_' || n,'library_draft_' || n,1 from generate_series(1,9999) n`,
      [book.bookId],
    );
    await admin.query(
      `insert into openerp.supplier_invoice_draft_revisions (book_id,draft_id,revision,body)
      select $1,'library_draft_' || n,1,body || jsonb_build_object('digest',openerp.digest(body - 'digest'))
      from (select n,$2::jsonb || jsonb_build_object('id','library_draft_' || n,'draftKey','library_draft_' || n,
        'content',($2::jsonb->'content') || jsonb_build_object('sourceEvidenceId','library_evidence_' || n)) as body
      from generate_series(1,9999) n) fixture`,
      [book.bookId, draft],
    );
    await admin.query("COMMIT");

    for (const table of [
      "intake_occurrences",
      "evidence",
      "supplier_invoice_drafts",
      "supplier_invoice_draft_revisions",
    ]) {
      await admin.query(`ANALYZE openerp.${table}`);
    }

    if (process.env.OPENERP_ARCHIVE_EXPLAIN === "1") {
      await admin.query("ALTER ROLE e2e_runtime SET session_preload_libraries = 'auto_explain'");
      await admin.query("ALTER ROLE e2e_runtime SET auto_explain.log_min_duration = 0");
      await admin.query("ALTER ROLE e2e_runtime SET auto_explain.log_analyze = on");
      await admin.query("ALTER ROLE e2e_runtime SET auto_explain.log_buffers = on");
      await admin.query("ALTER ROLE e2e_runtime SET auto_explain.log_timing = on");
      await admin.query("ALTER ROLE e2e_runtime SET auto_explain.log_format = 'json'");
    }
  } finally {
    await admin.end();
  }

  const trials: number[] = [];

  for (let sample = 0; sample < 35; sample += 1) {
    const started = performance.now();

    const page = await decoded(
      await request(book, "/source-archive?filename=performance.csv"),
      Page,
    );

    expect(page.items.map((row) => row.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `library_${String(index + 1).padStart(6, "0")}`),
    );

    if (sample >= 5) trials.push(performance.now() - started);
  }

  const ordered = [...trials].sort((left, right) => left - right);
  const p95 = ordered[28]!;
  const baseline = process.env.OPENERP_ARCHIVE_BASELINE_P95_MS;
  const baselineP95 = baseline === undefined ? null : Number(baseline);

  if (baselineP95 !== null) expect(Number.isFinite(baselineP95) && baselineP95 > 0).toBe(true);
  const budget = baselineP95 === null ? null : Math.max(baselineP95 * 1.2, baselineP95 + 50);
  await writeFile(
    join(environment().artifacts, "filename-archive-performance.json"),
    JSON.stringify(
      {
        fixtureOccurrences: 10000,
        fixtureSupplierRevisions: 10000,
        statistics: "explicit ANALYZE",
        warmups: 5,
        trials,
        p50: ordered[14],
        p95,
        baselineP95,
        budget,
        machine: {
          platform: platform(),
          arch: arch(),
          totalMemoryBytes: totalmem(),
          node: process.version,
        },
        surface: "public HTTP exact filename archive",
        baselineStatus: budget === null ? "not_compared" : "compared",
      },
      null,
      2,
    ),
  );

  if (budget !== null) expect(p95).toBeLessThanOrEqual(budget);
}, 60000);
