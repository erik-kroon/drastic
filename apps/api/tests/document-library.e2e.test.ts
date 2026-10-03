import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Source from "@open-erp/contracts/source-intake";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as Tax from "@open-erp/contracts/expense-tax";
import { acceptDraft, createDraft, supplierFixture } from "./support/supplier-review";
import {
  database,
  decoded,
  environment,
  failure,
  fixture,
  key,
  persisted,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";

const Fact = Schema.Struct({
  ownerKind: Schema.String,
  ownerId: Schema.String,
  revision: Schema.String,
  digest: Schema.String,
  currentSource: Schema.Boolean,
  basis: Schema.String,
  supplierId: Schema.NullOr(Schema.String),
  supplierName: Schema.NullOr(Schema.String),
  documentDate: Schema.NullOr(Schema.String),
  currency: Schema.NullOr(Schema.String),
  currencyScale: Schema.NullOr(Schema.Int),
  grossMinor: Schema.NullOr(Schema.String),
  invoiceId: Schema.NullOr(Schema.String),
  voucherId: Schema.NullOr(Schema.String),
});

const Page = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      ...Source.SourceOccurrence.fields,
      facts: Schema.Array(Fact),
      suggestions: Schema.Array(Schema.JsonObject),
      originalAvailability: Schema.Literal("not_checked"),
    }),
  ),
  nextCursor: Schema.NullOr(Schema.String),
  retainedCutoff: Schema.String,
  metadataConsistency: Schema.Literal("live_owner_revisions"),
});

function search(book: BookFixture, filters: Record<string, string> = {}) {
  return request(book, `/source-archive?${new URLSearchParams(filters)}`).then((response) =>
    decoded(response, Page),
  );
}

function retain(book: BookFixture, occurrenceKey: string = key(), filename = "library.csv") {
  return post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "library",
      sourceAccountId: "synthetic_source",
      occurrenceKey,
      sourceRevision: "1",
      filename,
      mediaType: "text/csv",
      contentBase64: Buffer.from("retained synthetic original\n").toString("base64"),
    },
    Source.SourceOccurrence,
  );
}

function reference(
  book: BookFixture,
  occurrence: typeof Source.SourceOccurrence.Type,
  kind = "supplier_invoice_source_v1",
  sha256 = occurrence.sha256,
) {
  return post(
    book,
    "/evidence",
    {
      title: "Document reference",
      mediaType: "application/json",
      origin: "Synthetic library fixture",
      content: JSON.stringify({ kind, source: { occurrenceId: occurrence.id, sha256 } }),
    },
    Accounting.Evidence,
  );
}

