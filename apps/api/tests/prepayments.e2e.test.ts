import { expect, test } from "vitest";
import * as Prep from "@open-erp/contracts/prepayments";
import * as Subledgers from "@open-erp/contracts/subledgers";
import {
  database,
  decoded,
  evidence,
  failure,
  fixture,
  key,
  post,
  request,
} from "./support/fixtures";

// NEXT-31 invoice-linked prepayments and accrued-cost true-up, proven over
// real HTTP against the restricted runtime role and a real PostgreSQL.
//
// The expectations are computed by hand from the leaf's stated arithmetic and
// checked against the retained rows. The load-bearing claim is that a residual
// is a computed difference and never a plug: an overestimated accrual credits
// expense by exactly the overestimate, and the remaining capacity is always
// the original less what was consumed.

const path = "/subledger/accrued-costs";

// The released schedule owner, used exactly as an existing schedule is used.
async function schedule(
  book: Awaited<ReturnType<typeof fixture>>,
  sourceKey: string,
  terms: typeof Subledgers.ScheduleTerms.Type,
) {
  return post(book, "/schedules", { sourceKey, terms }, Subledgers.ScheduleRevision);
}

test("a purchase cost splits exactly across reviewed service coverage, with no tax fact", async () => {
  const book = await fixture([
    { id: "account_prepaid", code: "2990", name: "Prepaid expenses" },
    { id: "account_service", code: "6540", name: "Service cost" },
  ]);

  const source = await evidence(book);

  const created = await schedule(book, "prepay_one", {
    kind: "deferral",
    name: "Annual support retained",
    evidenceId: source.id,
    rationale: "Synthetic service spanning two accounting years",
    costMinor: "12000",
    residualMinor: "0",
    usefulPeriods: 2,
    allocationPolicy: "equal_minor_final_remainder_v1",
    debitAccountId: "account_prepaid",
    creditAccountId: "account_service",
    series: "A",
    taxAssessment: "not_applicable",
    periods: [
      { postingDate: "2026-01-31", accountingPeriodId: "period_2026" },
      { postingDate: "2026-12-31", accountingPeriodId: "period_2026" },
    ],
  });

  expect(created.terms.costMinor).toBe("12000");
  expect(created.scheduleId).toBeTruthy();

  // Two service periods, with the cutoff exactly at the first period's
  // exclusive end. A period is consumed only once it has fully elapsed, so
  // the first is recognized now and the second still defers. Daily weights over
  // 2026-01-01..2026-07-01 and 2026-07-01..2027-01-01 give 181 and 184 days of
  // a 365-day service, and the residual lands on the last installment so the
  // shares still sum to exactly the cost.
  const plan = await decoded(
    await request(book, `${path}/bases`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        purchaseRecognitionId: "recognition_synthetic",
        scheduleId: created.scheduleId,
        costMinor: "12000",
        currency: "SEK",
        serviceStartsOn: "2026-01-01",
        serviceEndsOnExclusive: "2027-01-01",
        serviceEvidenceId: source.id,
        reviewedCutoffOn: "2026-07-01",
        policy: "daily",
        residual: "last_installment",
        contractualWeights: [],
        periods: [
          { periodId: "period_h1", startsOn: "2026-01-01", endsOnExclusive: "2026-07-01" },
          { periodId: "period_h2", startsOn: "2026-07-01", endsOnExclusive: "2027-01-01" },
        ],
        prepaidAccountId: "account_prepaid",
        expenseAccountId: "account_service",
        rationale: "Reviewed service coverage for the deferred cost",
      }),
    }),
    Prep.PrepaymentPlanView,
  );

  // 12000 * 181 / 365 = 5950.68..., and 12000 * 184 / 365 = 6049.31.... The
  // designated last installment absorbs the residual, so the shares sum to
  // exactly 12000. The split is a computed difference, never a rounded plug.
  expect(plan.costMinor).toBe("12000");
  expect(plan.recognizedNowMinor).toBe("5950");
  expect(plan.futureMinor).toBe("6050");
  expect(BigInt(plan.recognizedNowMinor) + BigInt(plan.futureMinor)).toBe(12000n);
  expect(plan.installments).toHaveLength(2);
  expect(plan.installments[0]?.periodId).toBe("period_h1");
  expect(plan.installments[0]?.shareMinor).toBe("5950");
  expect(plan.installments[0]?.consumed).toBe(true);
  expect(plan.installments[1]?.periodId).toBe("period_h2");
  expect(plan.installments[1]?.shareMinor).toBe("6050");
  expect(plan.installments[1]?.consumed).toBe(false);
  // The cost excluded deductible input VAT, and that is recorded rather than
  // left implied: deferring changes expense timing, never a VAT tax point.
  expect(plan.taxTreatment).toBe("no_tax_fact_defers_expense_timing_only");

  // A second basis over the same schedule would defer the same cost twice.
  await failure(
    await request(book, `${path}/bases`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        purchaseRecognitionId: "recognition_other",
        scheduleId: created.scheduleId,
        costMinor: "6000",
        currency: "SEK",
        serviceStartsOn: "2026-01-01",
        serviceEndsOnExclusive: "2027-01-01",
        serviceEvidenceId: source.id,
        reviewedCutoffOn: "2026-07-01",
        policy: "daily",
        residual: "last_installment",
        contractualWeights: [],
        periods: [
          { periodId: "period_h1", startsOn: "2026-01-01", endsOnExclusive: "2026-07-01" },
          { periodId: "period_h2", startsOn: "2026-07-01", endsOnExclusive: "2027-01-01" },
        ],
        prepaidAccountId: "account_prepaid",
        expenseAccountId: "account_service",
        rationale: "A second deferral over the same schedule",
      }),
    }),
    409,
    "IdempotencyConflict",
  );

  // A deferral naming a schedule that does not exist refuses: capacity with no
  // occurrence behind it is not a deferral.
  await failure(
    await request(book, `${path}/bases`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        purchaseRecognitionId: "recognition_missing",
        scheduleId: "schedule_does_not_exist",
        costMinor: "6000",
        currency: "SEK",
        serviceStartsOn: "2026-01-01",
        serviceEndsOnExclusive: "2027-01-01",
        serviceEvidenceId: source.id,
        reviewedCutoffOn: "2026-07-01",
        policy: "daily",
        residual: "last_installment",
        contractualWeights: [],
        periods: [
          { periodId: "period_h1", startsOn: "2026-01-01", endsOnExclusive: "2026-07-01" },
          { periodId: "period_h2", startsOn: "2026-07-01", endsOnExclusive: "2027-01-01" },
        ],
        prepaidAccountId: "account_prepaid",
        expenseAccountId: "account_service",
        rationale: "A deferral against a schedule that was never created",
      }),
    }),
    404,
    "NotFound",
  );
}, 180000);

