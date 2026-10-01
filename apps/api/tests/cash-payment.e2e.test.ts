import * as Accounting from "@open-erp/contracts/accounting";
import * as Schema from "effect/Schema";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Vat from "@open-erp/contracts/vat-returns";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import { expect, test } from "vitest";
import { database, decoded, failure, fixture, key, post, request } from "./support/fixtures";
import { allocateCash, cashFixture, paymentSnapshot, postedCash } from "./support/cash-payment";
import { createDraft } from "./support/supplier-review";

// Specified before financial implementation: G125000=N100000+VAT25000;
// retained final cash50000 recognizes expense40000/inputVAT10000, never bank twice.
test("accepted cash original refuses generic posting and second-labelled ordinary acceptance, including a prior approved review", async () => {
  const context = await cashFixture({ priorAccrualReview: true });
  const { accrualReview, accrualApproval } = context;

  if (!accrualReview || !accrualApproval) throw new Error("Missing prior approved ordinary review");

  const before = await paymentSnapshot(context.book);

  await failure(
    await request(
      context.book,
      `/commerce/supplier-acceptance-reviews/${accrualReview.id}/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          version: 1,
          digest: accrualReview.digest,
          approvalId: accrualApproval.id,
          acknowledgeSyntheticOnly: true,
        }),
      },
    ),
    409,
    "StaleDependency",
  );

  const second = await createDraft(context.book, {
    ...context.draft.content,
    supplierDocumentNumber: "THIRD-LABEL",
  });

  await failure(
    await request(context.book, "/commerce/supplier-acceptance-reviews", {
      method: "POST",
      body: JSON.stringify({
        profile: "synthetic-gross-cost-supplier-v1",
        draftId: second.id,
        expectedRevision: second.revision,
        expectedDigest: second.digest,
        controlAccountId: "account_clearing",
        debitAccountId: "account_expense",
        accountingPeriodId: "period_2026",
        series: "A",
        reason: "A different draft label is not a new original",
        acknowledgeSyntheticOnly: true,
      }),
    }),
    422,
    "UnsupportedProfile",
  );

  const journal = await post(
    context.book,
    "/change-sets",
    {
      kind: "manual_journal",
      evidenceId: context.source.id,
      eventKey: key(),
      accountingPeriodId: "period_2026",
      postingDate: "2026-09-22",
      series: "A",
      description: "Generic original reuse must refuse",
      rationale: "Cannot bypass cash owner",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "account_expense",
          debitMinor: "125000",
          creditMinor: "0",
          description: "Invented immediate recognition",
        },
        {
          accountId: "account_clearing",
          debitMinor: "0",
          creditMinor: "125000",
          description: "Invented immediate liability",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const approval = await post(
    context.book,
    `/change-sets/${journal.id}/approvals`,
    { version: 1, planDigest: journal.planDigest },
    Accounting.Approval,
  );

  await failure(
    await request(context.book, `/change-sets/${journal.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: journal.planDigest, approvalId: approval.id }),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await paymentSnapshot(context.book)).toEqual(before);
}, 240000);

