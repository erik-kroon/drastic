import * as Reports from "@open-erp/contracts/register-reports";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Cash from "@open-erp/contracts/cash-method";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import { allocateCash, cashFixture, postedCash } from "./support/cash-payment";
import { database, decoded, failure, key, post, request } from "./support/fixtures";
import { createDraft } from "./support/supplier-review";

// The admitted original must remain visible without inventing GL recognition,
// a ledger difference, or any financial write. Earlier economic cutoffs exclude it.
test("cash commercial debt is visible in an immutable register snapshot with zero recognized outstanding", async () => {
  const { book, invoice } = await cashFixture();
  const commandKey = key();

  const send = () =>
    request(book, "/commerce/register-snapshots", {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify({ asOfDate: "2026-09-30" }),
    });

  const report = await decoded(await send(), Reports.RegisterReport);

  expect(report.invoiceCount).toBe(1);
  expect(report.status).toBe("balanced");
  expect(report.invoices).toEqual([
    expect.objectContaining({
      id: invoice.id,
      recognition: null,
      amountMinor: "125000",
      outstandingMinor: "125000",
      commercialOutstandingMinor: "125000",
      recognizedMinor: "0",
      recognizedOutstandingMinor: "0",
    }),
  ]);
  expect(report.controls).toEqual([
    expect.objectContaining({
      recognizedMinor: "0",
      outstandingMinor: "0",
      commercialOutstandingMinor: "125000",
      recognizedOutstandingMinor: "0",
      ledgerMinor: "0",
      differenceMinor: "0",
      unexplainedLineCount: 0,
    }),
  ]);
  expect(report.ledgerLines).toEqual([]);
  expect(await decoded(await send(), Reports.RegisterReport)).toEqual(report);
  expect(
    await decoded(
      await request(book, `/commerce/register-snapshots/${report.id}`),
      Reports.RegisterReport,
    ),
  ).toEqual(report);

  const before = await decoded(
    await request(book, "/commerce/register-snapshots", {
      method: "POST",
      body: JSON.stringify({ asOfDate: "2026-09-21" }),
    }),
    Reports.RegisterReport,
  );

  expect(before.invoiceCount).toBe(0);

  const admin = await database();

  try {
    const retained = await admin.query(
      "select body from openerp.commerce_register_snapshots where book_id=$1 and id=$2",
      [book.bookId, report.id],
    );

    expect(retained.rows[0]?.body).toEqual(report);

    const financial = await admin.query(
      "select (select count(*)::text from openerp.vouchers where book_id=$1) as vouchers, (select count(*)::text from openerp.journal_lines where book_id=$1) as lines, (select count(*)::text from openerp.cash_method_recognitions where book_id=$1) as recognitions",
      [book.bookId],
    );

    expect(financial.rows).toEqual([{ vouchers: "0", lines: "0", recognitions: "0" }]);
  } finally {
    await admin.end();
  }
}, 240000);

test("register capture refuses a cash allocation lacking its owned recognition history", async () => {
  const context = await cashFixture();
  const cash = await postedCash(context.book);
  const plan = await allocateCash(context, cash);

  const approval = await post(
    context.reviewer,
    `/commerce/allocation-plans/${plan.id}/approvals`,
    {
      version: 1,
      planDigest: plan.digest,
    },
    Commerce.AllocationApproval,
  );

  const admin = await database();

  try {
    // Deliberately incomplete synthetic persistence: valid scoped FKs but no
    // atomic cash-owner application. Do not disable any integrity constraints.
    const receiptId = `malformed_cash_allocation_${key()}`;
    await admin.query(
      "insert into openerp.commerce_allocation_receipts(book_id,id,plan_id,approval_id,body) values($1,$2,$3,$4,'{}'::jsonb)",
      [context.book.bookId, receiptId, plan.id, approval.id],
    );
    await admin.query(
      "insert into openerp.commerce_allocation_legs(book_id,receipt_id,ordinal,invoice_id,payment_voucher_id,payment_line_id,amount_minor) values($1,$2,1,$3,$4,$5,50000)",
      [
        context.book.bookId,
        receiptId,
        context.invoice.id,
        cash.posted.voucherId,
        cash.clearingLineId,
      ],
    );
    await failure(
      await request(context.book, "/commerce/register-snapshots", {
        method: "POST",
        body: JSON.stringify({ asOfDate: "2026-09-30" }),
      }),
      422,
      "InvalidJournal",
    );

    const snapshots = await admin.query(
      "select count(*)::text as total from openerp.commerce_register_snapshots where book_id=$1",
      [context.book.bookId],
    );

    expect(snapshots.rows).toEqual([{ total: "0" }]);
  } finally {
    await admin.end();
  }
}, 240000);