test("an accrual resolves against its invoice with a signed true-up and one resolution per invoice", async () => {
  const book = await fixture([
    { id: "account_accrued", code: "2995", name: "Accrued expenses" },
    { id: "account_vat", code: "2640", name: "Input VAT" },
    { id: "account_payable", code: "2440", name: "Supplier payable" },
  ]);

  const source = await evidence(book);
  const invoice = await evidence(book);

  const accrual = await decoded(
    await request(book, path, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        serviceIdentity: "consulting-2026-q1",
        expectedCostMinor: "10000",
        currency: "SEK",
        expenseAccountId: "account_clearing",
        accruedLiabilityAccountId: "account_accrued",
        evidenceId: source.id,
        reviewedOn: "2026-03-31",
        postingDate: "2026-03-31",
        series: "A",
      }),
    }),
    Prep.AccruedCostView,
  );

  expect(accrual.originalMinor).toBe("10000");
  expect(accrual.resolvedMinor).toBe("0");
  expect(accrual.remainingMinor).toBe("10000");
  expect(accrual.resolutions).toHaveLength(0);

  // A second accrual for the same reviewed service identity would carry the
  // same expected cost twice.
  await failure(
    await request(book, path, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        serviceIdentity: "consulting-2026-q1",
        expectedCostMinor: "10000",
        currency: "SEK",
        expenseAccountId: "account_clearing",
        accruedLiabilityAccountId: "account_accrued",
        evidenceId: source.id,
        reviewedOn: "2026-03-31",
        postingDate: "2026-03-31",
        series: "A",
      }),
    }),
    409,
    "IdempotencyConflict",
  );

  // An estimate with no evidence of the service is not an accrual.
  await failure(
    await request(book, path, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        serviceIdentity: "consulting-2026-q2",
        expectedCostMinor: "10000",
        currency: "SEK",
        expenseAccountId: "account_clearing",
        accruedLiabilityAccountId: "account_accrued",
        evidenceId: "evidence_never_retained",
        reviewedOn: "2026-06-30",
        postingDate: "2026-06-30",
        series: "A",
      }),
    }),
    422,
    "MissingEvidence",
  );

  // The invoice costs 8000 net plus 2000 deductible tax, so the estimate was
  // an overestimate: the true-up is -2000, a credit on expense.
  const resolution = await decoded(
    await request(book, `${path}/resolutions`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        accrualId: accrual.accrualId,
        invoiceIdentity: "invoice_001",
        invoiceEvidenceId: invoice.id,
        serviceIdentity: "consulting-2026-q1",
        consumedMinor: "8000",
        actualNetMinor: "8000",
        deductibleTaxMinor: "2000",
        expenseAccountId: "account_clearing",
        taxAccountId: "account_vat",
        payableAccountId: "account_payable",
        accruedLiabilityAccountId: "account_accrued",
        postingDate: "2026-04-30",
        series: "A",
        rationale: "Invoice received for the reviewed service",
      }),
    }),
    Prep.AccrualResolutionView,
  );

  expect(resolution.trueUpMinor).toBe("0");
  expect(resolution.payableMinor).toBe("10000");
  // 10000 original less 8000 consumed.
  expect(resolution.remainingMinor).toBe("2000");

  const after = await decoded(
    await request(book, `${path}/state`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ accrualId: accrual.accrualId }),
    }),
    Prep.AccruedCostView,
  );

  expect(after.resolvedMinor).toBe("8000");
  expect(after.remainingMinor).toBe("2000");
  expect(after.resolutions).toHaveLength(1);
  expect(after.resolutions[0]?.invoiceIdentity).toBe("invoice_001");
  expect(after.resolutions[0]?.changeSetId).toBe(resolution.changeSetId);

  // One invoice resolves an accrual once, bound to the invoice's own identity
  // rather than to a command key, so a new key still collides.
  await failure(
    await request(book, `${path}/resolutions`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        accrualId: accrual.accrualId,
        invoiceIdentity: "invoice_001",
        invoiceEvidenceId: invoice.id,
        serviceIdentity: "consulting-2026-q1",
        consumedMinor: "2000",
        actualNetMinor: "2000",
        deductibleTaxMinor: "500",
        expenseAccountId: "account_clearing",
        taxAccountId: "account_vat",
        payableAccountId: "account_payable",
        accruedLiabilityAccountId: "account_accrued",
        postingDate: "2026-05-31",
        series: "A",
        rationale: "The same invoice presented again under a new command key",
      }),
    }),
    409,
    "IdempotencyConflict",
  );

  // An invoice that describes a different service cannot resolve this accrual.
  await failure(
    await request(book, `${path}/resolutions`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        accrualId: accrual.accrualId,
        invoiceIdentity: "invoice_002",
        invoiceEvidenceId: invoice.id,
        serviceIdentity: "consulting-2026-q2",
        consumedMinor: "2000",
        actualNetMinor: "2000",
        deductibleTaxMinor: "500",
        expenseAccountId: "account_clearing",
        taxAccountId: "account_vat",
        payableAccountId: "account_payable",
        accruedLiabilityAccountId: "account_accrued",
        postingDate: "2026-05-31",
        series: "A",
        rationale: "An invoice for a service this accrual was not raised for",
      }),
    }),
    409,
    "StaleDependency",
  );

  // A second, genuinely different invoice resolves the remainder.
  const final = await decoded(
    await request(book, `${path}/resolutions`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        accrualId: accrual.accrualId,
        invoiceIdentity: "invoice_003",
        invoiceEvidenceId: invoice.id,
        serviceIdentity: "consulting-2026-q1",
        consumedMinor: "2000",
        actualNetMinor: "2500",
        deductibleTaxMinor: "500",
        expenseAccountId: "account_clearing",
        taxAccountId: "account_vat",
        payableAccountId: "account_payable",
        accruedLiabilityAccountId: "account_accrued",
        postingDate: "2026-06-30",
        series: "A",
        rationale: "Final invoice for the reviewed service",
      }),
    }),
    Prep.AccrualResolutionView,
  );

  // This one is an underestimate: 2500 actual against 2000 consumed.
  expect(final.trueUpMinor).toBe("500");
  expect(final.payableMinor).toBe("3000");
  expect(final.remainingMinor).toBe("0");

  const settled = await decoded(
    await request(book, `${path}/state`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ accrualId: accrual.accrualId }),
    }),
    Prep.AccruedCostView,
  );

  expect(settled.remainingMinor).toBe("0");
  expect(settled.resolutions).toHaveLength(2);

  // Independent read of the retained evidence: two resolutions whose consumed
  // amounts sum to exactly the original, and the true-ups are the signed
  // differences the leaf computed.
  const admin = await database();

  try {
    const rows = await admin.query<{
      consumed: string;
      true_up: string;
      actual_net: string;
      payable: string;
    }>(
      `SELECT consumed_minor AS consumed, true_up_minor AS true_up,
              actual_net_minor AS actual_net, payable_minor AS payable
       FROM openerp.accrual_resolutions WHERE book_id = $1 AND accrual_id = $2
       ORDER BY created_at, id`,
      [book.bookId, accrual.accrualId],
    );

    expect(rows.rows).toHaveLength(2);
    expect(BigInt(rows.rows[0]?.consumed ?? "0") + BigInt(rows.rows[1]?.consumed ?? "0")).toBe(
      10000n,
    );
    expect(rows.rows[0]?.true_up).toBe("0");
    expect(rows.rows[1]?.true_up).toBe("500");

    // No VAT fact was created or moved by any of this: the deductible tax is
    // carried on the resolution as an amount the invoice stated, not as a tax
    // recognition this owner invented.
    const facts = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM openerp.vat_fact_components WHERE book_id = $1",
      [book.bookId],
    );

    expect(facts.rows[0]?.count).toBe("0");
  } finally {
    await admin.end();
  }
}, 180000);

