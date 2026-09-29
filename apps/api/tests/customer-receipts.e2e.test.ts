import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Credits from "@open-erp/contracts/customer-credit-notes";
import { expect, test } from "vitest";
import {
  createSession,
  database,
  decoded,
  evidence,
  execute,
  failure,
  fixture,
  journal,
  post,
  request,
} from "./support/fixtures";

// NEXT-30. Customer unapplied cash, paid credits and refunds.
//
// Invoices ride on real posted receivables created through the change-set
// flow, so every remaining below is retained. Expected splits, origins and
// remainings are derived by hand from those postings, never from the receipt
// compiler.

async function setup() {
  const second = await fixture();

  const book = await fixture([
    { id: "account_receivable", code: "1510", name: "Receivables" },
    { id: "account_revenue", code: "3050", name: "Revenue" },
    { id: "account_liability", code: "2890", name: "Customer credits" },
    { id: "account_cash", code: "1931", name: "Cash" },
  ]);

  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.memberships(book_id, actor_id, role) VALUES ($1, $2, 'operator')",
      [book.bookId, second.actorId],
    );
  } finally {
    await admin.end();
  }

  const reviewer = {
    ...book,
    actorId: second.actorId,
    token: (await createSession(second)).token,
  };

  const source = await evidence(book);

  return { book, reviewer, source };
}

