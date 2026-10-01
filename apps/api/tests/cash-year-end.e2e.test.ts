import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as CashMethod from "@open-erp/contracts/cash-method";
import * as Profiles from "@open-erp/contracts/company-profiles";
import { expect, test } from "vitest";
import { createSession, database, decoded, failure, key, post, request } from "./support/fixtures";
import { allocateCash, cashFixture, paymentSnapshot, postedCash } from "./support/cash-payment";
import { createDraft } from "./support/supplier-review";

// Independent obligations before year-end code: first50000 -> N40000/VAT10000;
// unpaid75000 -> N60000/VAT15000/AP75000 once; next-year75000 -> no new VAT.
// Complete membership must come from native invoices, including no-row originals.
const path = "/commerce/cash-method/year-end";

async function paidFixture() {
  const context = await cashFixture();
  const cash = await postedCash(context.book);
  const plan = await allocateCash(context, cash);

  const approval = await post(
    context.reviewer,
    `/commerce/allocation-plans/${plan.id}/approvals`,
    { version: 1, planDigest: plan.digest },
    Commerce.AllocationApproval,
  );

  await post(
    context.book,
    "/commerce/cash-method/payments",
    { allocationPlanId: plan.id, planDigest: plan.digest, approvalId: approval.id },
    Commerce.AllocationReceipt,
  );

  const reviewEvidence = await post(
    context.book,
    "/evidence",
    {
      title: "Synthetic fiscal cash cutover review",
      content:
        "Review complete native cash invoice population at 2026-12-31. No selected-line claims.",
      mediaType: "text/plain",
      origin: "NEXT-38 independent year-end fixture",
    },
    Accounting.Evidence,
  );

  const input = {
    fiscalYearId: "fy_2026",
    cutoffOn: "2026-12-31",
    evidenceId: reviewEvidence.id,
    rationale: "Recognize complete eligible unpaid population",
    series: "A",
  };

  return { ...context, reviewEvidence, input };
}

async function secondInvoice(
  context: Awaited<ReturnType<typeof paidFixture>>,
  date = "2026-09-22",
) {
  const source = await post(
    context.book,
    "/evidence",
    {
      title: "Second original",
      content: "Second supplier original: N40000 + VAT10000 = G50000 minor SEK. Synthetic only.",
      mediaType: "text/plain",
      origin: "NEXT-38 complete-population fixture",
    },
    Accounting.Evidence,
  );

  const original = context.draft.content.lines[0];

  if (!original) throw new Error("Missing original source line");

  const draft = await createDraft(context.book, {
    ...context.draft.content,
    sourceEvidenceId: source.id,
    supplierDocumentNumber: `SECOND-${key()}`,
    documentDate: date,
    supplyDate: date,
    dueDate: `${date.slice(0, 4)}-12-31`,
    supplier: { ...context.draft.content.supplier, evidenceId: source.id },
    buyer: { ...context.draft.content.buyer, evidenceId: source.id },
    sourceTotalMinor: "50000",
    lines: [
      {
        ...original,
        baseMinor: "40000",
        unitPriceMinor: "40000",
        taxMinor: "10000",
        sourceGrossMinor: "50000",
        taxEvidenceId: source.id,
      },
    ],
  });

  const input = {
    profile: "synthetic-cash-method-domestic-v1",
    draftId: draft.id,
    expectedRevision: draft.revision,
    expectedDigest: draft.digest,
    controlAccountId: "account_clearing",
    inputVatAccountId: "account_vat",
    lineAssignments: [
      {
        lineId: original.id,
        expenseAccountId: "account_expense",
        treatment: {
          basis: "full_deduction",
          rate: { numerator: "1", denominator: "4" },
          deduction: { numerator: "1", denominator: "1" },
          invoiceTaxRounding: "half_up",
          deductionRounding: "half_up",
          acceptancePolicy: "exact_match",
          toleranceMinor: "0",
        },
      },
    ],
    reason: "Accept another original without voluntary registration",
    acknowledgeSyntheticOnly: true,
  };

  return { input, source };
}

async function prepareAndApprove(context: Awaited<ReturnType<typeof paidFixture>>) {
  const plan = await post(context.book, path, context.input, CashMethod.CashYearEndPlan);

  const approval = await post(
    context.reviewer,
    `${path}/${plan.id}/approvals`,
    { planDigest: plan.digest },
    CashMethod.CashYearEndApproval,
  );

  return { plan, approval };
}