test("consumed coverage beyond the remaining accrual refuses rather than going negative", async () => {
  const book = await fixture([{ id: "account_accrued", code: "2995", name: "Accrued expenses" }]);
  const source = await evidence(book);
  const invoice = await evidence(book);

  const accrual = await decoded(
    await request(book, path, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        serviceIdentity: "limited-service",
        expectedCostMinor: "5000",
        currency: "SEK",
        expenseAccountId: "account_clearing",
        accruedLiabilityAccountId: "account_accrued",
        evidenceId: source.id,
        reviewedOn: "2026-02-28",
        postingDate: "2026-02-28",
        series: "A",
      }),
    }),
    Prep.AccruedCostView,
  );

  // 9000 consumed against 5000 remaining. A negative capacity is a review
  // question, not something to post.
  await failure(
    await request(book, `${path}/resolutions`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        accrualId: accrual.accrualId,
        invoiceIdentity: "invoice_over",
        invoiceEvidenceId: invoice.id,
        serviceIdentity: "limited-service",
        consumedMinor: "9000",
        actualNetMinor: "9000",
        deductibleTaxMinor: "2250",
        expenseAccountId: "account_clearing",
        taxAccountId: "account_clearing",
        payableAccountId: "account_clearing",
        accruedLiabilityAccountId: "account_accrued",
        postingDate: "2026-03-31",
        series: "A",
        rationale: "An invoice consuming more than the accrual holds",
      }),
    }),
    403,
    "ApprovalRequired",
  );

  const untouched = await decoded(
    await request(book, `${path}/state`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ accrualId: accrual.accrualId }),
    }),
    Prep.AccruedCostView,
  );

  // The refusal rolled back: no resolution was retained.
  expect(untouched.remainingMinor).toBe("5000");
  expect(untouched.resolutions).toHaveLength(0);
}, 180000);
