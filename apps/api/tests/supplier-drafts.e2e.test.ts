import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import {
  acceptDraft,
  createDraft,
  purchaseEvidence,
  supplierFixture,
} from "./support/supplier-review";
import { decoded, environment, failure, persisted, request } from "./support/fixtures";

test("retained supplier history remains pageable beyond 200 and both duplicate cursor kinds resume", async () => {
  const { book, content } = await supplierFixture();
  const historical: (typeof Drafts.SupplierInvoiceDraftRevision.Type)[] = [];
  const receipts: string[] = [];

  for (let ordinal = 0; ordinal < 201; ordinal += 1) {
    const source = await purchaseEvidence(book, ordinal);

    const draft = await createDraft(book, {
      ...content,
      title: `Historical invoice ${ordinal}`,
      supplierDocumentNumber: `HISTORY-${ordinal}`,
      sourceEvidenceId: source.id,
    });

    const receipt = await acceptDraft(book, draft);
    historical.push(draft);
    receipts.push(receipt.id);
  }

  const first = historical[0]!;
  const second = historical[1]!;

  const active = await createDraft(book, {
    ...content,
    supplierDocumentNumber: first.content.supplierDocumentNumber,
    sourceEvidenceId: second.content.sourceEvidenceId,
  });

  const beforeReads = await persisted(book);
  const path = "/commerce/supplier-invoice-drafts";
  const page = await decoded(await request(book, path), Drafts.SupplierInvoiceDraftList);
  expect(page.items).toHaveLength(200);
  expect(page.count).toBe(200);
  expect(page.complete).toBe(false);
  expect(page.next).not.toBeNull();

  const last = await decoded(
    await request(book, `${path}?after=${page.next}`),
    Drafts.SupplierInvoiceDraftList,
  );

  expect(last.items).toHaveLength(2);
  expect(last.next).toBeNull();
  expect(last.complete).toBe(false);
  expect(new Set([...page.items, ...last.items].map((item) => item.id)).size).toBe(202);

  const history = await decoded(
    await request(book, `${path}/${first.id}/revisions`),
    Drafts.SupplierInvoiceDraftHistory,
  );

  expect(history.items[0]?.digest).toBe(first.digest);
  expect(history.items[0]?.grossMinor).toBe("10000");
  expect(await persisted(book)).toEqual(beforeReads);
  await failure(await request(book, `${path}?q=other&after=${page.next}`), 422, "InvalidJournal");

  // Two retained accepted heads plus 47 new heads yield 49 draft candidates.
  // The first page must therefore emit a registered-invoice anchor as item 50.
  for (let ordinal = 0; ordinal < 47; ordinal += 1) await createDraft(book, active.content);

  const duplicatePath = `${path}/${active.id}/duplicates`;

  const registeredPage = await decoded(
    await request(book, duplicatePath),
    Drafts.SupplierInvoiceDraftDuplicates,
  );

  expect(registeredPage.items).toHaveLength(50);
  expect(registeredPage.next).toMatch(/:r:[a-z][a-z0-9_-]*:0$/);

  const registeredTail = await decoded(
    await request(book, `${duplicatePath}?after=${registeredPage.next}`),
    Drafts.SupplierInvoiceDraftDuplicates,
  );

  expect(registeredTail.items).toHaveLength(1);
  expect(registeredTail.items[0]?.kind).toBe("registered");
  expect(registeredTail.next).toBeNull();

  await createDraft(book, active.content);

  const draftPage = await decoded(
    await request(book, duplicatePath),
    Drafts.SupplierInvoiceDraftDuplicates,
  );

  expect(draftPage.next).toMatch(/:d:[a-z][a-z0-9_-]*:1$/);

  const draftTail = await decoded(
    await request(book, `${duplicatePath}?after=${draftPage.next}`),
    Drafts.SupplierInvoiceDraftDuplicates,
  );

  expect(draftTail.items).toHaveLength(2);
  expect(draftTail.items.every((item) => item.kind === "registered")).toBe(true);

  const allIds = [...draftPage.items, ...draftTail.items].map((item) =>
    item.kind === "draft" ? item.draft.id : item.invoice.id,
  );

  expect(new Set(allIds).size).toBe(52);

  const other = await createDraft(book, active.content);
  await failure(
    await request(book, `${path}/${other.id}/duplicates?after=${draftPage.next}`),
    422,
    "InvalidJournal",
  );
  const malformed = await request(book, `${duplicatePath}?after=sid1:broken`);
  expect(malformed.status).toBe(400);

  const invalidKindRevision = await request(
    book,
    `${duplicatePath}?after=${registeredPage.next?.replace(/:0$/, ":1")}`,
  );

  expect(invalidKindRevision.status).toBe(400);

  const zero = await createDraft(book, {
    ...content,
    title: "Zero summary",
    sourceTotalMinor: "0",
    lines: content.lines.map((line) => ({
      ...line,
      unitPriceMinor: "0",
      baseMinor: "0",
      sourceGrossMinor: "0",
    })),
  });

  const unknown = await createDraft(book, {
    ...content,
    title: "Unknown summary",
    sourceTotalMinor: null,
    lines: content.lines.map((line) => ({ ...line, taxMinor: null, sourceGrossMinor: null })),
  });

  const zeroPage = await decoded(
    await request(book, `${path}?q=Zero%20summary`),
    Drafts.SupplierInvoiceDraftList,
  );

  const unknownPage = await decoded(
    await request(book, `${path}?q=Unknown%20summary`),
    Drafts.SupplierInvoiceDraftList,
  );

  expect(zeroPage.items.map((item) => [item.id, item.grossMinor])).toEqual([[zero.id, "0"]]);
  expect(unknownPage.items.map((item) => [item.id, item.grossMinor])).toEqual([[unknown.id, null]]);

  await writeFile(
    join(environment().artifacts, "supplier-retained-history.json"),
    JSON.stringify(
      {
        bookId: book.bookId,
        acceptedCount: receipts.length,
        receipts,
        pageCounts: [page.count, last.count],
        acceptedHistory: history,
        activeDraft: active.id,
        duplicateCursors: { registered: registeredPage.next, draft: draftPage.next },
        duplicateCount: allIds.length,
        zero: zeroPage.items,
        unknown: unknownPage.items,
      },
      null,
      2,
    ),
  );
}, 240000);
