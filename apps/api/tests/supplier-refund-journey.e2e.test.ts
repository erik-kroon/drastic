import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as Refunds from "@open-erp/contracts/supplier-refunds";
import {
  createSession,
  database,
  decoded,
  environment,
  execute,
  failure,
  fixture,
  key,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";

// The NEXT-07 financial journey over the real Worker and the real restricted
// role PostgreSQL chain through 0029-next-07.sql: one recognized Swedish
// purchase of G125000, a retained 100000 payment allocation (P100000), a paid
// credit of 50000 that releases 25000 of payable and raises 25000 of refund
// receivable, then two cash refund receipts of 10000 and 15000. Every number
// asserted is the packet's own arithmetic read back from the live projection.

const accounts = [
  { id: "account_payable", code: "2440", name: "Supplier payable" },
  { id: "account_input_vat", code: "2641", name: "Input VAT" },
  { id: "account_expense", code: "6000", name: "Purchase expense" },
  { id: "account_refund_receivable", code: "1510", name: "Supplier refund receivable" },
];

const treatment = {
  basis: "full_deduction",
  rate: { numerator: "25", denominator: "100" },
  deduction: { numerator: "1", denominator: "1" },
  invoiceTaxRounding: "half_up",
  deductionRounding: "half_up",
  acceptancePolicy: "exact_match",
  toleranceMinor: "0",
} as const;

type Journey = {
  readonly book: BookFixture;
  readonly invoiceId: string;
  readonly paymentVoucherId: string;
  readonly paymentLineId: string;
  readonly acceptance: typeof Acceptance.SupplierAcceptanceReceipt.Type;
};

async function recognizedPurchase(): Promise<Journey> {
  const base = await fixture(accounts);
  // A browser session carries the identity admission the approval and
  // execution paths require, so the journey runs as a current operator.
  const book = { ...base, token: (await createSession(base)).token };

  const source = await decoded(
    await request(book, "/evidence", {
      method: "POST",
      body: JSON.stringify({
        title: "NEXT-07 supplier document",
        content: `NEXT-07 supplier document ${key()}`,
        mediaType: "text/plain",
        origin: "NEXT-07 journey",
      }),
    }),
    Accounting.Evidence,
  );

  const supplier = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "supplier",
      displayName: "NEXT-07 refund supplier",
      evidenceId: source.id,
      reason: "Synthetic NEXT-07 journey fixture",
    },
    Commerce.CounterpartyRevision,
  );

  const identity = {
    legalName: "Synthetic NEXT-07 identity",
    registrationId: "5560000001",
    taxId: null,
    address: "Synthetic road 1",
    countryCode: "SE",
    evidenceId: source.id,
  };

  const draft = await post(
    book,
    "/commerce/supplier-invoice-drafts",
    {
      draftKey: `n07_${key()}`,
      content: {
        title: "NEXT-07 paid credit and refund journey",
        counterpartyId: supplier.id,
        counterpartyRevision: supplier.revision,
        supplier: identity,
        buyer: identity,
        sourceEvidenceId: source.id,
        supplierDocumentNumber: "N07-001",
        currency: "SEK",
        currencyScale: 2,
        documentDate: "2026-09-22",
        supplyDate: "2026-09-22",
        dueDate: "2026-10-22",
        paymentTerms: "30 days",
        sourceTotalMinor: "125000",
        lines: [
          {
            id: "line_purchase",
            description: "Synthetic reviewed purchase",
            quantity: "1",
            unitPriceMinor: "100000",
            baseMinor: "100000",
            discountMinor: "0",
            chargeMinor: "0",
            taxMinor: "25000",
            taxDescription: "Swedish standard 25%",
            taxEvidenceId: source.id,
            sourceGrossMinor: "125000",
          },
        ],
      },
    },
    Drafts.SupplierInvoiceDraftRevision,
  );

  const review = await post(
    book,
    "/commerce/supplier-acceptance-reviews",
    {
      profile: "swedish-purchase-v1",
      draftId: draft.id,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      controlAccountId: "account_payable",
      accountingPeriodId: "period_2026",
      series: "A",
      reason: "Synthetic NEXT-07 reviewed purchase",
      acknowledgeSyntheticOnly: true,
      taxPoint: { taxPointOn: "2026-09-22", basis: "document_date" },
      lineAssignments: [
        { lineId: "line_purchase", expenseAccountId: "account_expense", treatment },
      ],
    },
    Acceptance.SupplierAcceptanceReview,
  );

  const acceptanceInput = {
    version: 1,
    digest: review.digest,
    acknowledgeSyntheticOnly: true,
  } as const;

  const approval = await post(
    book,
    `/commerce/supplier-acceptance-reviews/${review.id}/approvals`,
    acceptanceInput,
    Acceptance.SupplierAcceptanceApproval,
  );

  const acceptance = await post(
    book,
    `/commerce/supplier-acceptance-reviews/${review.id}/execute`,
    { ...acceptanceInput, approvalId: approval.id },
    Acceptance.SupplierAcceptanceReceipt,
  );

  return {
    book,
    invoiceId: acceptance.registerInvoiceId,
    paymentVoucherId: "",
    paymentLineId: "",
    acceptance,
  };
}

