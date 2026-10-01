import { expect, test } from "vitest";
import { database, failure, fixture, key, request } from "./support/fixtures";

const path = "/commerce/cash-method";

test("caller-asserted cash-method commands cannot create financial history", async () => {
  const book = await fixture([]);

  expect(
    (
      await request(book, `${path}/lines`, {
        method: "POST",
        headers: { "idempotency-key": key() },
        body: JSON.stringify({
          invoiceId: "invoice_unknown",
          sourceLineId: "line_1",
          direction: "sale",
          currency: "SEK",
          profileWitness: "An asserted witness is not a qualified cash-method profile",
          componentPolicy: "tax_first_cumulative_v1",
          rounding: "half_up",
        }),
      })
    ).status,
  ).toBe(400);

  expect(
    (
      await request(book, `${path}/payments`, {
        method: "POST",
        headers: { "idempotency-key": key() },
        body: JSON.stringify({
          lineId: "line_unknown",
          paymentRef: "unretained_payment",
          paidGrossMinor: "500",
          cashEvidenceId: "evidence_unknown",
          settlementControlAccountId: "account_unknown",
          expenseOrRevenueAccountId: "account_unknown",
          taxAccountId: "account_unknown",
          bankAccountId: "account_unknown",
          postingDate: "2026-02-01",
          series: "A",
          accountingPeriodId: "period_2026",
          rationale: "A client-stated amount is not final cash",
        }),
      })
    ).status,
  ).toBe(400);

  await failure(
    await request(book, `${path}/year-end`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        fiscalYearId: "fy_2026",
        cutoffOn: "2026-12-31",
        series: "A",
        rationale: "The complete population has not been established",
        evidenceId: "evidence_unknown",
      }),
    }),
    422,
    "UnsupportedProfile",
  );

  const admin = await database();

  try {
    const rows = await admin.query<{ total: string }>(
      `SELECT (SELECT count(*) FROM openerp.cash_method_lines WHERE book_id=$1)
        + (SELECT count(*) FROM openerp.cash_method_recognitions WHERE book_id=$1)
        + (SELECT count(*) FROM openerp.cash_method_year_end_runs WHERE book_id=$1)
          AS total`,
      [book.bookId],
    );

    expect(rows.rows[0]?.total).toBe("0");
  } finally {
    await admin.end();
  }
}, 240000);