async function retainedCreditInput(
  context: Awaited<ReturnType<typeof cashFixture>>,
  date: string,
  periodId: string,
) {
  const evidence = await post(
    context.book,
    "/evidence",
    {
      title: "Synthetic unpaid supplier credit",
      content: `Credit dated${date}: gross25000 = net20000 + VAT5000; no refund.`,
      mediaType: "text/plain",
      origin: "NEXT-38 independent cutoff fixture",
    },
    Accounting.Evidence,
  );

  const original = context.draft.content.lines[0];

  if (!original) throw new Error("Missing original credit source line");

  const creditLineId = "credit_line";

  const draft = await createDraft(context.book, {
    ...context.draft.content,
    sourceEvidenceId: evidence.id,
    supplierDocumentNumber: `CREDIT-${key()}`,
    documentDate: date,
    supplyDate: date,
    dueDate: date,
    supplier: { ...context.draft.content.supplier, evidenceId: evidence.id },
    buyer: { ...context.draft.content.buyer, evidenceId: evidence.id },
    sourceTotalMinor: "25000",
    lines: [
      {
        ...original,
        id: creditLineId,
        baseMinor: "20000",
        unitPriceMinor: "20000",
        taxMinor: "5000",
        sourceGrossMinor: "25000",
        taxEvidenceId: evidence.id,
      },
    ],
  });

  return {
    invoiceId: context.invoice.id,
    draftId: draft.id,
    expectedRevision: draft.revision,
    expectedDigest: draft.digest,
    accountingPeriodId: periodId,
    series: "A",
    lineMappings: [
      {
        creditLineId,
        sourceLineId: original.id,
        treatment: {
          basis: "full_deduction",
          rate: { numerator: "1", denominator: "4" },
          deduction: { numerator: "1", denominator: "1" },
          invoiceTaxRounding: "half_up",
          deductionRounding: "half_up",
          acceptancePolicy: "exact_match",
          toleranceMinor: "0",
        },
      },
    ],
    rationale: "Credit the retained original unpaid suffix",
  };
}

async function yearSnapshot(context: Awaited<ReturnType<typeof paidFixture>>) {
  const financial = await paymentSnapshot(context.book);
  const admin = await database();

  try {
    const rows = await admin.query(
      "select (select count(*)::text from openerp.cash_method_year_end_runs where book_id=$1) as runs,(select count(*)::text from openerp.cash_method_year_end_plans where book_id=$1) as plans,(select count(*)::text from openerp.cash_method_year_end_members where book_id=$1) as members,(select count(*)::text from openerp.cash_method_year_end_approvals where book_id=$1 and consumed_at is not null) as approvals,(select count(*)::text from openerp.command_receipts where book_id=$1) as commands,(select coalesce(jsonb_agg(jsonb_build_array(id,credit_date::text,gross_minor,body) order by id),'[]'::jsonb) from openerp.cash_method_credits where book_id=$1) as credits",
      [context.book.bookId],
    );

    return { financial, yearEnd: rows.rows[0] };
  } finally {
    await admin.end();
  }
}

test("year-end seals all native invoices, including an unpaid original without cash lines", async () => {
  const context = await paidFixture();
  const second = await secondInvoice(context);

  const invoice = await post(
    context.book,
    "/commerce/cash-method/lines",
    second.input,
    Commerce.Invoice,
  );

  const { plan, approval } = await prepareAndApprove(context);
  expect(plan.selection.invoices.map((member) => member.invoiceId).sort()).toEqual(
    [context.invoice.id, invoice.id].sort(),
  );
  const commandKey = key();

  const execute = () =>
    request(context.book, `${path}/${plan.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify({ planDigest: plan.digest, approvalId: approval.id }),
    });

  const receipt = await decoded(await execute(), CashMethod.CashYearEndReceipt);
  expect(receipt.memberCount).toBe(2);
  expect(receipt.recognizedGrossMinor).toBe("125000");
  expect(receipt.netMinor).toBe("100000");
  expect(receipt.taxMinor).toBe("25000");
  expect(
    receipt.members.find((member) => member.invoiceId === context.invoice.id)?.lines[0],
  ).toMatchObject({ newGrossMinor: "75000", netMinor: "60000", taxMinor: "15000" });
  expect(await decoded(await execute(), CashMethod.CashYearEndReceipt)).toEqual(receipt);
  await failure(
    await request(context.book, `${path}/${plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ planDigest: plan.digest, approvalId: approval.id }),
    }),
    409,
    "IdempotencyConflict",
  );
  await failure(
    await request(context.book, path, { method: "POST", body: JSON.stringify(context.input) }),
    409,
    "IdempotencyConflict",
  );
}, 240000);