test("allocation approval binds cash effect; retained final cash recognizes once and feeds the VAT owner", async () => {
  const context = await cashFixture({ priorAccrualReview: true });
  const cash = await postedCash(context.book);
  const plan = await allocateCash(context, cash);
  expect(plan.cashEffect).toBeDefined();
  await failure(
    await request(context.book, `/commerce/allocation-plans/${plan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: plan.digest }),
    }),
    403,
    "ApprovalRequired",
  );

  const approval = await post(
    context.reviewer,
    `/commerce/allocation-plans/${plan.id}/approvals`,
    { version: 1, planDigest: plan.digest },
    Commerce.AllocationApproval,
  );

  const prepared = Schema.decodeUnknownSync(Accounting.ChangeSet)(plan.cashEffect?.postingPlan);
  expect(prepared).toBeDefined();
  const before = await paymentSnapshot(context.book);
  await failure(
    await request(context.book, `/change-sets/${prepared.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        planDigest: prepared.planDigest,
        approvalId: approval.cashPostingApprovalId,
      }),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await paymentSnapshot(context.book)).toEqual(before);
  const commandKey = key();

  const apply = () =>
    request(context.book, "/commerce/cash-method/payments", {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify({
        allocationPlanId: plan.id,
        planDigest: plan.digest,
        approvalId: approval.id,
      }),
    });

  const receipt = await decoded(await apply(), Commerce.AllocationReceipt);
  expect(await decoded(await apply(), Commerce.AllocationReceipt)).toEqual(receipt);
  await failure(
    await request(context.book, `/commerce/allocation-plans/${plan.id}/apply`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: plan.digest, approvalId: approval.id }),
    }),
    409,
    "IdempotencyConflict",
  );
  await failure(
    await request(context.book, "/commerce/allocation-plans", {
      method: "POST",
      body: JSON.stringify({
        voucherId: cash.posted.voucherId,
        lineId: cash.clearingLineId,
        evidenceId: context.source.id,
        rationale: "Cannot spend source again",
        allocations: [{ invoiceId: context.invoice.id, amountMinor: "1" }],
      }),
    }),
    409,
    "StaleDependency",
  );

  const invoice = await decoded(
    await request(context.book, `/commerce/invoices/${context.invoice.id}`),
    Commerce.Invoice,
  );

  expect(invoice.outstandingMinor).toBe("75000");
  const admin = await database();

  try {
    const balances = await admin.query(
      "select account_id,sum(debit_minor)::text as debit,sum(credit_minor)::text as credit from openerp.journal_lines where book_id=$1 group by account_id order by account_id",
      [context.book.bookId],
    );

    expect(balances.rows).toEqual([
      { account_id: "account_bank", debit: "0", credit: "50000" },
      { account_id: "account_clearing", debit: "50000", credit: "50000" },
      { account_id: "account_expense", debit: "40000", credit: "0" },
      { account_id: "account_vat", debit: "10000", credit: "0" },
    ]);

    const state = await admin.query(
      "select paid_gross_minor,recognized_gross_minor,(recognized_gross_minor::numeric-paid_gross_minor::numeric)::text as unpaid from openerp.cash_method_lines where book_id=$1",
      [context.book.bookId],
    );

    expect(state.rows).toEqual([
      { paid_gross_minor: "50000", recognized_gross_minor: "50000", unpaid: "0" },
    ]);

    const original = await admin.query(
      "select evidence_id from openerp.cash_method_recognitions where book_id=$1",
      [context.book.bookId],
    );

    expect(original.rows).toEqual([{ evidence_id: cash.source.id }]);
  } finally {
    await admin.end();
  }

  const basis = await decoded(await request(context.book, "/vat-returns/facts"), Vat.VatBasis);
  expect(basis.facts).toHaveLength(1);
  const fact = basis.facts[0]?.fact;

  if (!fact) throw new Error("Missing owned VAT fact");

  await failure(
    await request(context.book, `/vat-returns/facts/${fact.factId}/withdrawal`, {
      method: "POST",
      body: JSON.stringify({
        expectedDigest: fact.digest,
        evidenceId: context.source.id,
        rationale: "Cannot withdraw an owned cash VAT slice through manual facts",
      }),
    }),
    422,
    "UnsupportedProfile",
  );
  await failure(
    await request(context.book, "/vat-returns/facts", {
      method: "POST",
      body: JSON.stringify({ ...fact.input, sourceKey: "manual_cash_copy" }),
    }),
    422,
    "UnsupportedProfile",
  );
  await failure(
    await request(context.book, "/bank-match-reversal-plans", {
      method: "POST",
      body: JSON.stringify({
        target: { kind: "exact_match", statementId: cash.statementId, rowOrdinal: 1 },
        reason: "Final cash source requires an owned correction",
      }),
    }),
    422,
    "UnsupportedProfile",
  );

  const correction = await post(
    context.book,
    `/vouchers/${cash.posted.voucherId}/correction-proposals`,
    {
      accountingPeriodId: "period_2026",
      postingDate: "2026-09-22",
      rationale: "Generic source correction must not rewind owned recognition",
    },
    Accounting.ChangeSet,
  );

  const correctionApproval = await post(
    context.book,
    `/change-sets/${correction.id}/approvals`,
    { version: 1, planDigest: correction.planDigest },
    Accounting.Approval,
  );

  const financialState = await paymentSnapshot(context.book);

  await failure(
    await request(context.book, `/change-sets/${correction.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        planDigest: correction.planDigest,
        approvalId: correctionApproval.id,
      }),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await paymentSnapshot(context.book)).toEqual(financialState);
  expect(basis.facts[0]?.fact.input).toMatchObject({
    method: "cash",
    netMinor: "40000",
    vatMinor: "10000",
    grossMinor: "50000",
    taxPointOn: "2026-09-22",
  });

  const draft = await post(
    context.book,
    "/vat-returns/drafts",
    {
      mode: "synthetic_demonstration",
      startsOn: "2026-09-01",
      endsOn: "2026-09-30",
      periodEvidenceId: cash.source.id,
      otherBoxes: "absent_in_synthetic_example",
    },
    Vat.VatDraft,
  );

  expect(draft.calculation.includedCount).toBe(1);
  expect(draft.calculation.syntheticBoxes?.box48.exactMinor).toBe("10000");
}, 240000);

test("an unrelated unexecuted supplier review still fences generic payment-source posting", async () => {
  const context = await cashFixture();

  const source = await post(
    context.book,
    "/evidence",
    {
      title: "Unrelated supplier original",
      content: "Synthetic unrelated net100000/VAT25000/gross125000 supplier original",
      mediaType: "text/plain",
      origin: "NEXT-38 unrelated-source refusal",
    },
    Accounting.Evidence,
  );

  const unrelated = await createDraft(context.book, {
    ...context.draft.content,
    sourceEvidenceId: source.id,
    supplier: { ...context.draft.content.supplier, evidenceId: source.id },
    buyer: { ...context.draft.content.buyer, evidenceId: source.id },
    supplierDocumentNumber: "UNRELATED-PAYMENT-EVIDENCE",
  });

  await post(
    context.book,
    "/commerce/supplier-acceptance-reviews",
    {
      profile: "synthetic-gross-cost-supplier-v1",
      draftId: unrelated.id,
      expectedRevision: unrelated.revision,
      expectedDigest: unrelated.digest,
      controlAccountId: "account_clearing",
      debitAccountId: "account_expense",
      accountingPeriodId: "period_2026",
      series: "A",
      reason: "Unrelated proposal must not receive the adopted-original exemption",
      acknowledgeSyntheticOnly: true,
    },
    Acceptance.SupplierAcceptanceReview,
  );

  const plan = await post(
    context.book,
    "/change-sets",
    {
      kind: "manual_journal",
      evidenceId: source.id,
      eventKey: key(),
      accountingPeriodId: "period_2026",
      postingDate: "2026-09-22",
      series: "A",
      description: "Unrelated supplier evidence cannot become a payment source",
      rationale: "Preserve the unrelated owner fence",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "account_clearing",
          debitMinor: "50000",
          creditMinor: "0",
          description: "Clearing",
        },
        { accountId: "account_bank", debitMinor: "0", creditMinor: "50000", description: "Bank" },
      ],
    },
    Accounting.ChangeSet,
  );

  const approval = await post(
    context.book,
    `/change-sets/${plan.id}/approvals`,
    { version: 1, planDigest: plan.planDigest },
    Accounting.Approval,
  );

  const before = await paymentSnapshot(context.book);
  await failure(
    await request(context.book, `/change-sets/${plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: plan.planDigest, approvalId: approval.id }),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await paymentSnapshot(context.book)).toEqual(before);
}, 240000);