// One posted receivable journal. Returns the voucher and line the invoice
// will recognize, read back from retained rows rather than asserted.
async function postedReceivable(
  book: Awaited<ReturnType<typeof fixture>>,
  evidenceId: string,
  amountMinor: string,
) {
  const input = journal(evidenceId, amountMinor);

  const plan = await post(
    book,
    "/change-sets",
    {
      ...input,
      lines: [
        {
          accountId: "account_receivable",
          debitMinor: amountMinor,
          creditMinor: "0",
          description: "Receivable debit",
        },
        {
          accountId: "account_revenue",
          debitMinor: "0",
          creditMinor: amountMinor,
          description: "Revenue credit",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const executed = await execute(book, plan);
  const admin = await database();

  try {
    const rows = await admin.query(
      "select id, debit_minor from openerp.journal_lines where book_id=$1 and voucher_id=$2 and debit_minor <> '0' order by ordinal limit 1",
      [book.bookId, executed.voucherId],
    );

    const line = rows.rows[0] as { id: string; debit_minor: string } | undefined;

    if (line === undefined) throw new Error("no debited line retained");

    return { voucherId: executed.voucherId, lineId: line.id };
  } finally {
    await admin.end();
  }
}

async function counterparty(
  book: Awaited<ReturnType<typeof fixture>>,
  evidenceId: string,
  tag: string,
) {
  return post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: `synthetic_customer_${tag}`,
      role: "customer",
      displayName: "Synthetic Customer",
      evidenceId,
      reason: "Synthetic counterparty for NEXT-30",
    },
    Commerce.CounterpartyRevision,
  );
}

async function invoice(
  book: Awaited<ReturnType<typeof fixture>>,
  party: Awaited<ReturnType<typeof counterparty>>,
  evidenceId: string,
  voucherId: string,
  lineId: string,
  amountMinor: string,
  tag: string,
) {
  return post(
    book,
    "/commerce/invoices",
    {
      kind: "synthetic_invoice_v1",
      direction: "customer",
      counterpartyId: party.id,
      counterpartyRevision: party.revision,
      documentNumber: `INV-${tag}`,
      issuedOn: "2026-01-15",
      dueOn: "2026-02-15",
      currency: "SEK",
      amountMinor,
      controlAccountId: "account_receivable",
      recognitionVoucherId: voucherId,
      recognitionLineId: lineId,
      evidenceId,
      description: `Synthetic invoice ${tag}`,
    },
    Commerce.Invoice,
  );
}

const receiptInput = {
  customerId: "",
  currency: "SEK",
  cashMinor: "10000",
  legs: [] as Array<{ invoiceId: string; amountMinor: string }>,
  surplusClassification: "unapplied_cash" as const,
  bankAccountId: "account_cash",
  evidenceId: "",
  receivableControlAccountId: "account_receivable",
  creditLiabilityAccountId: "account_liability",
  fiscalYearId: "fy_2026",
  accountingPeriodId: "period_2026",
  series: "VER",
  reason: "Synthetic customer receipt",
};

test("NEXT-30 splits a receipt across an invoice leg and a retained credit origin", async () => {
  const { book, source } = await setup();
  const party = await counterparty(book, source.id, "receipt");
  const posted = await postedReceivable(book, source.id, "8000");

  const billed = await invoice(
    book,
    party,
    source.id,
    posted.voucherId,
    posted.lineId,
    "8000",
    "receipt",
  );

  const prepared = await post(
    book,
    "/commerce/customer-receipts",
    {
      ...receiptInput,
      customerId: party.id,
      evidenceId: source.id,
      legs: [{ invoiceId: billed.id, amountMinor: "8000" }],
    },
    Credits.CustomerReceiptView,
  );

  // Independent expectation: 8000 of 10000 cash is allocated, so 2000 becomes
  // a credit origin and the journal balances with the surplus on the liability.
  expect(prepared.allocatedMinor).toBe("8000");
  expect(prepared.creditOriginMinor).toBe("2000");

  const executed = await post(
    book,
    "/commerce/customer-receipts/execute",
    {
      version: 1,
      digest: prepared.digest,
      prepare: {
        ...receiptInput,
        customerId: party.id,
        evidenceId: source.id,
        legs: [{ invoiceId: billed.id, amountMinor: "8000" }],
      },
    },
    Credits.CustomerReceiptView,
  );

  expect(executed.originId).not.toBeNull();

  const origin = await decoded(
    await request(book, `/commerce/customer-credit-origins/${executed.originId}`),
    Credits.CustomerReceiptView,
  );

  expect(origin.creditOriginMinor).toBe("2000");
});

test("NEXT-30 applies retained credit to another invoice and refunds the rest", async () => {
  const { book, source } = await setup();
  const party = await counterparty(book, source.id, "apply");
  const first = await postedReceivable(book, source.id, "8000");

  const billed = await invoice(
    book,
    party,
    source.id,
    first.voucherId,
    first.lineId,
    "8000",
    "apply",
  );

  const prepared = await post(
    book,
    "/commerce/customer-receipts",
    {
      ...receiptInput,
      customerId: party.id,
      evidenceId: source.id,
      legs: [{ invoiceId: billed.id, amountMinor: "8000" }],
    },
    Credits.CustomerReceiptView,
  );

  const executed = await post(
    book,
    "/commerce/customer-receipts/execute",
    {
      version: 1,
      digest: prepared.digest,
      prepare: {
        ...receiptInput,
        customerId: party.id,
        evidenceId: source.id,
        legs: [{ invoiceId: billed.id, amountMinor: "8000" }],
      },
    },
    Credits.CustomerReceiptView,
  );

  const originId = executed.originId;

  if (originId === null) throw new Error("expected a credit origin");

  const second = await postedReceivable(book, source.id, "1500");

  const billedTwo = await invoice(
    book,
    party,
    source.id,
    second.voucherId,
    second.lineId,
    "1500",
    "apply-two",
  );

  const applied = await post(
    book,
    `/commerce/customer-credit-origins/${originId}/apply`,
    {
      originId,
      invoiceId: billedTwo.id,
      amountMinor: "1500",
      evidenceId: source.id,
      fiscalYearId: "fy_2026",
      accountingPeriodId: "period_2026",
      series: "VER",
      reason: "Synthetic credit application",
    },
    Credits.CustomerCreditEffectView,
  );

  expect(applied.consumedMinor).toBe("1500");

  // 500 of the original 2000 remains, so a 501 refund refuses and a 500
  // refund succeeds.
  const tooMuch = await request(book, `/commerce/customer-credit-origins/${originId}/refund`, {
    method: "POST",
    body: JSON.stringify({
      originId,
      amountMinor: "501",
      cashAccountId: "account_cash",
      evidenceId: source.id,
      fiscalYearId: "fy_2026",
      accountingPeriodId: "period_2026",
      series: "VER",
      reason: "Synthetic over-refund",
    }),
  });

  expect(tooMuch.status).toBe(422);

  const refunded = await post(
    book,
    `/commerce/customer-credit-origins/${originId}/refund`,
    {
      originId,
      amountMinor: "500",
      cashAccountId: "account_cash",
      evidenceId: source.id,
      fiscalYearId: "fy_2026",
      accountingPeriodId: "period_2026",
      series: "VER",
      reason: "Synthetic refund of the remainder",
    },
    Credits.CustomerCreditEffectView,
  );

  expect(refunded.consumedMinor).toBe("500");

  const reread = await decoded(
    await request(book, `/commerce/customer-credit-origins/${originId}`),
    Credits.CustomerReceiptView,
  );

  expect(reread.creditOriginMinor).toBe("0");
});

test("NEXT-30 refuses an unclassified surplus instead of defaulting it to credit", async () => {
  const { book, source } = await setup();
  const party = await counterparty(book, source.id, "advance");

  await failure(
    await request(book, "/commerce/customer-receipts", {
      method: "POST",
      body: JSON.stringify({
        ...receiptInput,
        customerId: party.id,
        evidenceId: source.id,
        legs: [],
        surplusClassification: null,
      }),
    }),
    422,
    "UnsupportedProfile",
  );
});