test("year-end exact remaining75000 is recognized once; next-year settlement75000 creates no new VAT or recognition journal", async () => {
  const context = await paidFixture();
  const beforeYearEnd = await database();

  try {
    const paid = await beforeYearEnd.query(
      "select paid_gross_minor::text as paid,recognized_gross_minor::text as recognized from openerp.cash_method_lines where book_id=$1",
      [context.book.bookId],
    );

    expect(paid.rows).toEqual([{ paid: "50000", recognized: "50000" }]);

    const journal = await beforeYearEnd.query(
      "select account_id,sum(debit_minor)::text as debit,sum(credit_minor)::text as credit from openerp.journal_lines where book_id=$1 group by account_id order by account_id",
      [context.book.bookId],
    );

    expect(journal.rows).toEqual([
      { account_id: "account_bank", debit: "0", credit: "50000" },
      { account_id: "account_clearing", debit: "50000", credit: "50000" },
      { account_id: "account_expense", debit: "40000", credit: "0" },
      { account_id: "account_vat", debit: "10000", credit: "0" },
    ]);
  } finally {
    await beforeYearEnd.end();
  }

  const { plan, approval } = await prepareAndApprove(context);

  const receipt = await post(
    context.book,
    `${path}/${plan.id}/execute`,
    { planDigest: plan.digest, approvalId: approval.id },
    CashMethod.CashYearEndReceipt,
  );

  expect(receipt).toMatchObject({
    recognizedGrossMinor: "75000",
    netMinor: "60000",
    taxMinor: "15000",
    memberCount: 1,
  });

  // The cash prerequisite is fulfilled, not the whole close: the named closing
  // owner still requires a real statement snapshot and corporate-tax bridge.
  const requestClose = () =>
    request(context.book, "/closing/financial-years/preparations", {
      method: "POST",
      body: JSON.stringify({
        fiscalYearId: "fy_2026",
        statementSnapshotId: "statement_not_prepared",
        bridgeId: "bridge_not_prepared",
        nominalAccountId: "account_expense",
        equityAccountId: "account_clearing",
        evidenceId: context.source.id,
        reason: "Year-end receipt does not fabricate a financial close",
        proposedAdjustmentRefs: [],
        otherFamilies: [],
      }),
    });

  const beforeClose = await yearSnapshot(context);

  await failure(await requestClose(), 404, "NotFound");
  expect(await yearSnapshot(context)).toEqual(beforeClose);

  const admin = await database();

  try {
    const yearEndLines = await admin.query(
      "select account_id,debit_minor::text as debit,credit_minor::text as credit from openerp.journal_lines where book_id=$1 and voucher_id=$2 order by account_id",
      [context.book.bookId, receipt.postingReceipt?.voucherId],
    );

    expect(yearEndLines.rows).toEqual([
      { account_id: "account_clearing", debit: "0", credit: "75000" },
      { account_id: "account_expense", debit: "60000", credit: "0" },
      { account_id: "account_vat", debit: "15000", credit: "0" },
    ]);
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

  const cash = await postedCash(context.book, {
    amountMinor: "75000",
    date: "2027-01-22",
    periodId: "period_2027",
  });

  const allocation = await allocateCash(context, cash, "75000");
  expect(allocation.cashEffect?.postingPlan).toBeNull();

  const consent = await post(
    context.reviewer,
    `/commerce/allocation-plans/${allocation.id}/approvals`,
    { version: 1, planDigest: allocation.digest },
    Commerce.AllocationApproval,
  );

  const before = await paymentSnapshot(context.book);

  const settlementKey = key();

  const settle = () =>
    request(context.book, `/commerce/allocation-plans/${allocation.id}/apply`, {
      method: "POST",
      headers: { "idempotency-key": settlementKey },
      body: JSON.stringify({ version: 1, planDigest: allocation.digest, approvalId: consent.id }),
    });

  await createSession(context.reviewer);

  const admissionDb = await database();

  try {
    await admissionDb.query(
      "update openerp.identity_admissions set enabled=false where actor_id=$1",
      [context.reviewer.actorId],
    );

    const membership = await admissionDb.query(
      "select role from openerp.memberships where book_id=$1 and actor_id=$2",
      [context.book.bookId, context.reviewer.actorId],
    );

    expect(membership.rows).toEqual([{ role: "operator" }]);
    const disabledBefore = await yearSnapshot(context);
    await failure(await settle(), 403, "ApprovalRequired");
    expect(await yearSnapshot(context)).toEqual(disabledBefore);

    await admissionDb.query(
      "update openerp.identity_admissions set enabled=true where actor_id=$1",
      [context.reviewer.actorId],
    );
  } finally {
    await admissionDb.end();
  }

  const applied = await decoded(await settle(), Commerce.AllocationReceipt);

  const after = await paymentSnapshot(context.book);
  expect(after?.vouchers).toBe(before?.vouchers);
  expect(after?.facts).toBe(before?.facts);
  expect(applied.cashRecognition?.changeSetId).toBe(cash.posted.changeSetId);
  expect(await decoded(await settle(), Commerce.AllocationReceipt)).toEqual(applied);
  expect(await paymentSnapshot(context.book)).toEqual(after);
  await failure(
    await request(context.book, `/commerce/allocation-plans/${allocation.id}/apply`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: allocation.digest, approvalId: consent.id }),
    }),
    409,
    "IdempotencyConflict",
  );
  expect(await paymentSnapshot(context.book)).toEqual(after);

  const live = await decoded(
    await request(context.book, `/commerce/invoices/${context.invoice.id}`),
    Commerce.Invoice,
  );

  expect(live.outstandingMinor).toBe("0");

  const db = await database();

  try {
    const settled = await db.query(
      "select paid_gross_minor::text as paid,recognized_gross_minor::text as recognized from openerp.cash_method_lines where book_id=$1",
      [context.book.bookId],
    );

    expect(settled.rows).toEqual([{ paid: "125000", recognized: "125000" }]);

    const nextYearLines = await db.query(
      "select account_id,debit_minor::text as debit,credit_minor::text as credit from openerp.journal_lines where book_id=$1 and voucher_id=$2 order by account_id",
      [context.book.bookId, cash.posted.voucherId],
    );

    expect(nextYearLines.rows).toEqual([
      { account_id: "account_bank", debit: "0", credit: "75000" },
      { account_id: "account_clearing", debit: "75000", credit: "0" },
    ]);

    const rows = await db.query(
      "select account_id,sum(debit_minor)::text as debit,sum(credit_minor)::text as credit from openerp.journal_lines where book_id=$1 group by account_id order by account_id",
      [context.book.bookId],
    );

    expect(rows.rows).toEqual([
      { account_id: "account_bank", debit: "0", credit: "125000" },
      { account_id: "account_clearing", debit: "125000", credit: "125000" },
      { account_id: "account_expense", debit: "100000", credit: "0" },
      { account_id: "account_vat", debit: "25000", credit: "0" },
    ]);
  } finally {
    await db.end();
  }

  // Later settlement cannot invalidate the already-executed2026 assessment.
  const settledCloseBefore = await yearSnapshot(context);

  await failure(await requestClose(), 404, "NotFound");
  expect(await yearSnapshot(context)).toEqual(settledCloseBefore);
}, 240000);