// Retained evidence is unique per (book, sha256), so a journey step that must
// own its own posting needs its own content. Reusing the acceptance evidence
// would (correctly) be refused as owned evidence.
async function ownEvidence(book: BookFixture, label: string) {
  return decoded(
    await request(book, "/evidence", {
      method: "POST",
      body: JSON.stringify({
        title: `NEXT-07 ${label}`,
        content: `NEXT-07 ${label} ${key()}`,
        mediaType: "text/plain",
        origin: "NEXT-07 journey",
      }),
    }),
    Accounting.Evidence,
  );
}

// A separately posted synthetic payment journal: payable debit, bank credit.
// It is not the pain.001 export and not a provider-confirmed settlement.
async function paySupplier(book: BookFixture, amount: string) {
  const source = await ownEvidence(book, "payment");

  const plan = await decoded(
    await request(book, "/change-sets", {
      method: "POST",
      body: JSON.stringify({
        kind: "manual_journal",
        evidenceId: source.id,
        eventKey: key(),
        accountingPeriodId: "period_2026",
        postingDate: "2026-09-23",
        series: "A",
        description: "Synthetic supplier payment",
        rationale: "Allocate a retained payment against the supplier payable",
        taxAssessment: "not_applicable",
        lines: [
          {
            accountId: "account_payable",
            debitMinor: amount,
            creditMinor: "0",
            description: "Supplier payable debit",
          },
          {
            accountId: "account_bank",
            debitMinor: "0",
            creditMinor: amount,
            description: "Bank credit",
          },
        ],
      }),
    }),
    Accounting.ChangeSet,
  );

  const receipt = await execute(book, plan);

  const line = plan.groups[0]?.actions[0]?.lines.find(
    (entry) => entry.accountId === "account_payable",
  );

  if (!line) throw new Error("The payment journal carried no payable line.");

  return { receipt, voucherId: receipt.voucherId, lineId: line.lineId };
}

async function allocate(
  book: BookFixture,
  payment: { voucherId: string; lineId: string },
  invoiceId: string,
  amount: string,
) {
  const source = await ownEvidence(book, "allocation");

  const plan = await post(
    book,
    "/commerce/allocation-plans",
    {
      voucherId: payment.voucherId,
      lineId: payment.lineId,
      evidenceId: source.id,
      rationale: "Allocate the retained payment to the supplier invoice",
      allocations: [{ invoiceId, amountMinor: amount }],
    },
    Commerce.AllocationPlan,
  );

  const approval = await post(
    book,
    `/commerce/allocation-plans/${plan.id}/approvals`,
    { version: 1, planDigest: plan.digest },
    Commerce.AllocationApproval,
  );

  return post(
    book,
    `/commerce/allocation-plans/${plan.id}/apply`,
    { version: 1, planDigest: plan.digest, approvalId: approval.id },
    Commerce.AllocationReceipt,
  );
}

