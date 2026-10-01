import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import { database, evidence, execute, fixture, key, post, request } from "./support/fixtures";

test("an already posted accrual invoice cannot be relabelled cash-method", async () => {
  const book = await fixture([
    { id: "account_receivable", code: "1510", name: "Trade receivable" },
    { id: "account_revenue", code: "3010", name: "Sales" },
    { id: "account_output_vat", code: "2611", name: "Output VAT" },
  ]);

  const source = await evidence(book);

  const plan = await post(
    book,
    "/change-sets",
    {
      kind: "manual_journal",
      evidenceId: source.id,
      eventKey: "accrual_invoice_for_cash_method_refusal",
      accountingPeriodId: "period_2026",
      postingDate: "2026-01-15",
      series: "A",
      description: "Accrual source cannot become a second cash recognition",
      rationale: "Prove that already posted source remains untouched",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "account_receivable",
          debitMinor: "1250",
          creditMinor: "0",
          description: "AR",
        },
        {
          accountId: "account_revenue",
          debitMinor: "0",
          creditMinor: "1000",
          description: "Revenue",
        },
        {
          accountId: "account_output_vat",
          debitMinor: "0",
          creditMinor: "250",
          description: "VAT",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const posted = await execute(book, plan);
  const admin = await database();

  try {
    const control = await admin.query<{ id: string }>(
      "SELECT id FROM openerp.journal_lines WHERE book_id=$1 AND voucher_id=$2 AND account_id='account_receivable'",
      [book.bookId, posted.voucherId],
    );

    const controlLineId = control.rows[0]?.id;

    if (!controlLineId) throw new Error("source control line was not posted");

    const party = await post(
      book,
      "/commerce/counterparties",
      {
        kind: "synthetic_counterparty_v1",
        externalKey: "cash_method_refusal_customer",
        role: "customer",
        displayName: "Synthetic Customer",
        evidenceId: source.id,
        reason: "Retained synthetic invoice owner",
      },
      Commerce.CounterpartyRevision,
    );

    const invoice = await post(
      book,
      "/commerce/invoices",
      {
        kind: "synthetic_invoice_v1",
        direction: "customer",
        counterpartyId: party.id,
        counterpartyRevision: party.revision,
        documentNumber: "CM-REFUSE",
        issuedOn: "2026-01-15",
        dueOn: "2026-02-15",
        currency: "SEK",
        amountMinor: "1250",
        controlAccountId: "account_receivable",
        recognitionVoucherId: posted.voucherId,
        recognitionLineId: controlLineId,
        evidenceId: source.id,
        description: "Already recognized accrual invoice",
      },
      Commerce.Invoice,
    );

    expect(
      (
        await request(book, "/commerce/cash-method/lines", {
          method: "POST",
          headers: { "idempotency-key": key() },
          body: JSON.stringify({
            invoiceId: invoice.id,
            sourceLineId: "line_a",
            direction: "sale",
            currency: "SEK",
            profileWitness: "An asserted witness cannot undo a posting",
            componentPolicy: "tax_first_cumulative_v1",
            rounding: "half_up",
          }),
        })
      ).status,
    ).toBe(400);

    const state = await admin.query<{ line_count: string; voucher_count: string }>(
      `SELECT (SELECT count(*)::text FROM openerp.cash_method_lines WHERE book_id=$1) AS line_count,
        (SELECT count(*)::text FROM openerp.vouchers WHERE book_id=$1) AS voucher_count`,
      [book.bookId],
    );

    expect(state.rows[0]).toEqual({ line_count: "0", voucher_count: "1" });
  } finally {
    await admin.end();
  }
}, 240000);