test("new native membership, payment, credit, account or reviewed method revision makes a sealed year-end stale", async () => {
  for (const change of ["invoice", "payment", "credit", "method", "account"] as const) {
    const context = await paidFixture();
    const { plan, approval } = await prepareAndApprove(context);

    if (change === "invoice") {
      const second = await secondInvoice(context);
      await post(context.book, "/commerce/invoices/cash-method", second.input, Commerce.Invoice);
    }

    if (change === "payment") {
      const cash = await postedCash(context.book, { date: "2026-10-22" });
      const allocation = await allocateCash(context, cash);

      const consent = await post(
        context.reviewer,
        `/commerce/allocation-plans/${allocation.id}/approvals`,
        { version: 1, planDigest: allocation.digest },
        Commerce.AllocationApproval,
      );

      await post(
        context.book,
        `/commerce/allocation-plans/${allocation.id}/apply`,
        { version: 1, planDigest: allocation.digest, approvalId: consent.id },
        Commerce.AllocationReceipt,
      );
    }

    if (change === "method") {
      const revision = await post(
        context.book,
        "/company-facts",
        {
          factKind: "accounting_method",
          value: { state: "known", value: "cash" },
          effectiveFrom: "2026-12-01",
          effectiveTo: null,
          supersedesId: null,
          evidence: [{ evidenceId: context.source.id, sha256: context.source.sha256 }],
          note: "New independently reviewed method revision",
        },
        Profiles.FactRevision,
      );

      await post(
        context.reviewer,
        `/company-facts/${revision.id}/reviews`,
        {
          factRevisionId: revision.id,
          expectedDigest: revision.digest,
          result: "confirmed",
          rationale: "Independent revision review",
        },
        Profiles.FactReview,
      );
    }

    if (change === "account") {
      const admin = await database();

      try {
        await admin.query(
          "update openerp.accounts set version=version+1 where book_id=$1 and id='account_expense'",
          [context.book.bookId],
        );
      } finally {
        await admin.end();
      }
    }

    if (change === "credit") {
      const credit = await post(
        context.book,
        "/commerce/cash-method/credits",
        await retainedCreditInput(context, "2026-10-22", "period_2026"),
        CashMethod.CashCreditPlan,
      );

      const consent = await post(
        context.reviewer,
        `/commerce/cash-method/credits/${credit.id}/approvals`,
        { planDigest: credit.digest },
        CashMethod.CashCreditApproval,
      );

      await post(
        context.book,
        `/commerce/cash-method/credits/${credit.id}/execute`,
        { planDigest: credit.digest, approvalId: consent.id },
        CashMethod.CashCreditReceipt,
      );
    }

    const before = await yearSnapshot(context);
    await failure(
      await request(context.book, `${path}/${plan.id}/execute`, {
        method: "POST",
        body: JSON.stringify({ planDigest: plan.digest, approvalId: approval.id }),
      }),
      409,
      "StaleDependency",
    );
    expect(await yearSnapshot(context)).toEqual(before);
  }
}, 240000);