async function invoice(book: BookFixture, invoiceId: string) {
  return decoded(await request(book, `/commerce/invoices/${invoiceId}`), Commerce.Invoice);
}

async function position(book: BookFixture, invoiceId: string) {
  return decoded(
    await request(book, `/commerce/invoices/${invoiceId}/supplier-refund-position`),
    Refunds.SupplierRefundPosition,
  );
}

async function refundRows(book: BookFixture, invoiceId: string) {
  const admin = await database();

  try {
    const refunds = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM openerp.supplier_refunds WHERE book_id = $1 AND invoice_id = $2",
      [book.bookId, invoiceId],
    );

    const increases = await admin.query<{
      apReleaseMinor: string;
      refundIncreaseMinor: string;
    }>(
      'SELECT ap_release_minor::text AS "apReleaseMinor", refund_increase_minor::text AS "refundIncreaseMinor" FROM openerp.supplier_refund_principal_increases WHERE book_id = $1 AND invoice_id = $2',
      [book.bookId, invoiceId],
    );

    const allocations = await admin.query<{ total: string; count: number }>(
      "SELECT coalesce(sum(a.amount_minor),0)::text AS total, count(*)::int AS count FROM openerp.supplier_refund_allocations a JOIN openerp.supplier_refunds r ON (r.book_id,r.id)=(a.book_id,a.refund_id) WHERE r.book_id = $1 AND r.invoice_id = $2",
      [book.bookId, invoiceId],
    );

    const usages = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM openerp.supplier_refund_source_usages u JOIN openerp.supplier_refunds r ON (r.book_id,r.id)=(u.book_id,u.refund_id) WHERE r.book_id = $1 AND r.invoice_id = $2",
      [book.bookId, invoiceId],
    );

    return {
      refunds: refunds.rows[0]?.count ?? 0,
      increases: increases.rows,
      allocationTotal: allocations.rows[0]?.total ?? "0",
      allocationCount: allocations.rows[0]?.count ?? 0,
      sourceUsages: usages.rows[0]?.count ?? 0,
    };
  } finally {
    await admin.end();
  }
}