test("P05 search derives qualified current and historical facts with exact same-fact filters", async () => {
  const { book, supplier, content } = await supplierFixture();
  const first = await retain(book);
  const sameBytes = await retain(book);
  const ref = await reference(book, first);
  const huge = "9007199254740993";

  const hugeContent = {
    ...content,
    sourceEvidenceId: ref.id,
    sourceTotalMinor: huge,
    lines: content.lines.map((line) => ({
      ...line,
      unitPriceMinor: huge,
      baseMinor: huge,
      sourceGrossMinor: huge,
    })),
  };

  const hugeDraft = await createDraft(book, hugeContent);

  const ordinary = await createDraft(book, {
    ...content,
    sourceEvidenceId: ref.id,
    documentDate: "2026-08-01",
  });

  const accepted = await acceptDraft(book, ordinary);
  const unknown = await reference(book, sameBytes, "expense_entry_v1");

  const expense = await post(
    book,
    "/expense-tax/sources",
    {
      sourceKey: key(),
      expectedSourceDigest: null,
      facts: {
        evidenceId: unknown.id,
        sourceLocator: "original",
        description: "Unknown original facts",
        recordClass: "synthetic",
        amounts: { grossMinor: null, netMinor: null, vatMinor: null },
        currency: null,
        currencyScale: null,
        supplierJurisdiction: null,
        supplyJurisdiction: null,
        issuedOn: null,
        receivedOn: null,
        suppliedOn: null,
        taxPointOn: null,
        changeSetId: null,
        voucherId: null,
      },
    },
    Tax.TaxSourceRevision,
  );

  const wrongCurrency = await post(
    book,
    "/expense-tax/sources",
    {
      sourceKey: key(),
      expectedSourceDigest: null,
      facts: {
        ...expense.facts,
        evidenceId: ref.id,
        currency: "EUR",
        currencyScale: 2,
        amounts: { grossMinor: huge, netMinor: null, vatMinor: null },
      },
    },
    Tax.TaxSourceRevision,
  );

  for (const bad of [
    "not JSON " + first.id,
    JSON.stringify(
      JSON.stringify({
        kind: "supplier_invoice_source_v1",
        source: { occurrenceId: first.id, sha256: first.sha256 },
      }),
    ),
    JSON.stringify([
      {
        kind: "supplier_invoice_source_v1",
        source: { occurrenceId: first.id, sha256: first.sha256 },
      },
    ]),
    "{malformed " + first.id,
    '{"kind":"supplier_invoice_source_v1","ignored":"\\u0000"}',
    '{"kind":"supplier_invoice_source_v1","ignored":"\\ud800"}',
    JSON.stringify({ kind: "unknown", source: { occurrenceId: first.id, sha256: first.sha256 } }),
    JSON.stringify({
      kind: "supplier_invoice_source_v1",
      source: { occurrenceId: first.id, sha256: "sha256:" + "0".repeat(64) },
    }),
  ]) {
    const evidence = await post(
      book,
      "/evidence",
      { title: "Unqualified claim", content: bad, mediaType: "text/plain", origin: "Synthetic" },
      Accounting.Evidence,
    );

    await createDraft(book, { ...content, sourceEvidenceId: evidence.id });
  }

  const before = await persisted(book);
  const exact = { supplierId: supplier.id, amountMinor: huge, currency: "SEK", currencyScale: "2" };
  const page = await search(book, exact);
  expect(page.items.map((row) => row.id)).toEqual([first.id]);
  expect(page.items[0]?.facts.filter((fact) => fact.ownerId === hugeDraft.id)).toEqual([
    expect.objectContaining({
      revision: "1",
      digest: hugeDraft.digest,
      basis: "entered_draft",
      currentSource: true,
      supplierId: supplier.id,
      supplierName: "Architecture review supplier",
      documentDate: "2026-09-22",
      currency: "SEK",
      currencyScale: 2,
      grossMinor: huge,
      invoiceId: null,
      voucherId: null,
    }),
  ]);
  expect(
    page.items[0]?.facts.some(
      (fact) => fact.ownerId === wrongCurrency.sourceId && fact.currency === "EUR",
    ),
  ).toBe(true);
  expect(page.items[0]?.facts.filter((fact) => fact.ownerId === ordinary.id)).toEqual([
    expect.objectContaining({
      basis: "registered_invoice",
      revision: "1",
      invoiceId: accepted.registerInvoiceId,
      voucherId: expect.any(String),
    }),
  ]);
  expect((await search(book, { ...exact, documentTo: "2026-08-01" })).items).toEqual([]);
  expect(
    (await search(book, { q: "Architecture review supplier" })).items.map((row) => row.id),
  ).toEqual([first.id]);
  expect(
    (await search(book, { documentFrom: "2026-09-22", documentTo: "2026-09-22" })).items.map(
      (row) => row.id,
    ),
  ).toEqual([first.id]);
  expect((await search(book, { retainedTo: "2026-09-22" })).items).toEqual([]);
  expect((await search(book, { occurrenceId: first.id })).items.map((row) => row.id)).toEqual([
    first.id,
  ]);
  const unrelatedBook = await fixture();
  expect((await search(unrelatedBook, { occurrenceId: first.id })).items).toEqual([]);
  const all = await search(book);
  expect(all.items).toHaveLength(2);
  expect(all.items.find((row) => row.id === sameBytes.id)?.facts).toEqual([
    expect.objectContaining({
      ownerKind: "expense_source",
      ownerId: expense.sourceId,
      basis: "entered_expense",
      supplierId: null,
      supplierName: null,
      grossMinor: null,
      documentDate: null,
      currency: null,
      currencyScale: null,
      voucherId: null,
    }),
  ]);

  const reviewed = await post(
    book,
    `/expense-tax/sources/${expense.sourceId}/reviews`,
    {
      sourceDigest: expense.digest,
      expectedReviewDigest: null,
      facts: {
        evidenceId: unknown.id,
        rationale: "Review exact expense amount",
        amounts: { grossMinor: "7000", netMinor: null, vatMinor: null },
        registration: "unknown",
        registrationEvidenceId: null,
        method: "unknown",
        methodEvidenceId: null,
        bookJurisdiction: "SE",
        suppliedOn: null,
        taxPointOn: null,
        dateBasis: null,
        dateEvidenceId: null,
        treatment: "unknown",
        profileId: null,
        profileVersion: null,
        rateNumerator: null,
        rateDenominator: null,
        deductionNumerator: null,
        deductionDenominator: null,
        deductionBasis: null,
        deductionEvidenceId: null,
        roundingPolicy: "unknown",
      },
    },
    Tax.TaxReview,
  );

  const reviewedPage = await search(book);
  const expenseFacts = reviewedPage.items.find((row) => row.id === sameBytes.id)?.facts;
  expect(expenseFacts).toContainEqual(
    expect.objectContaining({ basis: "entered_expense", grossMinor: null }),
  );
  expect(expenseFacts).toContainEqual(
    expect.objectContaining({
      basis: "reviewed_expense",
      grossMinor: "7000",
      ownerId: expense.sourceId,
      revision: "1",
      digest: expense.digest,
    }),
  );
  const fullReviewed = await decoded(await request(book, "/source-archive"), Source.ArchiveSearch);
  expect(
    fullReviewed.items
      .find((row) => row.id === sameBytes.id)
      ?.facts.find((fact) => fact.basis === "reviewed_expense"),
  ).toMatchObject({
    reviewId: reviewed.id,
    reviewRevision: "1",
    reviewDigest: reviewed.digest,
    reviewedAt: reviewed.recordedAt,
  });
  const replacement = await reference(book, sameBytes);
  await post(
    book,
    `/commerce/supplier-invoice-drafts/${hugeDraft.id}/revisions`,
    {
      expectedRevision: hugeDraft.revision,
      expectedDigest: hugeDraft.digest,
      content: { ...hugeContent, sourceEvidenceId: replacement.id },
      reason: "Replace source",
    },
    Drafts.SupplierInvoiceDraftRevision,
  );
  const replaced = await search(book, exact);
  expect(replaced.items.map((row) => row.id)).toEqual([sameBytes.id]);
  expect(
    (await search(book, { filename: "library.csv" })).items.find((row) => row.id === first.id)
      ?.facts,
  ).toContainEqual(
    expect.objectContaining({ ownerId: hugeDraft.id, revision: "1", currentSource: false }),
  );

  const exported = await decoded(
    await request(book, `/source-archive/export?${new URLSearchParams(exact)}`),
    Source.ArchiveExport,
  );

  expect(exported.items.map((row) => row.occurrence.id)).toEqual([sameBytes.id]);
  expect(Buffer.from(exported.items[0]!.contentBase64, "base64").toString()).toBe(
    "retained synthetic original\n",
  );
  expect(await persisted(book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "document-library-journey.json"),
    JSON.stringify(
      { first, sameBytes, page, all, replaced, exported, noFinancialReadEffects: true },
      null,
      2,
    ),
  );
});