test("a January retained credit cannot reduce the preceding December year-end population", async () => {
  const base = await cashFixture();

  const context = {
    ...base,
    reviewEvidence: base.source,
    input: {
      fiscalYearId: "fy_2026",
      cutoffOn: "2026-12-31",
      evidenceId: base.source.id,
      rationale: "Historical cutoff must not consume a later credit",
      series: "A",
    },
  };

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

  const input = await retainedCreditInput(context, "2027-01-22", "period_2027");

  const credit = await post(
    context.book,
    "/commerce/cash-method/credits",
    input,
    CashMethod.CashCreditPlan,
  );

  const approval = await post(
    context.reviewer,
    `/commerce/cash-method/credits/${credit.id}/approvals`,
    { planDigest: credit.digest },
    CashMethod.CashCreditApproval,
  );

  const receipt = await post(
    context.book,
    `/commerce/cash-method/credits/${credit.id}/execute`,
    { planDigest: credit.digest, approvalId: approval.id },
    CashMethod.CashCreditReceipt,
  );

  expect(receipt).toMatchObject({
    creditGrossMinor: "25000",
    recognizedCorrectionMinor: "0",
    postingReceipt: null,
    vatFactIds: [],
  });

  const invoice = await decoded(
    await request(context.book, `/commerce/invoices/${context.invoice.id}`),
    Commerce.Invoice,
  );

  expect(invoice).toMatchObject({ outstandingMinor: "100000", creditedMinor: "25000" });

  const before = await yearSnapshot(context);

  expect(before.financial).toMatchObject({ vouchers: "0", facts: "0" });

  await failure(
    await request(context.book, path, {
      method: "POST",
      body: JSON.stringify(context.input),
    }),
    422,
    "UnsupportedProfile",
  );
  expect(await yearSnapshot(context)).toEqual(before);
}, 240000);

test("a later year-end recognition cannot become a fictitious zero-effect historical assessment", async () => {
  const base = await cashFixture();

  const context = {
    ...base,
    reviewEvidence: base.source,
    input: {
      fiscalYearId: "fy_2026",
      cutoffOn: "2026-12-31",
      evidenceId: base.source.id,
      rationale: "Historical assessment requires coverage at its own cutoff",
      series: "A",
    },
  };

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

  const later = await post(
    context.book,
    path,
    { ...context.input, fiscalYearId: "fy_2027", cutoffOn: "2027-12-31" },
    CashMethod.CashYearEndPlan,
  );

  const approval = await post(
    context.reviewer,
    `${path}/${later.id}/approvals`,
    { planDigest: later.digest },
    CashMethod.CashYearEndApproval,
  );

  const receipt = await post(
    context.book,
    `${path}/${later.id}/execute`,
    { planDigest: later.digest, approvalId: approval.id },
    CashMethod.CashYearEndReceipt,
  );

  expect(receipt).toMatchObject({
    fiscalYearId: "fy_2027",
    cutoffOn: "2027-12-31",
    memberCount: 1,
    recognizedGrossMinor: "125000",
    netMinor: "100000",
    taxMinor: "25000",
  });

  const before = await yearSnapshot(context);

  await failure(
    await request(context.book, path, {
      method: "POST",
      body: JSON.stringify(context.input),
    }),
    422,
    "UnsupportedProfile",
  );
  expect(await yearSnapshot(context)).toEqual(before);

  const retained = await database();

  try {
    const runs = await retained.query(
      "select fiscal_year_id,body from openerp.cash_method_year_end_runs where book_id=$1 order by fiscal_year_id",
      [context.book.bookId],
    );

    expect(runs.rows).toEqual([{ fiscal_year_id: "fy_2027", body: receipt }]);
  } finally {
    await retained.end();
  }
}, 240000);

