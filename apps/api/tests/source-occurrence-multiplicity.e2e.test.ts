import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import * as Source from "@open-erp/contracts/source-intake";
import * as Inbox from "@open-erp/contracts/supplier-inbox";
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
} from "./support/fixtures";

test("DF-02 identical originals retain distinct supplier acquisitions while source retry converges", async () => {
  const book = await fixture();
  const before = await persisted(book);
  const bytes = Buffer.from("supplier,document,total\nsynthetic,INV-A,100.00\n");

  const metadata = {
    sourceSystem: "synthetic_supplier",
    sourceAccountId: "supplier_source",
    sourceRevision: "1",
    filename: "identical.csv",
    mediaType: "text/csv",
    contentBase64: bytes.toString("base64"),
  };

  const firstInput = { ...metadata, occurrenceKey: "acquisition_one" };
  const firstKey = key();

  const first = await decoded(
    await request(book, "/source-occurrences", {
      method: "POST",
      headers: { "idempotency-key": firstKey },
      body: JSON.stringify(firstInput),
    }),
    Source.SourceOccurrence,
  );

  const second = await post(
    book,
    "/source-occurrences",
    { ...metadata, occurrenceKey: "acquisition_two" },
    Source.SourceOccurrence,
  );

  expect(second.id).not.toBe(first.id);
  expect(second.sha256).toBe(first.sha256);

  const replay = await decoded(
    await request(book, "/source-occurrences", {
      method: "POST",
      headers: { "idempotency-key": firstKey },
      body: JSON.stringify(firstInput),
    }),
    Source.SourceOccurrence,
  );

  expect(replay).toEqual(first);
  const sourceRetry = await post(book, "/source-occurrences", firstInput, Source.SourceOccurrence);
  expect(sourceRetry.id).toBe(first.id);

  const firstInbox = await post(
    book,
    "/commerce/supplier-inbox",
    { occurrenceId: first.id, channel: "upload", messageIdentity: null },
    Inbox.SupplierInboxView,
  );

  const secondInbox = await post(
    book,
    "/commerce/supplier-inbox",
    { occurrenceId: second.id, channel: "upload", messageIdentity: null },
    Inbox.SupplierInboxView,
  );

  expect(firstInbox.occurrence.occurrence.occurrenceKey).toBe("acquisition_one");
  expect(secondInbox.occurrence.occurrence.occurrenceKey).toBe("acquisition_two");

  const inventory = await decoded(
    await request(book, "/commerce/supplier-inbox"),
    Inbox.SupplierInboxPage,
  );

  expect(inventory.items.map((item) => item.occurrence.occurrence.id)).toEqual(
    expect.arrayContaining([first.id, second.id]),
  );
  expect(inventory.items).toHaveLength(2);
  const originals = [];

  for (const occurrence of [first, second]) {
    const original = await decoded(
      await request(book, `/source-occurrences/${occurrence.id}`),
      Source.SourceOccurrenceView,
    );

    expect(Buffer.from(original.contentBase64, "base64")).toEqual(bytes);
    originals.push(original);
  }

  await failure(
    await request(book, "/source-occurrences", {
      method: "POST",
      body: JSON.stringify({
        ...firstInput,
        contentBase64: Buffer.from("different retained bytes").toString("base64"),
      }),
    }),
    409,
    "IdempotencyConflict",
  );
  const admin = await database();

  try {
    const contents = await admin.query(
      "select count(*)::int as count from openerp.intake_contents where book_id=$1",
      [book.bookId],
    );

    const occurrences = await admin.query(
      "select count(*)::int as count from openerp.intake_occurrences where book_id=$1",
      [book.bookId],
    );

    expect(contents.rows).toEqual([{ count: 1 }]);
    expect(occurrences.rows).toEqual([{ count: 2 }]);
  } finally {
    await admin.end();
  }

  const response = await fetch(`${environment().baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${book.agentToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "supplier_inbox_list",
        arguments: { scope: { entityId: book.entityId, bookId: book.bookId } },
      },
    }),
  });

  expect(response.status).toBe(200);

  const rpc = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({
        isError: Schema.Literal(false),
        structuredContent: Schema.Struct({ result: Inbox.SupplierInboxPage }),
      }),
    }),
  )(await response.json());

  expect(rpc.result.structuredContent.result).toEqual(inventory);
  expect(await persisted(book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "df-02-occurrence-multiplicity.json"),
    JSON.stringify(
      {
        first,
        second,
        replay,
        sourceRetry,
        inventory,
        originals,
        mcp: rpc,
        contentObjects: 1,
        sourceOccurrences: 2,
        noFinancialEffects: true,
      },
      null,
      2,
    ),
  );
});