test("P05 cursor captures membership, validates scope and anchor, and scales to 10000 originals", async () => {
  const startedAt = performance.now();
  const stages: { name: string; elapsedMs: number }[] = [];

  const stage = async (name: string) => {
    stages.push({ name, elapsedMs: performance.now() - startedAt });
    await writeFile(
      join(environment().artifacts, "performance-stages.json"),
      JSON.stringify(stages, null, 2),
    );
  };

  await stage("started");
  const { book, content } = await supplierFixture();
  const original = await retain(book, "seed", "performance.csv");
  const seedReference = await reference(book, original);
  const seedDraft = await createDraft(book, { ...content, sourceEvidenceId: seedReference.id });
  await stage("public_owner_fixture_ready");
  const admin = await database();

  try {
    await admin.query(
      `insert into openerp.intake_occurrences (book_id,id,sha256,source_system,source_account_id,occurrence_key,source_revision,body)
      select $1,'library_' || lpad(n::text,6,'0'),$2,'library','synthetic_source','bulk_' || n,'1',
        $3::jsonb || jsonb_build_object('id','library_' || lpad(n::text,6,'0'),'occurrenceKey','bulk_' || n)
      from generate_series(1,9999) n`,
      [book.bookId, original.sha256, original],
    );
    await stage("occurrences_ready");
    await admin.query("BEGIN");
    await admin.query(
      `insert into openerp.evidence (book_id,id,title,content,media_type,origin,sha256,created_by)
      select $1,'library_evidence_' || n,'Synthetic bulk reference',reference,'application/json','Synthetic performance fixture',
        encode(sha256(convert_to(reference,'UTF8')),'hex'),$3
      from (select n,jsonb_build_object('kind','supplier_invoice_source_v1','source',
        jsonb_build_object('occurrenceId','library_' || lpad(n::text,6,'0'),'sha256',$2::text))::text as reference
        from generate_series(1,9999) n) fixture`,
      [book.bookId, original.sha256, book.actorId],
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
      [book.bookId, seedDraft],
    );
    await admin.query("COMMIT");
    await stage("supplier_revisions_ready");

    for (const table of [
      "intake_occurrences",
      "evidence",
      "supplier_invoice_drafts",
      "supplier_invoice_draft_revisions",
    ]) {
      await admin.query(`ANALYZE openerp.${table}`);
    }

    await stage("fixture_statistics_ready");
  } finally {
    await admin.end();
  }

  const before = await persisted(book);
  expect((await search(book, { occurrenceId: original.id })).items[0]?.facts).toHaveLength(1);
  const first = await search(book, { filename: "performance.csv" });
  await stage("first_archive_page");
  expect(first.items).toHaveLength(10);
  expect(first.nextCursor).not.toBeNull();
  const uploaded = await retain(book, "new_after_capture", "performance.csv");
  const lateId = "library_000015a";
  const lateFixture = await database();

  try {
    await lateFixture.query(
      `insert into openerp.intake_occurrences (book_id,id,sha256,source_system,source_account_id,occurrence_key,source_revision,body)
      values ($1,$2,$3,'library','synthetic_source','late_interleaved','1',
        $4::jsonb || jsonb_build_object('id',$2::text,'occurrenceKey','late_interleaved'))`,
      [book.bookId, lateId, uploaded.sha256, uploaded],
    );
  } finally {
    await lateFixture.end();
  }

  const ids = first.items.map((row) => row.id);
  let cursor = first.nextCursor;

  while (cursor && ids.length < 100) {
    const page = await search(book, { filename: "performance.csv", cursor });
    expect(page.retainedCutoff).toBe(first.retainedCutoff);
    ids.push(...page.items.map((row) => row.id));
    cursor = page.nextCursor;
  }

  await stage("100_source_traversal");
  expect(new Set(ids).size).toBe(100);
  expect(ids).not.toContain(uploaded.id);
  expect(ids).not.toContain(lateId);
  const refreshed = await search(book, { filename: "performance.csv" });
  expect(
    (await search(book, { filename: "performance.csv", cursor: refreshed.nextCursor! })).items.map(
      (row) => row.id,
    ),
  ).toContain(lateId);
  await failure(
    await request(book, `/source-archive?filename=changed&cursor=${first.nextCursor}`),
    422,
    "InvalidJournal",
  );
  const foreign = await fixture();
  await failure(
    await request(foreign, `/source-archive?filename=performance.csv&cursor=${first.nextCursor}`),
    422,
    "InvalidJournal",
  );
  expect((await request(book, "/source-archive?cursor=occurrence_missing")).status).toBe(400);
  await failure(await request(book, "/source-archive?amountMinor=10000"), 422, "InvalidJournal");
  const encoded = first.nextCursor!.slice(5);

  const traversal = Schema.decodeSync(
    Schema.fromJsonString(
      Schema.Struct({ context: Schema.String, cutoff: Schema.String, after: Schema.String }),
    ),
  )(Buffer.from(encoded, "base64url").toString());

  const forged =
    "arc1:" +
    Buffer.from(JSON.stringify({ ...traversal, after: "occurrence_missing" })).toString(
      "base64url",
    );

  await failure(
    await request(book, `/source-archive?filename=performance.csv&cursor=${forged}`),
    422,
    "InvalidJournal",
  );

  const future =
    "arc1:" +
    Buffer.from(JSON.stringify({ ...traversal, cutoff: "2070-01-01T00:00:00.000Z" })).toString(
      "base64url",
    );

  await failure(
    await request(book, `/source-archive?filename=performance.csv&cursor=${future}`),
    422,
    "InvalidJournal",
  );
  await failure(
    await request({ ...book, token: foreign.token }, "/source-archive"),
    403,
    "Forbidden",
  );
  const grants = await database();

  try {
    await grants.query("REVOKE SELECT ON openerp.intake_occurrences FROM openerp_runtime");
    await failure(await request(book, "/source-archive"), 422, "UnsupportedProfile");
  } finally {
    await grants.query("GRANT SELECT ON openerp.intake_occurrences TO openerp_runtime");
    await grants.end();
  }

  await stage("scope_and_cursor_refusals");
  const latencyMs: number[] = [];

  for (let sample = 0; sample < 35; sample += 1) {
    const start = performance.now();
    await search(book, {
      q: "Architecture review supplier",
      amountMinor: "10000",
      currency: "SEK",
      currencyScale: "2",
    });

    if (sample >= 5) latencyMs.push(performance.now() - start);
    await stage(`timing_sample_${sample}`);
  }

  const sorted = [...latencyMs].sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
  expect(p95).toBeLessThan(1000);
  expect(await persisted(book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "performance.json"),
    JSON.stringify(
      {
        fixtureOccurrences: 10002,
        fixtureSupplierRevisions: 10000,
        warmups: 5,
        latencyMs,
        p50: sorted[14],
        p95,
        surface: "public HTTP metadata archive",
        ids,
        cursor,
      },
      null,
      2,
    ),
  );
}, 60000);