test("a qualified cash book with no invoices requires a reviewed empty year-end receipt without posting", async () => {
  const company = await cashFixture();

  // Provision a second empty synthetic book under the already-reviewed entity.
  // The original company's invoice remains untouched in its original book.
  const bookId = `book_${key().replaceAll("-", "")}`;

  const book = {
    ...company.book,
    bookId,
    path: `/api/v1/entities/${company.book.entityId}/books/${bookId}`,
  };

  const reviewer = { ...book, actorId: company.reviewer.actorId, token: company.reviewer.token };
  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.books(id,entity_id,name,currency,currency_scale,profile) values($1,$2,'Synthetic empty cash book','SEK',2,'synthetic-core-v1')",
      [book.bookId, book.entityId],
    );
    await admin.query(
      "insert into openerp.fiscal_years(book_id,id,starts_on,ends_on) values($1,'fy_2026','2026-01-01','2026-12-31')",
      [book.bookId],
    );
    await admin.query(
      "insert into openerp.periods(book_id,id,fiscal_year_id,starts_on,ends_on) values($1,'period_2026','fy_2026','2026-01-01','2026-12-31')",
      [book.bookId],
    );
    await admin.query(
      "insert into openerp.accounts(book_id,id,code,name,active,version) select $1,id,code,name,true,1 from openerp.accounts where book_id=$2",
      [book.bookId, company.book.bookId],
    );
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, book.actorId],
    );
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, reviewer.actorId],
    );
  } finally {
    await admin.end();
  }

  const evidence = await post(
    book,
    "/evidence",
    {
      title: "Synthetic empty cash-method fiscal assessment",
      content: "No native invoices in this book through2026-12-31; full population is empty.",
      mediaType: "text/plain",
      origin: "NEXT-38 independent empty-population fixture",
    },
    Accounting.Evidence,
  );

  for (const [roleKind, accountId] of [
    ["commerce", "account_clearing"],
    ["vat", "account_vat"],
  ] as const) {
    await post(
      book,
      "/company-role-bindings",
      {
        roleKind,
        accountId,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        supersedesId: null,
        reviewer: reviewer.actorId,
        evidence: [{ evidenceId: evidence.id, sha256: evidence.sha256 }],
        note: "Reviewed roles for the second synthetic cash book",
      },
      Profiles.RoleBinding,
    );
  }

  const closeInput = {
    fiscalYearId: "fy_2026",
    statementSnapshotId: "statement_not_prepared",
    bridgeId: "bridge_not_prepared",
    nominalAccountId: "account_expense",
    equityAccountId: "account_clearing",
    evidenceId: evidence.id,
    reason: "Empty cash population still requires its sealed assessment",
    proposedAdjustmentRefs: [],
    otherFamilies: [],
  };

  const before = await paymentSnapshot(book);

  await failure(
    await request(book, "/closing/financial-years/preparations", {
      method: "POST",
      body: JSON.stringify(closeInput),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await paymentSnapshot(book)).toEqual(before);

  const plan = await post(
    book,
    path,
    {
      fiscalYearId: "fy_2026",
      cutoffOn: "2026-12-31",
      evidenceId: evidence.id,
      rationale: "Review the complete empty population under the retained cash method",
      series: "A",
    },
    CashMethod.CashYearEndPlan,
  );

  expect(plan.selection.invoices).toEqual([]);
  expect(plan.selection.journal).toEqual([]);
  expect(plan.postingPlan).toBeNull();
  expect(plan.selection.methodFactRevisionId).toBe(
    company.invoice.cashMethod?.methodFactRevisionId,
  );

  const approval = await post(
    reviewer,
    `${path}/${plan.id}/approvals`,
    { planDigest: plan.digest },
    CashMethod.CashYearEndApproval,
  );

  const receipt = await post(
    book,
    `${path}/${plan.id}/execute`,
    { planDigest: plan.digest, approvalId: approval.id },
    CashMethod.CashYearEndReceipt,
  );

  expect(receipt).toMatchObject({
    memberCount: 0,
    recognizedLineCount: 0,
    recognizedGrossMinor: "0",
    netMinor: "0",
    taxMinor: "0",
    members: [],
    postingReceipt: null,
  });
  expect(await paymentSnapshot(book)).toEqual(before);
  await failure(
    await request(book, "/closing/financial-years/preparations", {
      method: "POST",
      body: JSON.stringify(closeInput),
    }),
    404,
    "NotFound",
  );
  expect(await paymentSnapshot(book)).toEqual(before);
}, 240000);

test("fully recognized paid invoices remain valid zero-effect members and produce no fictitious voucher", async () => {
  const context = await paidFixture();
  const cash = await postedCash(context.book, { amountMinor: "75000", date: "2026-10-22" });
  const allocation = await allocateCash(context, cash, "75000");

  const consent = await post(
    context.reviewer,
    `/commerce/allocation-plans/${allocation.id}/approvals`,
    { version: 1, planDigest: allocation.digest },
    Commerce.AllocationApproval,
  );

  await post(
    context.book,
    `/commerce/allocation-plans/${allocation.id}/apply`,
    { version: 1, planDigest: allocation.digest, approvalId: consent.id },
    Commerce.AllocationReceipt,
  );
  const { plan, approval } = await prepareAndApprove(context);

  expect(plan.selection.invoices).toHaveLength(1);
  expect(plan.postingPlan).toBeNull();

  const before = await paymentSnapshot(context.book);

  const receipt = await post(
    context.book,
    `${path}/${plan.id}/execute`,
    { planDigest: plan.digest, approvalId: approval.id },
    CashMethod.CashYearEndReceipt,
  );

  expect(receipt.memberCount).toBe(1);
  expect(receipt.recognizedGrossMinor).toBe("0");
  expect(receipt.postingReceipt).toBeNull();
  expect(await paymentSnapshot(context.book)).toEqual(before);
}, 240000);

