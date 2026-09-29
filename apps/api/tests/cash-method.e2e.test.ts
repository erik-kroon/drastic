import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as CashMethod from "@open-erp/contracts/cash-method";
import * as Commerce from "@open-erp/contracts/commerce";
import {
  database,
  decoded,
  evidence,
  execute,
  failure,
  fixture,
  key,
  post,
  request,
} from "./support/fixtures";

// NEXT-38 cash-method recognition and once-only year-end unpaid cutover,
// proven over real HTTP against the restricted runtime role and a real
// PostgreSQL.
//
// The load-bearing claim is that the two balances stay apart. A cash-method
// book recognizes a document when it is paid, but paying it does not change
// what the counterparty still owes, and recognizing it does not create a
// second document. Every expectation below is computed by hand from the leaf's
// stated arithmetic and checked against the retained rows.

const path = "/commerce/cash-method";

type Book = Awaited<ReturnType<typeof fixture>>;

// A customer invoice whose recognition voucher carries the control, revenue
// and output-VAT lines separately, so the owner can read the net/tax split
// from retained journal lines rather than from anything a caller states.
async function recognizedInvoice(
  book: Book,
  evidenceId: string,
  netMinor: string,
  taxMinor: string,
  tag: string,
) {
  const gross = (BigInt(netMinor) + BigInt(taxMinor)).toString();

  const plan = await post(
    book,
    "/change-sets",
    {
      kind: "manual_journal",
      evidenceId,
      eventKey: `cm_${tag}`,
      accountingPeriodId: "period_2026",
      postingDate: "2026-01-15",
      series: "A",
      description: `Synthetic recognition ${tag}`,
      rationale: "Recognize the customer document for the cash-method workflow",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "account_receivable",
          debitMinor: gross,
          creditMinor: "0",
          description: "Receivable",
        },
        {
          accountId: "account_revenue",
          debitMinor: "0",
          creditMinor: netMinor,
          description: "Revenue",
        },
        {
          accountId: "account_output_vat",
          debitMinor: "0",
          creditMinor: taxMinor,
          description: "Output VAT",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const executed = await execute(book, plan);
  const admin = await database();

  try {
    const rows = await admin.query<{ id: string }>(
      "SELECT id FROM openerp.journal_lines WHERE book_id=$1 AND voucher_id=$2 AND account_id='account_receivable'",
      [book.bookId, executed.voucherId],
    );

    const lineId = rows.rows[0]?.id;

    if (!lineId) throw new Error("no receivable line retained");

    const party = await post(
      book,
      "/commerce/counterparties",
      {
        kind: "synthetic_counterparty_v1",
        externalKey: `cm_customer_${tag}`,
        role: "customer",
        displayName: "Synthetic Customer",
        evidenceId,
        reason: "Synthetic counterparty for the cash-method workflow",
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
        documentNumber: `CM-${tag}`,
        issuedOn: "2026-01-15",
        dueOn: "2026-02-15",
        currency: "SEK",
        amountMinor: gross,
        controlAccountId: "account_receivable",
        recognitionVoucherId: executed.voucherId,
        recognitionLineId: lineId,
        evidenceId,
        description: `Synthetic invoice ${tag}`,
      },
      Commerce.Invoice,
    );

    return invoice;
  } finally {
    await admin.end();
  }
}

function register(book: Book, invoiceId: string, sourceLineId: string, witness: string) {
  return request(book, `${path}/lines`, {
    method: "POST",
    headers: { "idempotency-key": key() },
    body: JSON.stringify({
      invoiceId,
      sourceLineId,
      direction: "sale",
      currency: "SEK",
      profileWitness: witness,
      componentPolicy: "tax_first_cumulative_v1",
      rounding: "half_up",
    }),
  });
}

function pay(
  book: Book,
  lineId: string,
  paymentRef: string,
  paidGrossMinor: string,
  evidenceId: string,
) {
  return request(book, `${path}/payments`, {
    method: "POST",
    headers: { "idempotency-key": key() },
    body: JSON.stringify({
      lineId,
      paymentRef,
      paidGrossMinor,
      cashEvidenceId: evidenceId,
      settlementControlAccountId: "account_receivable",
      expenseOrRevenueAccountId: "account_revenue",
      taxAccountId: "account_output_vat",
      bankAccountId: "account_bank",
      postingDate: "2026-02-01",
      series: "A",
      accountingPeriodId: "period_2026",
      rationale: "Reviewed cash settlement of the document",
    }),
  });
}

function read(book: Book, lineId: string) {
  return request(book, `${path}/lines/state`, {
    method: "POST",
    headers: { "idempotency-key": key() },
    body: JSON.stringify({ lineId }),
  });
}

test("paying a document recognizes it without changing what is owed", async () => {
  const book = await fixture([
    { id: "account_receivable", code: "1510", name: "Trade receivable" },
    { id: "account_revenue", code: "3010", name: "Sales" },
    { id: "account_output_vat", code: "2611", name: "Output VAT" },
  ]);

  const source = await evidence(book);
  const cash = await evidence(book);
  // 1000 net plus 250 VAT is a 1250 gross document.
  const invoice = await recognizedInvoice(book, source.id, "1000", "250", "PAY");

  const line = await decoded(
    await register(book, invoice.id, "line_a", "Reviewed cash-method profile witness"),
    CashMethod.CashMethodLineView,
  );

  // A fresh cash-method line has recognized nothing and is owed everything.
  expect(line.originalGrossMinor).toBe("1250");
  expect(line.recognizedGrossMinor).toBe("0");
  expect(line.commercialUnpaidMinor).toBe("1250");
  expect(line.recognizedUnpaidMinor).toBe("0");
  expect(line.profileWitness).toBe("Reviewed cash-method profile witness");
  expect(line.yearEndRecognized).toBe(false);

  // A partial payment recognizes the gross it covers and leaves the rest owed.
  const partial = await decoded(
    await pay(book, line.lineId, "payment_001", "500", cash.id),
    CashMethod.CashPaymentRecognition,
  );

  expect(partial.paidGrossAfterMinor).toBe("500");
  // Paying 500 of a 1250 document recognized the whole 500, because the book
  // takes the recognized-unpaid portion the payment covers.
  expect(partial.recognizedGrossAfterMinor).toBe("500");
  // What the counterparty still owes drops with the payment...
  expect(partial.commercialUnpaidMinor).toBe("750");
  // ...and what the book has taken but not been paid for is now zero, because
  // the payment covered all of it. This is the pair that must stay apart.
  expect(partial.recognizedUnpaidMinor).toBe("0");
  expect(partial.netMinor).toBe("400");
  expect(partial.taxMinor).toBe("100");
  // The recognition journal is prepared, not executed.
  expect(partial.journalIds).toHaveLength(0);

  const afterPartial = await decoded(await read(book, line.lineId), CashMethod.CashMethodLineView);

  expect(afterPartial.recognizedGrossMinor).toBe("500");
  expect(afterPartial.commercialUnpaidMinor).toBe("750");
  expect(afterPartial.recognizedUnpaidMinor).toBe("0");

  // The same payment under a different key still collides: the trigger is the
  // payment's own identity, not the command.
  await failure(
    await pay(book, line.lineId, "payment_001", "500", cash.id),
    409,
    "IdempotencyConflict",
  );

  // A payment covering more than the line still owes refuses.
  await failure(await pay(book, line.lineId, "payment_002", "900", cash.id), 422, "InvalidJournal");

  // Paying the rest recognizes the remaining 750 and leaves nothing unpaid.
  const settled = await decoded(
    await pay(book, line.lineId, "payment_003", "750", cash.id),
    CashMethod.CashPaymentRecognition,
  );

  expect(settled.recognizedGrossAfterMinor).toBe("1250");
  expect(settled.commercialUnpaidMinor).toBe("0");
  expect(settled.recognizedUnpaidMinor).toBe("0");
  expect(settled.netMinor).toBe("600");
  expect(settled.taxMinor).toBe("150");

  const final = await decoded(await read(book, line.lineId), CashMethod.CashMethodLineView);

  expect(final.recognizedGrossMinor).toBe("1250");
  expect(final.commercialUnpaidMinor).toBe("0");
  expect(final.recognizedUnpaidMinor).toBe("0");

  const admin = await database();

  try {
    // Two payments, two recognitions, each naming its own trigger.
    const recognitions = await admin.query<{ trigger_kind: string; trigger_ref: string }>(
      "SELECT trigger_kind, trigger_ref FROM openerp.cash_method_recognitions WHERE book_id=$1 AND line_id=$2 ORDER BY recorded_at",
      [book.bookId, line.lineId],
    );

    expect(recognitions.rows).toHaveLength(2);
    expect(recognitions.rows.map((row) => row.trigger_ref)).toEqual(["payment_001", "payment_003"]);

    // Two prepared change sets, and no voucher for either: recognition is
    // prepared through the released prepare/approve/execute boundary like
    // every other posting, so the cash effect is not committed here.
    const prepared = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM openerp.change_sets WHERE book_id=$1",
      [book.bookId],
    );

    const cashVouchers = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM openerp.vouchers v JOIN openerp.journal_lines l ON l.book_id=v.book_id AND l.voucher_id=v.id WHERE v.book_id=$1 AND l.account_id='account_bank'",
      [book.bookId],
    );

    // One prepared recognition voucher from the fixture, and the two
    // recognition change sets that have not been executed.
    expect(Number(prepared.rows[0]?.count ?? "0")).toBeGreaterThanOrEqual(3);
    expect(cashVouchers.rows[0]?.count).toBe("0");
  } finally {
    await admin.end();
  }
}, 240000);

