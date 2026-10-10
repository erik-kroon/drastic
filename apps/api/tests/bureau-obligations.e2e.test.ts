import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bureau from "@open-erp/contracts/bureau-obligations";
import * as Commerce from "@open-erp/contracts/commerce";
import {
  decoded,
  environment,
  evidence,
  execute,
  fixture,
  journal,
  key,
  post,
  request,
} from "./support/fixtures";

// Unknown-date source ownership is undecided: canonical invoices require dueOn.
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

  const response = await decoded(
    await request(book, "/bureau-obligations"),
    Bureau.BureauObligations,
  );

  const item = response.items.find((entry) => entry.obligationId === invoice.id);
  expect(response.coverage).toBe("partial");
  expect(item?.outstandingMinor).toBe("12345");
  expect(item?.dueOn).toBe("2026-02-28");
  expect(item?.freshness).toBe("current");
  expect(item?.sources.map((source) => source.evidenceId).sort()).toEqual(
    [source.id, revisionSource.id].sort(),
  );
  expect(response.items.filter((entry) => entry.obligationId === invoice.id)).toHaveLength(1);
  const artifact = join(environment().artifacts, "bureau-obligations.json");
  await writeFile(artifact, JSON.stringify({ scope: book.bookId, response }, null, 2));
});
