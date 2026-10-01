import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Credits from "@open-erp/contracts/supplier-credits";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import { database, decoded, environment, key, persisted, post, request } from "./support/fixtures";
import {
  acceptDraft,
  createDraft,
  purchaseEvidence,
  supplierFixture,
} from "./support/supplier-review";

test("DF-09 competing partial credits cannot jointly overconsume an invoice", async () => {
  const { book, content } = await supplierFixture();
  const accepted = await acceptDraft(book, await createDraft(book, content));

  const invoice = await decoded(
    await request(book, `/commerce/invoices/${accepted.registerInvoiceId}`),
    Commerce.Invoice,
  );

  const commands = [];

  for (const ordinal of [0, 1]) {
    const source = await purchaseEvidence(book, 9100 + ordinal);

    const review = await post(
      book,
      "/commerce/supplier-credit-reviews",
      {
        profile: "synthetic-zero-tax-supplier-credit-v1",
        invoiceId: invoice.id,
        acceptanceDigest: accepted.digest,
        expectedInvoiceRevision: invoice.currentRevision.revision,
        expectedAllocationVersion: invoice.allocationVersion,
        expectedOutstandingMinor: invoice.outstandingMinor,
        creditEvidenceId: source.id,
        supplierCreditNumber: `RACE-${ordinal}`,
        amountMinor: "6000",
        creditDate: "2026-09-23",
        accountingPeriodId: "period_2026",
        series: "A",
        reason: "Synthetic competing credits",
        acknowledgeSyntheticOnly: true,
      },
      Credits.SupplierCreditReview,
    );

    const approval = await post(
      book,
      `/commerce/supplier-credit-reviews/${review.id}/approvals`,
      { digest: review.digest, acknowledgeSyntheticOnly: true },
      Credits.SupplierCreditApproval,
    );

    commands.push({
      reviewId: review.id,
      input: { digest: review.digest, approvalId: approval.id, acknowledgeSyntheticOnly: true },
    });
  }

  const responses = await Promise.all(
    commands.map((command) =>
      request(book, `/commerce/supplier-credit-reviews/${command.reviewId}/execute`, {
        method: "POST",
        body: JSON.stringify(command.input),
      }),
    ),
  );

  expect(responses.map((response) => response.status).sort((left, right) => left - right)).toEqual([
    200, 409,
  ]);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  const admin = await database();

  try {
    const retained = await admin.query(
      "select count(*)::int as count, sum(amount_minor)::text as total from openerp.supplier_credits where book_id=$1 and invoice_id=$2",
      [book.bookId, invoice.id],
    );

    expect(retained.rows).toEqual([{ count: 1, total: "6000" }]);
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "df-09-credit-race.json"),
    JSON.stringify(
      {
        originalMinor: "10000",
        proposedCombinedMinor: "12000",
        statuses: responses.map((response) => response.status),
        bodies,
        retainedMinor: "6000",
      },
      null,
      2,
    ),
  );
});

test("DF-09 retained supplier credits cannot exceed the original across partial credits", async () => {
  const { book, content } = await supplierFixture();
  const accepted = await acceptDraft(book, await createDraft(book, content));
  const receipts = [];

  for (const [ordinal, amountMinor] of ["6000", "4000"].entries()) {
    const invoice = await decoded(
      await request(book, `/commerce/invoices/${accepted.registerInvoiceId}`),
      Commerce.Invoice,
    );

    const source = await purchaseEvidence(book, 9000 + ordinal);

    const review = await post(
      book,
      "/commerce/supplier-credit-reviews",
      {
        profile: "synthetic-zero-tax-supplier-credit-v1",
        invoiceId: invoice.id,
        acceptanceDigest: accepted.digest,
        expectedInvoiceRevision: invoice.currentRevision.revision,
        expectedAllocationVersion: invoice.allocationVersion,
        expectedOutstandingMinor: invoice.outstandingMinor,
        creditEvidenceId: source.id,
        supplierCreditNumber: `CAP-${ordinal}`,
        amountMinor,
        creditDate: "2026-09-23",
        accountingPeriodId: "period_2026",
        series: "A",
        reason: "Synthetic aggregate cap proof",
        acknowledgeSyntheticOnly: true,
      },
      Credits.SupplierCreditReview,
    );

    const approval = await post(
      book,
      `/commerce/supplier-credit-reviews/${review.id}/approvals`,
      { digest: review.digest, acknowledgeSyntheticOnly: true },
      Credits.SupplierCreditApproval,
    );

    const command = {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        digest: review.digest,
        approvalId: approval.id,
        acknowledgeSyntheticOnly: true,
      }),
    };

    if (ordinal === 1) {
      const before = await persisted(book);
      const admin = await database();

      try {
        await admin.query(
          `create function openerp.e2e_df09_fault() returns trigger language plpgsql as $$ begin if new.book_id = '${book.bookId}' then new.amount_minor := new.amount_minor + 1; end if; return new; end $$`,
        );
        await admin.query(
          "create trigger a_e2e_df09_fault before insert on openerp.supplier_credits for each row execute function openerp.e2e_df09_fault()",
        );

        const rejected = await request(
          book,
          `/commerce/supplier-credit-reviews/${review.id}/execute`,
          command,
        );

        const text = await rejected.text();
        expect(rejected.status, text).toBe(422);
        expect(
          Schema.decodeSync(Schema.fromJsonString(Accounting.AccountingError))(text).code,
        ).toBe("InvalidJournal");
        expect(await persisted(book)).toEqual(before);
      } finally {
        await admin.query("drop trigger if exists a_e2e_df09_fault on openerp.supplier_credits");
        await admin.query("drop function if exists openerp.e2e_df09_fault()");
        await admin.end();
      }
    }

    receipts.push(
      await decoded(
        await request(book, `/commerce/supplier-credit-reviews/${review.id}/execute`, command),
        Credits.SupplierCreditReceipt,
      ),
    );
  }

  const admin = await database();

  try {
    const total = await admin.query(
      "select sum(amount_minor)::text as total from openerp.supplier_credits where book_id=$1 and invoice_id=$2",
      [book.bookId, accepted.registerInvoiceId],
    );

    expect(total.rows).toEqual([{ total: "10000" }]);
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "df-09-supplier-credit-cap.json"),
    JSON.stringify(
      { originalMinor: "10000", receipts, exactCapAdmitted: true, overflowRolledBack: true },
      null,
      2,
    ),
  );
});