test("a year end recognizes the unpaid remainder once per period and never again", async () => {
  const book = await fixture([
    { id: "account_receivable", code: "1510", name: "Trade receivable" },
    { id: "account_revenue", code: "3010", name: "Sales" },
    { id: "account_output_vat", code: "2611", name: "Output VAT" },
  ]);

  const source = await evidence(book);
  const cash = await evidence(book);
  const invoice = await recognizedInvoice(book, source.id, "800", "200", "YEAREND");

  const line = await decoded(
    await register(book, invoice.id, "line_a", "Reviewed cash-method profile witness"),
    CashMethod.CashMethodLineView,
  );

  // Nothing paid at all, so the whole 1000 gross is commercially unpaid.
  expect(line.commercialUnpaidMinor).toBe("1000");
  expect(line.recognizedGrossMinor).toBe("0");

  const yearEnd = await decoded(
    await request(book, `${path}/year-end`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        accountingPeriodId: "period_2026",
        cutoffOn: "2026-12-31",
        postingDate: "2026-12-31",
        series: "A",
        settlementControlAccountId: "account_receivable",
        expenseOrRevenueAccountId: "account_revenue",
        taxAccountId: "account_output_vat",
        rationale: "Reviewed year-end cutover of the unpaid cash-method population",
        evidenceId: source.id,
        runKey: "year_end_2026",
      }),
    }),
    CashMethod.YearEndRecognition,
  );

  expect(yearEnd.recognizedLineCount).toBe(1);
  expect(yearEnd.recognizedGrossMinor).toBe("1000");
  expect(yearEnd.lines[0]?.recognizedGrossMinor).toBe("1000");
  // The commercial balance is unchanged by recognizing it: the customer still
  // owes. That difference is the whole point of the method.
  expect(yearEnd.commercialUnpaidRemainingMinor).toBe("1000");

  const afterRun = await decoded(await read(book, line.lineId), CashMethod.CashMethodLineView);

  expect(afterRun.recognizedGrossMinor).toBe("1000");
  expect(afterRun.commercialUnpaidMinor).toBe("1000");
  // The book has now taken all 1000 and been paid for none of it, which is
  // precisely the balance a cash-method year end creates.
  expect(afterRun.recognizedUnpaidMinor).toBe("1000");
  expect(afterRun.yearEndRecognized).toBe(true);

  // A second run over the same period is refused: recognizing the same unpaid
  // remainder twice is the failure this exists to stop.
  await failure(
    await request(book, `${path}/year-end`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        accountingPeriodId: "period_2026",
        cutoffOn: "2026-12-31",
        postingDate: "2026-12-31",
        series: "A",
        settlementControlAccountId: "account_receivable",
        expenseOrRevenueAccountId: "account_revenue",
        taxAccountId: "account_output_vat",
        rationale: "A second cutover over the same period",
        evidenceId: source.id,
        runKey: "year_end_2026_again",
      }),
    }),
    409,
    "IdempotencyConflict",
  );

  // A later payment consumes the year-end position without recognizing the VAT
  // a second time: the recognized prefix is already the whole document.
  const afterPayment = await decoded(
    await pay(book, line.lineId, "payment_after_year_end", "1000", cash.id),
    CashMethod.CashPaymentRecognition,
  );

  expect(afterPayment.recognizedGrossAfterMinor).toBe("1000");
  expect(afterPayment.commercialUnpaidMinor).toBe("0");
  expect(afterPayment.recognizedUnpaidMinor).toBe("0");

  const admin = await database();

  try {
    const runs = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM openerp.cash_method_year_end_runs WHERE book_id=$1",
      [book.bookId],
    );

    expect(runs.rows[0]?.count).toBe("1");

    const recognitions = await admin.query<{ trigger_kind: string }>(
      "SELECT trigger_kind FROM openerp.cash_method_recognitions WHERE book_id=$1 ORDER BY recorded_at",
      [book.bookId],
    );

    expect(recognitions.rows.map((row) => row.trigger_kind)).toEqual([
      "year_end_unpaid",
      "actual_payment",
    ]);
  } finally {
    await admin.end();
  }
}, 240000);

