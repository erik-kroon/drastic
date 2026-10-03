import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Sales from "@open-erp/contracts/sales-register";
import { database, decoded, environment, failure, request } from "./support/fixtures";
import { legalFixture } from "./support/legal-commerce";

test("existing sales register represents a legally issued draft once under its registered identity", async () => {
  const { book, original } = await legalFixture();
  const page = await decoded(await request(book, "/commerce/sales-register"), Sales.SalesPage);

  const representations = page.items.filter(
    (item) => item.id === original.registerInvoiceId || item.id === original.draftId,
  );

  await writeFile(
    join(environment().artifacts, "workspace-search-sales-dedup-baseline.json"),
    JSON.stringify({ issue: original, page, representations }, null, 2),
  );
  expect(representations.map((item) => ({ id: item.id, kind: item.kind }))).toEqual([
    { id: original.registerInvoiceId, kind: "invoice" },
  ]);
});

test("existing sales register admits its legal issue relation before reading draft identities", async () => {
  const { book } = await legalFixture();
  const admin = await database();

  try {
    await admin.query("REVOKE SELECT ON openerp.ar_legal_issues FROM openerp_runtime");
    await failure(await request(book, "/commerce/sales-register"), 422, "UnsupportedProfile");
    await writeFile(
      join(environment().artifacts, "workspace-search-sales-legal-relation-denied.json"),
      JSON.stringify(
        {
          scope: { entityId: book.entityId, bookId: book.bookId },
          deniedRelation: "ar_legal_issues",
          expectedStatus: 422,
          expectedCode: "UnsupportedProfile",
          qualification:
            "existing sales owner refuses before its newly joined legal issue relation; no new search-family coverage claim",
        },
        null,
        2,
      ),
    );
  } finally {
    await admin.query("GRANT SELECT ON openerp.ar_legal_issues TO openerp_runtime");
    await admin.end();
  }
});