test.each([
  {
    recognized: false,
    date: "2026-10-01",
    periodId: "period_2026",
    recognizedCredit: "0",
    recognizedOutstanding: "0",
  },
  {
    recognized: true,
    date: "2027-01-22",
    periodId: "period_2027",
    recognizedCredit: "25000",
    recognizedOutstanding: "100000",
  },
])(
  "retained cash credit snapshot distinguishes recognized=$recognized debt",
  async ({ recognized, date, periodId, recognizedCredit, recognizedOutstanding }) => {
    const context = await cashFixture();

    if (recognized) {
      const admin = await database();

      try {
        await admin.query(
          "insert into openerp.fiscal_years(book_id,id,starts_on,ends_on) values($1,'fy_2027','2027-01-01','2027-12-31')",
          [context.book.bookId],
        );
        await admin.query(
          "insert into openerp.periods(book_id,id,fiscal_year_id,starts_on,ends_on) values($1,'period_2027','fy_2027','2027-01-01','2027-12-31')",
          [context.book.bookId],
        );
        await admin.query(
          "insert into openerp.rule_releases(id,jurisdiction,family,version,checksum,body) select id||'_2027',jurisdiction,family,39,checksum,body||jsonb_build_object('id',id||'_2027','version',39,'validFrom','2027-01-01','validTo','2027-12-31') from openerp.rule_releases where id in('next38_synthetic_posting_eligibility','next38_synthetic_vat') on conflict(id) do nothing",
        );
      } finally {
        await admin.end();
      }

      const yearEvidence = await post(
        context.book,
        "/evidence",
        {
          title: "Synthetic complete register year-end review",
          content:
            "Independent review of the complete native unpaid population; separate from invoice and credit originals.",
          mediaType: "text/plain",
          origin: "NEXT-38 register credit cutover fixture",
        },
        Accounting.Evidence,
      );

      const year = await post(
        context.book,
        "/commerce/cash-method/year-end",
        {
          fiscalYearId: "fy_2026",
          cutoffOn: "2026-12-31",
          evidenceId: yearEvidence.id,
          rationale: "Recognize complete synthetic unpaid population",
          series: "A",
        },
        Cash.CashYearEndPlan,
      );

      const yearApproval = await post(
        context.reviewer,
        `/commerce/cash-method/year-end/${year.id}/approvals`,
        {
          planDigest: year.digest,
        },
        Cash.CashYearEndApproval,
      );

      await post(
        context.book,
        `/commerce/cash-method/year-end/${year.id}/execute`,
        {
          planDigest: year.digest,
          approvalId: yearApproval.id,
        },
        Cash.CashYearEndReceipt,
      );
    }

    const evidence = await post(
      context.book,
      "/evidence",
      {
        title: "Synthetic register credit",
        content:
          "Unpaid original125000=N100000+VAT25000; linked suffix credit25000=N20000+VAT5000; commercial residual100000. No cash refund.",
        mediaType: "text/plain",
        origin: "NEXT-38 independent register expectation",
      },
      Accounting.Evidence,
    );

    const sourceLine = context.draft.content.lines[0];
    const basis = Schema.decodeUnknownSync(Cash.CashInvoiceBasis)(context.invoice.cashMethod);
    const originalTreatment = basis.lines[0]?.treatment;

    if (!sourceLine || !originalTreatment) throw new Error("Missing original cash source line");

    const creditDraft = await createDraft(context.book, {
      ...context.draft.content,
      sourceEvidenceId: evidence.id,
      supplierDocumentNumber: `REGISTER-CREDIT-${key()}`,
      documentDate: date,
      supplyDate: date,
      dueDate: date,
      supplier: { ...context.draft.content.supplier, evidenceId: evidence.id },
      buyer: { ...context.draft.content.buyer, evidenceId: evidence.id },
      sourceTotalMinor: "25000",
      lines: [
        {
          ...sourceLine,
          id: "credit_line",
          unitPriceMinor: "20000",
          baseMinor: "20000",
          taxMinor: "5000",
          sourceGrossMinor: "25000",
          taxEvidenceId: evidence.id,
        },
      ],
    });

    const creditReviewer = context.reviewer;

    const plan = await post(
      context.book,
      "/commerce/cash-method/credits",
      {
        invoiceId: context.invoice.id,
        draftId: creditDraft.id,
        expectedRevision: creditDraft.revision,
        expectedDigest: creditDraft.digest,
        accountingPeriodId: periodId,
        series: "A",
        lineMappings: [
          {
            creditLineId: "credit_line",
            sourceLineId: sourceLine.id,
            treatment: originalTreatment,
          },
        ],
        rationale: "Credit retained unpaid original with only the owned recognized correction",
      },
      Cash.CashCreditPlan,
    );

    expect(plan.createdBy).toBe(context.book.actorId);
    expect(creditReviewer.actorId).not.toBe(plan.createdBy);

    const approval = await post(
      creditReviewer,
      `/commerce/cash-method/credits/${plan.id}/approvals`,
      {
        planDigest: plan.digest,
      },
      Cash.CashCreditApproval,
    );

    expect(approval.actorId).toBe(creditReviewer.actorId);
    expect(approval.actorId).not.toBe(plan.createdBy);

    const receipt = await post(
      context.book,
      `/commerce/cash-method/credits/${plan.id}/execute`,
      {
        planDigest: plan.digest,
        approvalId: approval.id,
      },
      Cash.CashCreditReceipt,
    );

    expect(receipt.recognizedCorrectionMinor).toBe(recognizedCredit);
    expect(receipt.postingReceipt === null).toBe(!recognized);

    const report = await post(
      context.book,
      "/commerce/register-snapshots",
      {
        asOfDate: date,
      },
      Reports.RegisterReport,
    );

    expect(report.status).toBe("balanced");
    expect(report.invoices).toEqual([
      expect.objectContaining({
        creditedMinor: "25000",
        recognizedCreditedMinor: recognizedCredit,
        commercialOutstandingMinor: "100000",
        recognizedOutstandingMinor: recognizedOutstanding,
      }),
    ]);
    expect(report.controls).toEqual([
      expect.objectContaining({
        creditedMinor: "25000",
        recognizedCreditedMinor: recognizedCredit,
        commercialOutstandingMinor: "100000",
        recognizedOutstandingMinor: recognizedOutstanding,
        ledgerMinor: recognizedOutstanding,
        differenceMinor: "0",
        unexplainedLineCount: 0,
      }),
    ]);
    expect(report.ledgerLines.every((line) => line.unexplainedMinor === "0")).toBe(true);
    expect(report.ledgerLines).toHaveLength(recognized ? 2 : 0);

    if (recognized) {
      expect(report.ledgerLines.filter((line) => line.creditId === receipt.id)).toEqual([
        expect.objectContaining({
          debitMinor: "25000",
          creditMinor: "0",
          registerContributionKind: "credit",
          registerEffectMinor: "-25000",
          unexplainedMinor: "0",
        }),
      ]);

      const beforeCredit = await post(
        context.book,
        "/commerce/register-snapshots",
        {
          asOfDate: "2026-12-31",
        },
        Reports.RegisterReport,
      );

      expect(beforeCredit.invoices).toEqual([
        expect.objectContaining({
          creditedMinor: "0",
          recognizedCreditedMinor: "0",
          commercialOutstandingMinor: "125000",
          recognizedOutstandingMinor: "125000",
        }),
      ]);
      expect(beforeCredit.controls).toEqual([
        expect.objectContaining({
          ledgerMinor: "125000",
          differenceMinor: "0",
          unexplainedLineCount: 0,
        }),
      ]);
      expect(beforeCredit.ledgerLines.every((line) => line.unexplainedMinor === "0")).toBe(true);
    }

    const earlier = await post(
      context.book,
      "/commerce/register-snapshots",
      {
        asOfDate: "2026-09-30",
      },
      Reports.RegisterReport,
    );

    expect(earlier.invoices).toEqual([
      expect.objectContaining({
        creditedMinor: "0",
        commercialOutstandingMinor: "125000",
        recognizedOutstandingMinor: "0",
      }),
    ]);
  },
  240000,
);