test("paid credit splits payable release and refund receivable, then two cash refunds settle it", async () => {
  const journey = await recognizedPurchase();
  const { book, invoiceId, acceptance } = journey;

  const original = await invoice(book, invoiceId);
  expect(original.amountMinor).toBe("125000");

  const payment = await paySupplier(book, "100000");
  await allocate(book, payment, invoiceId, "100000");

  const afterPayment = await position(book, invoiceId);
  expect(afterPayment.originalGrossMinor).toBe("125000");
  expect(afterPayment.creditedMinor).toBe("0");
  expect(afterPayment.paidMinor).toBe("100000");
  expect(afterPayment.unpaidMinor).toBe("25000");
  expect(afterPayment.refundPrincipalMinor).toBe("0");
  expect(afterPayment.refundDueMinor).toBe("0");

  const payable = await invoice(book, invoiceId);

  const creditEvidence = await ownEvidence(book, "credit");

  const credit = {
    profile: "swedish-purchase-partial-credit-v1",
    invoiceId,
    acceptanceDigest: acceptance.digest,
    expectedInvoiceRevision: payable.currentRevision.revision,
    expectedAllocationVersion: payable.allocationVersion,
    expectedPosition: {
      originalGrossMinor: "125000",
      creditedMinor: "0",
      paidMinor: "100000",
      refundedMinor: "0",
    },
    creditEvidenceId: creditEvidence.id,
    supplierCreditNumber: "n07-cn-1",
    amountMinor: "50000",
    creditLines: [{ lineId: "line_purchase", netMinor: "40000", sourceTaxMinor: "10000" }],
    creditDate: "2026-09-24",
    accountingPeriodId: "period_2026",
    series: "A",
    reason: "Supplier credit beyond the unpaid residual",
    refundReceivableAccountId: "account_refund_receivable",
    acknowledgePaidCredit: true,
  } as const;

  const creditReview = await post(
    book,
    "/commerce/paid-supplier-credit-reviews",
    credit,
    Refunds.PaidSupplierCreditReview,
  );

  expect(creditReview.snapshot.paid.apReleaseMinor).toBe("25000");
  expect(creditReview.snapshot.paid.refundPrincipalIncreaseMinor).toBe("25000");
  expect(creditReview.snapshot.paid.positionAfter.creditedMinor).toBe("50000");

  const creditApproval = await post(
    book,
    `/commerce/paid-supplier-credit-reviews/${creditReview.id}/approvals`,
    { digest: creditReview.digest, acknowledgePaidCredit: true },
    Refunds.PaidSupplierCreditApproval,
  );

  const creditReceipt = await post(
    book,
    `/commerce/paid-supplier-credit-reviews/${creditReview.id}/execute`,
    {
      digest: creditReview.digest,
      acknowledgePaidCredit: true,
      approvalId: creditApproval.id,
    },
    Refunds.PaidSupplierCreditReceipt,
  );

  expect(creditReceipt.paid).toBe(true);
  expect(creditReceipt.apReleaseMinor).toBe("25000");
  expect(creditReceipt.refundPrincipalIncreaseMinor).toBe("25000");
  expect(creditReceipt.refundPrincipalAfterMinor).toBe("25000");

  const afterCredit = await position(book, invoiceId);
  expect(afterCredit.creditedMinor).toBe("50000");
  expect(afterCredit.unpaidMinor).toBe("0");
  expect(afterCredit.refundPrincipalMinor).toBe("25000");
  expect(afterCredit.refundDueMinor).toBe("25000");
  expect(afterCredit.refundReceivableAccountId).toBe("account_refund_receivable");

  // The legacy live invoice keeps the credit in its credited total and the
  // unpaid residual clamps at zero instead of going negative.
  const settledPayable = await invoice(book, invoiceId);

  // A new key for the same credit-note identity is not another refund
  // entitlement, even when the caller sends the now-current position.
  const secondKey = await ownEvidence(book, "duplicate identity");

  await failure(
    await request(book, "/commerce/paid-supplier-credit-reviews", {
      method: "POST",
      body: JSON.stringify({
        ...credit,
        creditEvidenceId: secondKey.id,
        expectedPosition: {
          originalGrossMinor: "125000",
          creditedMinor: "50000",
          paidMinor: "100000",
          refundedMinor: "0",
        },
        expectedAllocationVersion: settledPayable.allocationVersion,
      }),
    }),
    409,
    "IdempotencyConflict",
  );
  expect(settledPayable.creditedMinor).toBe("50000");
  expect(settledPayable.outstandingMinor).toBe("0");
  expect(settledPayable.blockers).toEqual([]);

  const firstRefundEvidence = await ownEvidence(book, "refund one");

  const firstRefund = {
    invoiceId,
    expectedInvoiceRevision: settledPayable.currentRevision.revision,
    expectedAllocationVersion: settledPayable.allocationVersion,
    expectedRefundDueMinor: "25000",
    expectedRefundedMinor: "0",
    refundDate: "2026-09-25",
    accountingPeriodId: "period_2026",
    series: "A",
    reason: "First supplier refund receipt",
    refundReceivableAccountId: "account_refund_receivable",
    refundEvidenceId: firstRefundEvidence.id,
    amountMinor: "10000",
    allocations: [{ allocationId: "refund_part_1", amountMinor: "10000" }],
    source: {
      kind: "unposted_cash",
      bankAccountId: "account_bank",
      evidenceId: firstRefundEvidence.id,
    },
  } as const;

  const refundReview = await post(
    book,
    "/commerce/supplier-refund-reviews",
    firstRefund,
    Refunds.SupplierRefundReview,
  );

  expect(refundReview.postingPlan).not.toBeNull();

  const refundApproval = await post(
    book,
    `/commerce/supplier-refund-reviews/${refundReview.id}/approvals`,
    { digest: refundReview.digest },
    Refunds.SupplierRefundApproval,
  );

  const refundReceipt = await post(
    book,
    `/commerce/supplier-refund-reviews/${refundReview.id}/execute`,
    { digest: refundReview.digest, approvalId: refundApproval.id },
    Refunds.SupplierRefundReceipt,
  );

  expect(refundReceipt.sourceKind).toBe("unposted_cash");
  expect(refundReceipt.voucherId).not.toBeNull();

  const afterFirstRefund = await position(book, invoiceId);
  expect(afterFirstRefund.refundedMinor).toBe("10000");
  expect(afterFirstRefund.refundDueMinor).toBe("15000");

  // Over-capacity refuses whole, with no partial posting.
  const overCapacity = await invoice(book, invoiceId);

  const overEvidence = await ownEvidence(book, "refund over");

  await failure(
    await request(book, "/commerce/supplier-refund-reviews", {
      method: "POST",
      body: JSON.stringify({
        ...firstRefund,
        expectedInvoiceRevision: overCapacity.currentRevision.revision,
        expectedAllocationVersion: overCapacity.allocationVersion,
        refundDate: "2026-09-26",
        refundEvidenceId: overEvidence.id,
        amountMinor: "16000",
        allocations: [{ allocationId: "refund_over", amountMinor: "16000" }],
        source: {
          kind: "unposted_cash",
          bankAccountId: "account_bank",
          evidenceId: overEvidence.id,
        },
      }),
    }),
    409,
    "StaleDependency",
  );

  const secondRefundEvidence = await ownEvidence(book, "refund two");

  const secondReview = await post(
    book,
    "/commerce/supplier-refund-reviews",
    {
      ...firstRefund,
      expectedInvoiceRevision: overCapacity.currentRevision.revision,
      expectedAllocationVersion: overCapacity.allocationVersion,
      expectedRefundDueMinor: "15000",
      expectedRefundedMinor: "10000",
      refundDate: "2026-09-26",
      reason: "Second supplier refund receipt",
      refundEvidenceId: secondRefundEvidence.id,
      amountMinor: "15000",
      allocations: [{ allocationId: "refund_part_2", amountMinor: "15000" }],
      source: {
        kind: "unposted_cash",
        bankAccountId: "account_bank",
        evidenceId: secondRefundEvidence.id,
      },
    },
    Refunds.SupplierRefundReview,
  );

  const secondApproval = await post(
    book,
    `/commerce/supplier-refund-reviews/${secondReview.id}/approvals`,
    { digest: secondReview.digest },
    Refunds.SupplierRefundApproval,
  );

  const secondReceipt = await post(
    book,
    `/commerce/supplier-refund-reviews/${secondReview.id}/execute`,
    { digest: secondReview.digest, approvalId: secondApproval.id },
    Refunds.SupplierRefundReceipt,
  );

  expect(secondReceipt.amountMinor).toBe("15000");

  const settled = await position(book, invoiceId);
  expect(settled.refundedMinor).toBe("25000");
  expect(settled.refundDueMinor).toBe("0");
  expect(settled.refundPrincipalMinor).toBe("25000");

  const rows = await refundRows(book, invoiceId);
  expect(rows.refunds).toBe(2);
  expect(rows.increases).toHaveLength(1);
  expect(rows.increases[0]?.apReleaseMinor).toBe("25000");
  expect(rows.increases[0]?.refundIncreaseMinor).toBe("25000");
  expect(rows.allocationTotal).toBe("25000");
  expect(rows.allocationCount).toBe(2);
  expect(rows.sourceUsages).toBe(2);

  const history = await decoded(
    await request(book, `/commerce/invoices/${invoiceId}/supplier-refunds`),
    Refunds.SupplierRefundHistory,
  );

  expect(history.position.refundDueMinor).toBe("0");

  const kinds = history.items.map((item) => item.kind);
  expect(kinds).toContain("credit");
  expect(kinds).toContain("payment");
  expect(kinds).toContain("principal_increase");
  expect(kinds.filter((kind) => kind === "refund")).toHaveLength(2);

  await writeFile(
    join(environment().artifacts, "next-07-paid-credit-refund-journey.json"),
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        bookId: book.bookId,
        packetVectors: {
          G: "125000",
          P: "100000",
          K: "50000",
          Q: "25000",
          unpaidAfterCredit: settled.unpaidMinor,
          refundPrincipalAfterCredit: "25000",
          apRelease: creditReceipt.apReleaseMinor,
          refundIncrease: creditReceipt.refundPrincipalIncreaseMinor,
        },
        positionAfterPayment: afterPayment,
        positionAfterCredit: afterCredit,
        positionSettled: settled,
        refunds: rows,
        historyKinds: kinds,
        limitations:
          "Synthetic synthetic-core-v1 book. The 100000 payment is a separately posted synthetic journal, not a bank-confirmed settlement. No real-company VAT activation, provider receipt or statutory claim is established.",
      },
      null,
      2,
    ),
  );
}, 120_000);