test("P05 suggestions stay unreviewed, missing originals fail opening, and oversized facts refuse whole pages", async () => {
  const { book, content } = await supplierFixture();
  const original = await retain(book, "suggestion", "suggestion.csv");
  await post(
    book,
    "/commerce/supplier-inbox",
    { occurrenceId: original.id, channel: "upload", messageIdentity: null },
    Schema.JsonObject,
  );
  const admin = await database();
  const attemptId = "library_attempt";
  const attemptedAt = "2026-09-22T00:00:00.000Z";
  const outputHash = "sha256:" + "1".repeat(64);

  try {
    await admin.query(
      `insert into openerp.supplier_extraction_attempts (book_id,id,occurrence_id,ordinal,body)
      values ($1,$2,$3,1,$4)`,
      [
        book.bookId,
        attemptId,
        original.id,
        {
          id: attemptId,
          occurrenceId: original.id,
          sourceHash: original.sha256,
          createdAt: attemptedAt,
          engineRelease: "native-text-v1",
          status: "succeeded",
          retainedOutputHash: outputHash,
          extraction: {
            fields: [
              { lineOrdinal: 0, fieldKey: "title", proposedValue: "Raw OCR only" },
              { lineOrdinal: 0, fieldKey: "sourceTotalMinor", proposedValue: "9999" },
            ],
          },
        },
      ],
    );
    await admin.query("BEGIN");
    await admin.query("SET LOCAL session_replication_role = replica");
    await admin.query(
      `update openerp.intake_contents set bytes=null,object_key=$3,byte_length=$4
      where book_id=$1 and sha256=$2`,
      [
        book.bookId,
        original.sha256,
        `v1/${book.bookId}/${original.sha256.slice(7)}`,
        original.byteLength,
      ],
    );
    await admin.query("COMMIT");
  } finally {
    await admin.end();
  }

  const page = await decoded(await request(book, "/source-archive"), Source.ArchiveSearch);
  expect(page.items[0]?.originalAvailability).toBe("not_checked");
  expect(page.items[0]?.facts).toEqual([]);
  expect(page.items[0]?.suggestions).toEqual([
    {
      basis: "unreviewed_extraction",
      attemptId,
      revision: "1",
      sourceHash: original.sha256,
      createdAt: attemptedAt,
      engineRelease: "native-text-v1",
      result: "succeeded",
      retainedOutputHash: outputHash,
      fields: [
        { lineOrdinal: 0, fieldKey: "title", proposedValue: "Raw OCR only" },
        { lineOrdinal: 0, fieldKey: "sourceTotalMinor", proposedValue: "9999" },
      ],
    },
  ]);
  expect((await search(book, { q: "Raw OCR only" })).items).toEqual([]);
  expect(
    (await search(book, { amountMinor: "9999", currency: "SEK", currencyScale: "2" })).items,
  ).toEqual([]);
  await failure(await request(book, `/source-occurrences/${original.id}`), 422, "MissingEvidence");
  await failure(await request(book, "/source-archive/export"), 422, "MissingEvidence");
  const ref = await reference(book, original);
  const seed = await createDraft(book, { ...content, sourceEvidenceId: ref.id });
  const cardinality = await database();

  try {
    await cardinality.query("BEGIN");
    await cardinality.query(
      `insert into openerp.supplier_invoice_drafts (book_id,id,draft_key,current_revision)
      select $1,'cardinality_' || n,'cardinality_' || n,1 from generate_series(1,1000) n`,
      [book.bookId],
    );
    await cardinality.query(
      `insert into openerp.supplier_invoice_draft_revisions (book_id,draft_id,revision,body)
      select $1,'cardinality_' || n,1,body || jsonb_build_object('digest',openerp.digest(body - 'digest'))
      from (select n,$2::jsonb || jsonb_build_object('id','cardinality_' || n,'draftKey','cardinality_' || n) as body
      from generate_series(1,1000) n) fixture`,
      [book.bookId, seed],
    );
    await cardinality.query("COMMIT");
  } finally {
    await cardinality.end();
  }

  await failure(await request(book, "/source-archive"), 422, "UnsupportedProfile");
  await writeFile(
    join(environment().artifacts, "document-library-unavailable-and-bounds.json"),
    JSON.stringify(
      {
        original,
        page,
        missingOriginal: "MissingEvidence",
        linkedFacts: 1001,
        oversizedResult: "UnsupportedProfile",
      },
      null,
      2,
    ),
  );
});