test("rounded cash original recognizes a full payment as net3 and VAT1", async () => {
  const context = await cashFixture({ roundedOriginal: true });
  const cash = await postedCash(context.book, { amountMinor: "4" });
  const plan = await allocateCash(context, cash, "4");

  const approval = await post(
    context.reviewer,
    `/commerce/allocation-plans/${plan.id}/approvals`,
    { version: 1, planDigest: plan.digest },
    Commerce.AllocationApproval,
  );

  await post(
    context.book,
    `/commerce/allocation-plans/${plan.id}/apply`,
    { version: 1, planDigest: plan.digest, approvalId: approval.id },
    Commerce.AllocationReceipt,
  );
  const basis = await decoded(await request(context.book, "/vat-returns/facts"), Vat.VatBasis);
  expect(basis.facts).toHaveLength(1);
  expect(basis.facts[0]?.fact.input).toMatchObject({
    netMinor: "3",
    vatMinor: "1",
    grossMinor: "4",
  });

  const draft = await post(
    context.book,
    "/vat-returns/drafts",
    {
      mode: "synthetic_demonstration",
      startsOn: "2026-09-01",
      endsOn: "2026-09-30",
      periodEvidenceId: cash.source.id,
      otherBoxes: "absent_in_synthetic_example",
    },
    Vat.VatDraft,
  );

  expect(draft.calculation.includedCount).toBe(1);
  expect(draft.calculation.excludedCount).toBe(0);
  expect(draft.calculation.syntheticBoxes?.box48.exactMinor).toBe("1");
}, 240000);