test("payment and year-end cannot both consume the same reviewed75000 coverage", async () => {
  const context = await paidFixture();
  const cash = await postedCash(context.book, { amountMinor: "75000", date: "2026-12-22" });
  const payment = await allocateCash(context, cash, "75000");

  const consent = await post(
    context.reviewer,
    `/commerce/allocation-plans/${payment.id}/approvals`,
    { version: 1, planDigest: payment.digest },
    Commerce.AllocationApproval,
  );

  const { plan, approval } = await prepareAndApprove(context);

  const results = await Promise.all([
    request(context.book, `${path}/${plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ planDigest: plan.digest, approvalId: approval.id }),
    }),
    request(context.book, `/commerce/allocation-plans/${payment.id}/apply`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: payment.digest, approvalId: consent.id }),
    }),
  ]);

  expect(results.map((result) => result.status).sort((a, b) => a - b)).toEqual([200, 409]);

  const loser = results.find((result) => result.status === 409);

  if (!loser) throw new Error("Missing stale competing consumer");

  await failure(loser, 409, "StaleDependency");

  const admin = await database();

  try {
    const effects = await admin.query(
      "select account_id,sum(debit_minor)::text as debit,sum(credit_minor)::text as credit from openerp.journal_lines where book_id=$1 and account_id in('account_expense','account_vat') group by account_id order by account_id",
      [context.book.bookId],
    );

    expect(effects.rows).toEqual([
      { account_id: "account_expense", debit: "100000", credit: "0" },
      { account_id: "account_vat", debit: "25000", credit: "0" },
    ]);

    const coverage = await admin.query(
      "select recognized_gross_minor::text as recognized from openerp.cash_method_lines where book_id=$1",
      [context.book.bookId],
    );

    expect(coverage.rows).toEqual([{ recognized: "125000" }]);
  } finally {
    await admin.end();
  }
}, 240000);

test("year-end approval authority is current, and financial close actually requires the complete cash receipt", async () => {
  const context = await paidFixture();

  const closeInput = {
    fiscalYearId: "fy_2026",
    statementSnapshotId: "statement_not_prepared",
    bridgeId: "bridge_not_prepared",
    nominalAccountId: "account_expense",
    equityAccountId: "account_clearing",
    evidenceId: context.source.id,
    reason: "Cash year-end prerequisite cannot be bypassed",
    proposedAdjustmentRefs: [],
    otherFamilies: [],
  };

  await failure(
    await request(context.book, "/closing/financial-years/preparations", {
      method: "POST",
      body: JSON.stringify(closeInput),
    }),
    403,
    "ApprovalRequired",
  );
  const { plan, approval } = await prepareAndApprove(context);
  const admin = await database();

  try {
    await admin.query("delete from openerp.memberships where book_id=$1 and actor_id=$2", [
      context.book.bookId,
      context.reviewer.actorId,
    ]);
  } finally {
    await admin.end();
  }

  const before = await yearSnapshot(context);

  await failure(
    await request(context.book, `${path}/${plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ planDigest: plan.digest, approvalId: approval.id }),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await yearSnapshot(context)).toEqual(before);
}, 240000);

test("the financial-close HTTP owner consumes the complete receipt and refuses its replaced method basis", async () => {
  const context = await paidFixture();
  const { plan, approval } = await prepareAndApprove(context);

  const receipt = await post(
    context.book,
    `${path}/${plan.id}/execute`,
    { planDigest: plan.digest, approvalId: approval.id },
    CashMethod.CashYearEndReceipt,
  );

  const closeInput = {
    fiscalYearId: "fy_2026",
    statementSnapshotId: "statement_not_prepared",
    bridgeId: "bridge_not_prepared",
    nominalAccountId: "account_expense",
    equityAccountId: "account_clearing",
    evidenceId: context.source.id,
    reason: "Consume this complete cash receipt before the remaining close prerequisites",
    proposedAdjustmentRefs: [],
    otherFamilies: [],
  };

  expect(receipt.members).toEqual(plan.selection.invoices);

  const beforeAccepted = await yearSnapshot(context);

  await failure(
    await request(context.book, "/closing/financial-years/preparations", {
      method: "POST",
      body: JSON.stringify(closeInput),
    }),
    404,
    "NotFound",
  );
  expect(await yearSnapshot(context)).toEqual(beforeAccepted);

  const replacement = await post(
    context.book,
    "/company-facts",
    {
      factKind: "accounting_method",
      value: { state: "known", value: "cash" },
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      supersedesId: plan.selection.methodFactRevisionId,
      evidence: [{ evidenceId: context.source.id, sha256: context.source.sha256 }],
      note: "Replace the reviewed historical method basis without changing its value",
    },
    Profiles.FactRevision,
  );

  await post(
    context.reviewer,
    `/company-facts/${replacement.id}/reviews`,
    {
      factRevisionId: replacement.id,
      expectedDigest: replacement.digest,
      result: "confirmed",
      rationale: "Independent replacement basis review",
    },
    Profiles.FactReview,
  );

  const beforeStale = await yearSnapshot(context);

  await failure(
    await request(context.book, "/closing/financial-years/preparations", {
      method: "POST",
      body: JSON.stringify(closeInput),
    }),
    409,
    "StaleDependency",
  );
  expect(await yearSnapshot(context)).toEqual(beforeStale);

  const admin = await database();

  try {
    const retained = await admin.query(
      "select body from openerp.cash_method_year_end_runs where book_id=$1 and id=$2",
      [context.book.bookId, receipt.id],
    );

    expect(retained.rows[0]?.body).toEqual(receipt);
  } finally {
    await admin.end();
  }
}, 240000);

test("cutoff, locked period and independent current approval gates refuse without effects", async () => {
  const context = await paidFixture();
  await failure(
    await request(context.book, path, {
      method: "POST",
      body: JSON.stringify({ ...context.input, cutoffOn: "2026-12-30" }),
    }),
    422,
    "InvalidJournal",
  );
  const plan = await post(context.book, path, context.input, CashMethod.CashYearEndPlan);
  await failure(
    await request(context.book, `${path}/${plan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ planDigest: plan.digest }),
    }),
    403,
    "ApprovalRequired",
  );

  const approval = await post(
    context.reviewer,
    `${path}/${plan.id}/approvals`,
    { planDigest: plan.digest },
    CashMethod.CashYearEndApproval,
  );

  const admin = await database();

  try {
    await admin.query(
      "update openerp.periods set locked=true,version=version+1 where book_id=$1 and id='period_2026'",
      [context.book.bookId],
    );
  } finally {
    await admin.end();
  }

  const before = await yearSnapshot(context);
  await failure(
    await request(context.book, `${path}/${plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ planDigest: plan.digest, approvalId: approval.id }),
    }),
    409,
    "PeriodLocked",
  );
  expect(await yearSnapshot(context)).toEqual(before);
}, 240000);

