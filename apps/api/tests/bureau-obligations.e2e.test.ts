import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createTestHarness } from "wrangler";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bureau from "@open-erp/contracts/bureau-obligations";
import * as Commerce from "@open-erp/contracts/commerce";
import {
  apiDirectory,
  decoded,
  environment,
  evidence,
  failure,
  database,
  execute,
  fixture,
  journal,
  key,
  post,
  request,
} from "./support/fixtures";

// Failure contract: a production Worker refuses clock injection; malformed instants fail;
// a pinned E2E request reports retained revision age, not worker or database wall time.
test("production Worker refuses client-supplied time with a real PostgreSQL binding", async () => {
  const book = await fixture();

  const worker = createTestHarness({
    root: apiDirectory,
    workers: [
      {
        configPath: "wrangler.jsonc",
        secrets: { DATABASE_URL: environment().runtimeUrl, OPENERP_E2E_CLOCK: "enabled" },
      },
    ],
  });

  try {
    const listening = await worker.listen();

    const response = await fetch(`${listening.url.origin}${book.path}/bureau-obligations`, {
      headers: {
        authorization: `Bearer ${book.token}`,
        "x-openerp-test-now": "2026-10-02T06:54:00.000Z",
      },
    });

    await failure(response, 403, "Forbidden");
    await writeFile(
      join(environment().artifacts, "production-clock-refusal.json"),
      JSON.stringify(
        {
          mode: "production-entrypoint",
          status: response.status,
          requestId: response.headers.get("x-request-id"),
        },
        null,
        2,
      ),
    );
  } finally {
    await worker.close();
  }
});

test("bureau obligations read canonical stored residual once with two retained sources and partial coverage", async () => {
  const book = await fixture([{ id: "account_revenue", code: "4000", name: "Synthetic cost" }]);
  const source = await evidence(book);

  const revisionSource = await post(
    book,
    "/evidence",
    {
      title: "Revised synthetic obligation",
      content: "Independent synthetic revised due date",
      mediaType: "text/plain",
      origin: "Vitest E2E fixture",
    },
    Accounting.Evidence,
  );

  const party = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "supplier",
      displayName: "Synthetic creditor",
      evidenceId: source.id,
      reason: "Synthetic creditor",
    },
    Commerce.CounterpartyRevision,
  );

  const plan = await post(
    book,
    "/change-sets",
    {
      ...journal(source.id, "12345"),
      postingDate: "2026-01-02",
      lines: [
        {
          accountId: "account_revenue",
          debitMinor: "12345",
          creditMinor: "0",
          description: "Synthetic cost",
        },
        {
          accountId: "account_clearing",
          debitMinor: "0",
          creditMinor: "12345",
          description: "Payable",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const posted = await execute(book, plan);

  const line = plan.groups[0]?.actions[0]?.lines.find(
    (entry) => entry.accountId === "account_clearing",
  );

  if (!line) throw new Error("Missing payable line");

  const invoice = await post(
    book,
    "/commerce/invoices",
    {
      kind: "synthetic_invoice_v1",
      direction: "supplier",
      counterpartyId: party.id,
      counterpartyRevision: party.revision,
      documentNumber: key(),
      issuedOn: "2026-01-02",
      dueOn: "2026-01-31",
      currency: "SEK",
      amountMinor: "12345",
      controlAccountId: "account_clearing",
      recognitionVoucherId: posted.voucherId,
      recognitionLineId: line.lineId,
      evidenceId: source.id,
      description: "Synthetic obligation",
    },
    Commerce.Invoice,
  );

  await post(
    book,
    `/commerce/invoices/${invoice.id}/revisions`,
    {
      expectedRevision: invoice.currentRevision.revision,
      dueOn: "2026-02-28",
      description: "Revised synthetic due date",
      evidenceId: revisionSource.id,
      reason: "Retained second source for the same obligation",
    },
    Commerce.Invoice,
  );

  const admin = await database();

  try {
    // Independent fixture setup only: simulate a retained revision from before the pinned instant.
    await admin.query(`ALTER TABLE openerp.commerce_invoice_revisions DISABLE TRIGGER USER`);

    try {
      await admin.query(
        `UPDATE openerp.commerce_invoice_revisions SET body = jsonb_set(body, '{createdAt}', to_jsonb($1::text)) WHERE book_id = $2 AND invoice_id = $3 AND revision = 2`,
        ["2026-09-30T06:54:00.000Z", book.bookId, invoice.id],
      );
    } finally {
      await admin.query(`ALTER TABLE openerp.commerce_invoice_revisions ENABLE TRIGGER USER`);
    }
  } finally {
    await admin.end();
  }

  const pinned = "2026-10-02T06:54:00.000Z"; // 08:54 Europe/Stockholm

  const response = await decoded(
    await request(book, "/bureau-obligations", {
      headers: { "x-openerp-test-now": pinned },
    }),
    Bureau.BureauObligations,
  );

  const item = response.items.find((entry) => entry.obligationId === invoice.id);
  expect(response.coverage).toBe("partial");
  expect(item?.outstandingMinor).toBe("12345");
  expect(item?.dueOn).toBe("2026-02-28");
  expect(response.checkedAt).toBe(pinned);
  expect(item?.freshness).toBe("stale");
  expect(item?.sources.map((source) => source.evidenceId).sort()).toEqual(
    [source.id, revisionSource.id].sort(),
  );
  expect(response.items.filter((entry) => entry.obligationId === invoice.id)).toHaveLength(1);
  const artifact = join(environment().artifacts, "bureau-obligations.json");
  await failure(
    await request(book, "/bureau-obligations", {
      headers: { "x-openerp-test-now": "not-an-instant" },
    }),
    400,
    "InvalidRequest",
  );
  await writeFile(artifact, JSON.stringify({ scope: book.bookId, pinned: response }, null, 2));
});