test("a paid credit is refused without an approval, on stale position and without a refund receivable", async () => {
  const journey = await recognizedPurchase();
  const { book, invoiceId, acceptance } = journey;

  const payment = await paySupplier(book, "100000");
  await allocate(book, payment, invoiceId, "100000");
  const payable = await invoice(book, invoiceId);

  const creditEvidence = await ownEvidence(book, "credit");

  const base = {
    profile: "swedish-purchase-partial-credit-v1",
    invoiceId,
    acceptanceDigest: acceptance.digest,
    expectedInvoiceRevision: payable.currentRevision.revision,
    expectedAllocationVersion: payable.allocationVersion,
    expectedPosition: {
      originalGrossMinor: "125000",
      creditedMinor: "0",
      paidMinor: "100000",
      refundedMinor: "0",
    },
    creditEvidenceId: creditEvidence.id,
    supplierCreditNumber: "n07-cn-x",
    amountMinor: "50000",
    creditLines: [{ lineId: "line_purchase", netMinor: "40000", sourceTaxMinor: "10000" }],
    creditDate: "2026-09-24",
    accountingPeriodId: "period_2026",
    series: "A",
    reason: "Refusal probe",
    refundReceivableAccountId: "account_refund_receivable",
    acknowledgePaidCredit: true,
  } as const;

  // A stale expected position is refused, not re-derived.
  await failure(
    await request(book, "/commerce/paid-supplier-credit-reviews", {
      method: "POST",
      body: JSON.stringify({
        ...base,
        expectedPosition: { ...base.expectedPosition, paidMinor: "0" },
      }),
    }),
    409,
    "StaleDependency",
  );

  // A reserved control account can never be the refund receivable.
  await failure(
    await request(book, "/commerce/paid-supplier-credit-reviews", {
      method: "POST",
      body: JSON.stringify({ ...base, refundReceivableAccountId: "account_payable" }),
    }),
    409,
    "StaleDependency",
  );

  // A credit beyond the remaining original-line capacity is refused whole.
  await failure(
    await request(book, "/commerce/paid-supplier-credit-reviews", {
      method: "POST",
      body: JSON.stringify({
        ...base,
        amountMinor: "125000",
        creditLines: [{ lineId: "line_purchase", netMinor: "100000", sourceTaxMinor: "50000" }],
      }),
    }),
    422,
    "InvalidJournal",
  );

  const review = await post(
    book,
    "/commerce/paid-supplier-credit-reviews",
    base,
    Refunds.PaidSupplierCreditReview,
  );

  // Execution without an approval is refused.
  await failure(
    await request(book, `/commerce/paid-supplier-credit-reviews/${review.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        digest: review.digest,
        acknowledgePaidCredit: true,
        approvalId: "approval_missing",
      }),
    }),
    403,
    "ApprovalRequired",
  );

  // Execution with a wrong digest is refused.

  const approval = await post(
    book,
    `/commerce/paid-supplier-credit-reviews/${review.id}/approvals`,
    { digest: review.digest, acknowledgePaidCredit: true },
    Refunds.PaidSupplierCreditApproval,
  );

  await failure(
    await request(book, `/commerce/paid-supplier-credit-reviews/${review.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        acknowledgePaidCredit: true,
        approvalId: approval.id,
      }),
    }),
    409,
    "StaleDependency",
  );
}, 120_000);