test("rounded cash original releases cumulative half-up VAT across successive HTTP allocations", async () => {
  const context = await cashFixture({ roundedOriginal: true });

  // Original N3 + VAT1 = G4. Cumulative coverage1,2,4 releases VAT0,1,0,
  // not three independently rounded invoices. Final residual conserves N3/VAT1.
  for (const [amountMinor, outstandingMinor, includedCount, date, openingMinor] of [
    ["1", "3", 0, "2026-09-22", "100000"],
    ["1", "2", 1, "2026-09-23", "99999"],
    ["2", "0", 1, "2026-09-24", "99998"],
  ] as const) {
    const cash = await postedCash(context.book, {
      amountMinor,
      date,
      openingMinor,
      dailyStatement: true,
    });

    const plan = await allocateCash(context, cash, amountMinor);

    const approval = await post(
      context.reviewer,
      `/commerce/allocation-plans/${plan.id}/approvals`,
      { version: 1, planDigest: plan.digest },
      Commerce.AllocationApproval,
    );

    await post(
      context.book,
      `/commerce/allocation-plans/${plan.id}/apply`,
      { version: 1, planDigest: plan.digest, approvalId: approval.id },
      Commerce.AllocationReceipt,
    );

    const invoice = await decoded(
      await request(context.book, `/commerce/invoices/${context.invoice.id}`),
      Commerce.Invoice,
    );

    expect(invoice.outstandingMinor).toBe(outstandingMinor);

    const draft = await post(
      context.book,
      "/vat-returns/drafts",
      {
        mode: "synthetic_demonstration",
        startsOn: "2026-09-01",
        endsOn: "2026-09-30",
        periodEvidenceId: cash.source.id,
        otherBoxes: "absent_in_synthetic_example",
      },
      Vat.VatDraft,
    );

    expect(draft.calculation.includedCount).toBe(includedCount);
    expect(draft.calculation.excludedCount).toBe(0);
    expect(draft.calculation.syntheticBoxes?.box48.exactMinor).toBe(
      includedCount === 0 ? "0" : "1",
    );
  }

  const basis = await decoded(await request(context.book, "/vat-returns/facts"), Vat.VatBasis);
  expect(basis.facts).toHaveLength(1);
  expect(basis.facts[0]?.fact.input).toMatchObject({
    netMinor: "0",
    vatMinor: "1",
    grossMinor: "1",
  });
  expect(basis.facts[0]?.fact.cashMethodRecognition).toMatchObject({
    originalGrossMinor: "4",
    originalTaxMinor: "1",
    recognizedBeforeMinor: "1",
    recognizedAfterMinor: "2",
  });
  const admin = await database();

  try {
    const balances = await admin.query(
      "select account_id,sum(debit_minor)::text as debit,sum(credit_minor)::text as credit from openerp.journal_lines where book_id=$1 group by account_id order by account_id",
      [context.book.bookId],
    );

    expect(balances.rows).toEqual([
      { account_id: "account_bank", debit: "0", credit: "4" },
      { account_id: "account_clearing", debit: "4", credit: "4" },
      { account_id: "account_expense", debit: "3", credit: "0" },
      { account_id: "account_vat", debit: "1", credit: "0" },
    ]);

    const coverage = await admin.query(
      "select paid_gross_minor,recognized_gross_minor,released_deductible_minor from openerp.cash_method_lines where book_id=$1",
      [context.book.bookId],
    );

    expect(coverage.rows).toEqual([
      { paid_gross_minor: "4", recognized_gross_minor: "4", released_deductible_minor: "1" },
    ]);
  } finally {
    await admin.end();
  }
}, 240000);

