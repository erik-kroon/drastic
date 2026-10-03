import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Source from "@open-erp/contracts/source-intake";
import * as Workspace from "@open-erp/contracts/workspace";
import { database, decoded, environment, fixture, post, request } from "./support/fixtures";

test("document attention has bounded response latency over ten thousand acquired originals", async () => {
  const book = await fixture();

  const original = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "scale_fixture",
      sourceAccountId: "synthetic_supplier",
      occurrenceKey: "first",
      sourceRevision: "1",
      filename: "source.csv",
      mediaType: "text/csv",
      contentBase64: Buffer.from("description,amount\nSynthetic,1\n").toString("base64"),
      destination: "supplier_inbox",
    },
    Source.SourceOccurrence,
  );

  const admin = await database();

  try {
    await admin.query(
      `
      with added as (
        insert into openerp.intake_occurrences
          (book_id,id,sha256,source_system,source_account_id,occurrence_key,source_revision,body)
        select original.book_id, 'scale_original_' || n, original.sha256,
          original.source_system, original.source_account_id, 'scale_' || n,
          original.source_revision,
          original.body || jsonb_build_object('id','scale_original_' || n,'occurrenceKey','scale_' || n)
        from openerp.intake_occurrences original cross join generate_series(2,10000) n
        where original.book_id=$1 and original.id=$2
        returning book_id,id
      )
      insert into openerp.supplier_inbox(book_id,occurrence_id,channel)
      select book_id,id,'upload' from added
    `,
      [book.bookId, original.id],
    );
    await admin.query("ANALYZE openerp.intake_occurrences");
    await admin.query("ANALYZE openerp.supplier_inbox");
  } finally {
    await admin.end();
  }

  const durationsMs: number[] = [];

  for (let trial = 0; trial < 35; trial++) {
    const start = performance.now();

    const page = await decoded(
      await request(book, "/attention?kind=document"),
      Workspace.AttentionPage,
    );

    expect(page.total).toBe("10000");
    expect(page.items).toHaveLength(50);
    expect(page.next).not.toBeNull();
    expect(page.counts).toEqual({ open: "10000", completed: "0" });

    if (trial >= 5) durationsMs.push(performance.now() - start);
  }

  const ordered = durationsMs.toSorted((left, right) => left - right);
  const p50Ms = ordered[14];
  const p95Ms = ordered[28];

  await writeFile(
    join(environment().artifacts, "document-attention-scale.json"),
    JSON.stringify(
      {
        count: 10000,
        setup:
          "One public retained source and 9999 isolated synthetic occurrence/inbox rows sharing its bytes; measures reads, not upload throughput",
        warmups: 5,
        durationsMs,
        p50Ms,
        p95Ms,
        ceilingMs: 1000,
        comparison: "New document population; no pre-feature document attention baseline exists",
      },
      null,
      2,
    ),
  );
  expect(p95Ms).toBeLessThanOrEqual(1000);
}, 60000);