test("a reversal of the payment consumed by the refund receivable is refused", async () => {
  const journey = await recognizedPurchase();
  const { book, invoiceId, acceptance } = journey;

  const payment = await paySupplier(book, "100000");
  const allocation = await allocate(book, payment, invoiceId, "100000");
  const payable = await invoice(book, invoiceId);

  const creditEvidence = await ownEvidence(book, "credit");

  const credit = await post(
    book,
    "/commerce/paid-supplier-credit-reviews",
    {
      profile: "swedish-purchase-partial-credit-v1",
      invoiceId,
      acceptanceDigest: acceptance.digest,
      expectedInvoiceRevision: payable.currentRevision.revision,
      expectedAllocationVersion: payable.allocationVersion,
      expectedPosition: {
        originalGrossMinor: "125000",
        creditedMinor: "0",
        paidMinor: "100000",
        refundedMinor: "0",
      },
      creditEvidenceId: creditEvidence.id,
      supplierCreditNumber: "n07-cn-r",
      amountMinor: "50000",
      creditLines: [{ lineId: "line_purchase", netMinor: "40000", sourceTaxMinor: "10000" }],
      creditDate: "2026-09-24",
      accountingPeriodId: "period_2026",
      series: "A",
      reason: "Raise a refund receivable that consumes the payment",
      refundReceivableAccountId: "account_refund_receivable",
      acknowledgePaidCredit: true,
    },
    Refunds.PaidSupplierCreditReview,
  );

  const approval = await post(
    book,
    `/commerce/paid-supplier-credit-reviews/${credit.id}/approvals`,
    { digest: credit.digest, acknowledgePaidCredit: true },
    Refunds.PaidSupplierCreditApproval,
  );

  await post(
    book,
    `/commerce/paid-supplier-credit-reviews/${credit.id}/execute`,
    { digest: credit.digest, acknowledgePaidCredit: true, approvalId: approval.id },
    Refunds.PaidSupplierCreditReceipt,
  );

  const admin = await database();

  try {
    const active = await admin.query<{ present: boolean }>(
      `select exists (
         select 1 from openerp.commerce_allocation_receipts r
         where r.book_id = $1 and r.id = $2
           and not exists (
             select 1 from openerp.commerce_allocation_reversals v
             where v.book_id = r.book_id and v.receipt_id = r.id)) as present`,
      [book.bookId, allocation.id],
    );

    expect(active.rows[0]?.present).toBe(true);
  } finally {
    await admin.end();
  }

  // The payment is now consumed by a posted refund receivable, so a
  // standalone reversal must refuse rather than orphan the receivable.
  await failure(
    await request(book, "/commerce/allocation-reversal-plans", {
      method: "POST",
      body: JSON.stringify({
        receiptId: allocation.id,
        reason: "Standalone payment reversal after a posted refund receivable",
      }),
    }),
    409,
    "StaleDependency",
  );
}, 120_000);