test("cash allocation refuses nonfinal/no-bank/unposted sources, overcapacity and wrong-book references", async () => {
  for (const options of [{ final: false }, { bank: false }]) {
    const context = await cashFixture();
    const cash = await postedCash(context.book, options);
    const before = await paymentSnapshot(context.book);
    await failure(
      await request(context.book, "/commerce/allocation-plans", {
        method: "POST",
        body: JSON.stringify({
          voucherId: cash.posted.voucherId,
          lineId: cash.clearingLineId,
          evidenceId: context.source.id,
          rationale: "Refuse unsupported cash",
          allocations: [{ invoiceId: context.invoice.id, amountMinor: "50000" }],
        }),
      }),
      422,
      "UnsupportedProfile",
    );
    expect(await paymentSnapshot(context.book)).toEqual(before);
  }

  const context = await cashFixture();
  const cash = await postedCash(context.book);

  const input = {
    voucherId: cash.posted.voucherId,
    lineId: cash.clearingLineId,
    evidenceId: context.source.id,
    rationale: "Retained capacity only",
    allocations: [{ invoiceId: context.invoice.id, amountMinor: "50001" }],
  };

  await failure(
    await request(context.book, "/commerce/allocation-plans", {
      method: "POST",
      body: JSON.stringify(input),
    }),
    409,
    "StaleDependency",
  );
  await failure(
    await request(context.book, "/commerce/allocation-plans", {
      method: "POST",
      body: JSON.stringify({ ...input, voucherId: "voucher_not_posted" }),
    }),
    404,
    "NotFound",
  );
  await failure(
    await request(await fixture(), "/commerce/allocation-plans", {
      method: "POST",
      body: JSON.stringify(input),
    }),
    404,
    "NotFound",
  );
}, 240000);

test("stale cash effects, locked periods and revoked approval authority preserve financial state", async () => {
  for (const change of ["account", "period", "authority"] as const) {
    const context = await cashFixture();
    const cash = await postedCash(context.book);
    const plan = await allocateCash(context, cash);

    const approval = await post(
      context.reviewer,
      `/commerce/allocation-plans/${plan.id}/approvals`,
      { version: 1, planDigest: plan.digest },
      Commerce.AllocationApproval,
    );

    const admin = await database();

    try {
      if (change === "account")
        await admin.query(
          "update openerp.accounts set version=version+1 where book_id=$1 and id='account_expense'",
          [context.book.bookId],
        );

      if (change === "period")
        await admin.query(
          "update openerp.periods set locked=true,version=version+1 where book_id=$1 and id='period_2026'",
          [context.book.bookId],
        );

      if (change === "authority")
        await admin.query("delete from openerp.memberships where book_id=$1 and actor_id=$2", [
          context.book.bookId,
          context.reviewer.actorId,
        ]);
    } finally {
      await admin.end();
    }

    const before = await paymentSnapshot(context.book);
    await failure(
      await request(context.book, `/commerce/allocation-plans/${plan.id}/apply`, {
        method: "POST",
        body: JSON.stringify({ version: 1, planDigest: plan.digest, approvalId: approval.id }),
      }),
      change === "authority" ? 403 : 409,
      change === "authority"
        ? "ApprovalRequired"
        : change === "period"
          ? "PeriodLocked"
          : "StaleDependency",
    );
    expect(await paymentSnapshot(context.book)).toEqual(before);
  }
}, 240000);

test("failure after posting and VAT writes rolls back counters, approvals, legs, facts and coverage; original key recovers", async () => {
  const context = await cashFixture();
  const cash = await postedCash(context.book);
  const plan = await allocateCash(context, cash);

  const approval = await post(
    context.reviewer,
    `/commerce/allocation-plans/${plan.id}/approvals`,
    { version: 1, planDigest: plan.digest },
    Commerce.AllocationApproval,
  );

  const admin = await database();

  try {
    await admin.query(
      "create function openerp.e2e_cash_rollback() returns trigger language plpgsql as $$ begin raise exception 'synthetic rollback after financial writes' using errcode='23514'; end $$",
    );
    await admin.query(
      `create trigger zz_e2e_cash_rollback before update on openerp.cash_method_lines for each row when (NEW.book_id='${context.book.bookId}') execute function openerp.e2e_cash_rollback()`,
    );
    const before = await paymentSnapshot(context.book);
    const commandKey = key();

    const apply = () =>
      request(context.book, `/commerce/allocation-plans/${plan.id}/apply`, {
        method: "POST",
        headers: { "idempotency-key": commandKey },
        body: JSON.stringify({ version: 1, planDigest: plan.digest, approvalId: approval.id }),
      });

    await failure(await apply(), 500, "InternalError");
    expect(await paymentSnapshot(context.book)).toEqual(before);
    await admin.query("drop trigger zz_e2e_cash_rollback on openerp.cash_method_lines");
    await admin.query("drop function openerp.e2e_cash_rollback()");
    const receipt = await decoded(await apply(), Commerce.AllocationReceipt);
    expect(await decoded(await apply(), Commerce.AllocationReceipt)).toEqual(receipt);
  } finally {
    await admin.end();
  }
}, 240000);