test("year-end failure after journal/tax writes rolls back and same key recovers; backdated originals then refuse", async () => {
  const context = await paidFixture();
  const { plan, approval } = await prepareAndApprove(context);
  const admin = await database();

  try {
    await admin.query(
      "create function openerp.e2e_year_end_rollback() returns trigger language plpgsql as $$ begin raise exception 'synthetic year-end rollback' using errcode='23514'; end $$",
    );
    await admin.query(
      `create trigger zz_e2e_year_end_rollback before update on openerp.cash_method_lines for each row when (NEW.book_id='${context.book.bookId}') execute function openerp.e2e_year_end_rollback()`,
    );
    const before = await yearSnapshot(context);
    const commandKey = key();

    const execute = () =>
      request(context.book, `${path}/${plan.id}/execute`, {
        method: "POST",
        headers: { "idempotency-key": commandKey },
        body: JSON.stringify({ planDigest: plan.digest, approvalId: approval.id }),
      });

    await failure(await execute(), 500, "InternalError");
    expect(await yearSnapshot(context)).toEqual(before);
    await admin.query("drop trigger zz_e2e_year_end_rollback on openerp.cash_method_lines");
    await admin.query("drop function openerp.e2e_year_end_rollback()");
    const receipt = await decoded(await execute(), CashMethod.CashYearEndReceipt);
    expect(await decoded(await execute(), CashMethod.CashYearEndReceipt)).toEqual(receipt);
    const second = await secondInvoice(context, "2026-12-22");
    const discoveryBefore = await yearSnapshot(context);
    await failure(
      await request(context.book, "/commerce/invoices/cash-method", {
        method: "POST",
        body: JSON.stringify(second.input),
      }),
      409,
      "StaleDependency",
    );
    expect(await yearSnapshot(context)).toEqual(discoveryBefore);
    expect(await decoded(await execute(), CashMethod.CashYearEndReceipt)).toEqual(receipt);

    const retained = await admin.query(
      "select body from openerp.cash_method_year_end_runs where book_id=$1 and id=$2",
      [context.book.bookId, receipt.id],
    );

    expect(retained.rows[0]?.body).toEqual(receipt);

    const cash = await postedCash(context.book, { date: "2026-11-22" });

    await failure(
      await request(context.book, "/commerce/allocation-plans", {
        method: "POST",
        body: JSON.stringify({
          voucherId: cash.posted.voucherId,
          lineId: cash.clearingLineId,
          evidenceId: context.source.id,
          rationale: "Backdated payment needs owned amendment",
          allocations: [{ invoiceId: context.invoice.id, amountMinor: "50000" }],
        }),
      }),
      409,
      "StaleDependency",
    );
  } finally {
    await admin.query(
      "drop trigger if exists zz_e2e_year_end_rollback on openerp.cash_method_lines",
    );
    await admin.query("drop function if exists openerp.e2e_year_end_rollback()");
    await admin.end();
  }
}, 240000);