test("cash payment reduces commercial debt without creating recognized unpaid debt or unexplained control lines", async () => {
  const context = await cashFixture();
  const cash = await postedCash(context.book);
  const plan = await allocateCash(context, cash);

  const approval = await post(
    context.reviewer,
    `/commerce/allocation-plans/${plan.id}/approvals`,
    {
      version: 1,
      planDigest: plan.digest,
    },
    Commerce.AllocationApproval,
  );

  await post(
    context.book,
    `/commerce/allocation-plans/${plan.id}/apply`,
    {
      version: 1,
      planDigest: plan.digest,
      approvalId: approval.id,
    },
    Commerce.AllocationReceipt,
  );

  const report = await post(
    context.book,
    "/commerce/register-snapshots",
    {
      asOfDate: "2026-09-30",
    },
    Reports.RegisterReport,
  );

  expect(report.status).toBe("balanced");
  expect(report.invoices).toEqual([
    expect.objectContaining({
      id: context.invoice.id,
      commercialOutstandingMinor: "75000",
      recognizedMinor: "50000",
      recognizedOutstandingMinor: "0",
    }),
  ]);
  expect(report.controls).toEqual([
    expect.objectContaining({
      commercialOutstandingMinor: "75000",
      recognizedOutstandingMinor: "0",
      ledgerMinor: "0",
      differenceMinor: "0",
      unexplainedLineCount: 0,
    }),
  ]);
  expect(report.ledgerLines.every((line) => line.unexplainedMinor === "0")).toBe(true);
}, 240000);