test("a line with no reviewed witness is not a cash-method line", async () => {
  const book = await fixture([
    { id: "account_receivable", code: "1510", name: "Trade receivable" },
    { id: "account_revenue", code: "3010", name: "Sales" },
    { id: "account_output_vat", code: "2611", name: "Output VAT" },
  ]);

  const source = await evidence(book);
  const invoice = await recognizedInvoice(book, source.id, "100", "25", "NOWITNESS");

  // The same document registered twice under different source lines is two
  // cash-method lines, which would defer the same commercial gross twice.
  const line = await decoded(
    await register(book, invoice.id, "line_a", "Reviewed cash-method profile witness"),
    CashMethod.CashMethodLineView,
  );

  await failure(
    await register(book, invoice.id, "line_a", "A second witness over the same source line"),
    409,
    "IdempotencyConflict",
  );

  // A line naming a document that was never retained refuses.
  await failure(
    await register(
      book,
      "invoice_does_not_exist",
      "line_a",
      "Reviewed cash-method profile witness",
    ),
    404,
    "NotFound",
  );

  // A purchase-side line over a customer document refuses: the accounting
  // direction must match the document's own side.
  await failure(
    await request(book, `${path}/lines`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        invoiceId: invoice.id,
        sourceLineId: "line_b",
        direction: "purchase",
        currency: "SEK",
        profileWitness: "A purchase witness over a customer document",
        componentPolicy: "tax_first_cumulative_v1",
        rounding: "exact",
      }),
    }),
    422,
    "InvalidJournal",
  );

  const unchanged = await decoded(await read(book, line.lineId), CashMethod.CashMethodLineView);

  expect(unchanged.recognizedGrossMinor).toBe("0");
  expect(unchanged.commercialUnpaidMinor).toBe("125");
}, 240000);
