import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Cash from "@open-erp/contracts/cash-method";
import * as Vat from "@open-erp/contracts/vat-returns";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import { database, decoded, failure, key, post, request, execute } from "./support/fixtures";
import { cashFixture, paymentSnapshot, postedCash, allocateCash } from "./support/cash-payment";
import { createDraft } from "./support/supplier-review";
import {
  askSupplierQuestion,
  closeSupplierQuestion,
  supplierQuestions,
} from "./support/work-questions";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { environment } from "./support/fixtures";

// Failure-first HTTP/PostgreSQL obligations: a suffix credit must never touch paid
// principal, unrecognized debt creates no accounting, and recognized debt reverses
// the original cumulative components once while preserving the year-end receipt.
const path = "/commerce/cash-method/credits";

async function fixture(date = "2026-10-01", gross = "25000", net = "20000", tax = "5000") {
  const context = await cashFixture();

  const evidence = await post(
    context.book,
    "/evidence",
    {
      title: "Synthetic unpaid supplier credit",
      content: "Original G125000; unpaid suffix credit25000 = net20000 + VAT5000. No cash refund.",
      mediaType: "text/plain",
      origin: "NEXT-38 independent credit fixture",
    },
    Accounting.Evidence,
  );

  const sourceLine = context.draft.content.lines[0];

  if (!sourceLine) throw new Error("Missing original source line");

  const creditDraft = await createDraft(context.book, {
    ...context.draft.content,
    sourceEvidenceId: evidence.id,
    supplierDocumentNumber: `CREDIT-${key()}`,
    documentDate: date,
    supplyDate: date,
    dueDate: date,
    supplier: { ...context.draft.content.supplier, evidenceId: evidence.id },
    buyer: { ...context.draft.content.buyer, evidenceId: evidence.id },
    sourceTotalMinor: gross,
    lines: [
      {
        ...sourceLine,
        id: "credit_source_line",
        baseMinor: net,
        unitPriceMinor: net,
        taxMinor: tax,
        sourceGrossMinor: gross,
        taxEvidenceId: evidence.id,
      },
    ],
  });

  const basis = Schema.decodeUnknownSync(Cash.CashInvoiceBasis)(context.invoice.cashMethod);
  const treatment = basis.lines[0]?.treatment;

  if (!treatment) throw new Error("Missing retained original treatment");

  const input = {
    invoiceId: context.invoice.id,
    draftId: creditDraft.id,
    expectedRevision: creditDraft.revision,
    expectedDigest: creditDraft.digest,
    accountingPeriodId: date.startsWith("2027") ? "period_2027" : "period_2026",
    series: "A",
    lineMappings: [{ creditLineId: "credit_source_line", sourceLineId: sourceLine.id, treatment }],
    rationale: "Credit the linked unpaid original suffix",
  };

  return { ...context, input, creditDraft, creditEvidence: evidence };
}

async function run(context: Awaited<ReturnType<typeof fixture>>) {
  const plan = await post(context.book, path, context.input, Cash.CashCreditPlan);

  const approval = await post(
    context.reviewer,
    `${path}/${plan.id}/approvals`,
    { planDigest: plan.digest },
    Cash.CashCreditApproval,
  );

  const commandKey = key();

  const execute = () =>
    request(context.book, `${path}/${plan.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify({ planDigest: plan.digest, approvalId: approval.id }),
    });

  const receipt = await decoded(await execute(), Cash.CashCreditReceipt);
  expect(await decoded(await execute(), Cash.CashCreditReceipt)).toEqual(receipt);

  return { plan, approval, receipt };
}

async function approvedCredit(context: Awaited<ReturnType<typeof fixture>>) {
  const plan = await post(context.book, path, context.input, Cash.CashCreditPlan);

  const approval = await post(
    context.reviewer,
    `${path}/${plan.id}/approvals`,
    { planDigest: plan.digest },
    Cash.CashCreditApproval,
  );

  return {
    plan,
    approval,
    execute: () =>
      request(context.book, `${path}/${plan.id}/execute`, {
        method: "POST",
        body: JSON.stringify({ planDigest: plan.digest, approvalId: approval.id }),
      }),
  };
}

test("recognized credit produces an exact negative synthetic VAT return", async () => {
  const context = await fixture("2027-01-22");

  await nextYear(context);
  await cutover(context);
  await run(context);

  const basis = await decoded(await request(context.book, "/vat-returns/facts"), Vat.VatBasis);

  const credit = basis.facts.find((observation) => observation.fact.cashMethodCredit !== undefined);

  if (!credit) throw new Error("Owned negative VAT fact is missing from the return basis");

  expect(credit.fact.input.vatMinor).toBe("-5000");
  expect(credit.taxLines).toHaveLength(1);
  expect(credit.taxLines[0]).toMatchObject({ debitMinor: "0", creditMinor: "5000" });

  const draft = await post(
    context.book,
    "/vat-returns/drafts",
    {
      mode: "synthetic_demonstration",
      startsOn: "2027-01-01",
      endsOn: "2027-01-31",
      periodEvidenceId: context.creditEvidence.id,
      otherBoxes: "absent_in_synthetic_example",
    },
    Vat.VatDraft,
  );

  expect(draft.calculation.includedCount).toBe(1);
  expect(draft.calculation.syntheticBoxes?.box48.exactMinor).toBe("-5000");
  expect(draft.calculation.syntheticBoxes?.box48.reportedKrona).toBe("-50");
  expect(draft.calculation.syntheticBoxes?.box48.residualMinor).toBe("0");
  expect(draft.calculation.syntheticBoxes?.box49?.exactMinor).toBe("5000");
}, 240000);

test("credit approval refuses after reviewer authority is revoked without writes", async () => {
  const context = await fixture();

  const prepared = await approvedCredit(context);
  const admin = await database();

  try {
    await admin.query("delete from openerp.memberships where book_id=$1 and actor_id=$2", [
      context.book.bookId,
      prepared.approval.actorId,
    ]);
  } finally {
    await admin.end();
  }

  const before = await snapshot(context);

  await failure(await prepared.execute(), 403, "ApprovalRequired");
  expect(await snapshot(context)).toEqual(before);
}, 240000);

test("credit refuses an approval bound to another plan without writes", async () => {
  const context = await fixture();

  const first = await approvedCredit(context);

  const second = await post(
    context.book,
    path,
    { ...context.input, rationale: "Separately reviewed plan" },
    Cash.CashCreditPlan,
  );

  const before = await snapshot(context);

  await failure(
    await request(context.book, `${path}/${second.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ planDigest: second.digest, approvalId: first.approval.id }),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await snapshot(context)).toEqual(before);
}, 240000);

test("changed retained credit draft makes an approved plan stale without financial writes", async () => {
  const context = await fixture();

  const prepared = await approvedCredit(context);

  await post(
    context.book,
    `/commerce/supplier-invoice-drafts/${context.creditDraft.id}/revisions`,
    {
      expectedRevision: context.creditDraft.revision,
      expectedDigest: context.creditDraft.digest,
      reason: "Change retained source after approval",
      content: { ...context.creditDraft.content, supplierDocumentNumber: `CHANGED-${key()}` },
    },
    Drafts.SupplierInvoiceDraftRevision,
  );

  const before = await snapshot(context);

  await failure(await prepared.execute(), 409, "StaleDependency");
  expect(await snapshot(context)).toEqual(before);
}, 240000);

test("credit and payment race serializes coverage and refuses the stale loser", async () => {
  const context = await fixture();

  const cash = await postedCash(context.book, { amountMinor: "50000" });

  const allocation = await allocateCash(context, cash, "50000");

  const paymentApproval = await post(
    context.reviewer,
    `/commerce/allocation-plans/${allocation.id}/approvals`,
    { version: 1, planDigest: allocation.digest },
    Commerce.AllocationApproval,
  );

  const credit = await approvedCredit(context);

  const responses = await Promise.all([
    credit.execute(),
    request(context.book, `/commerce/allocation-plans/${allocation.id}/apply`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        planDigest: allocation.digest,
        approvalId: paymentApproval.id,
      }),
    }),
  ]);

  expect(responses.filter((response) => response.ok)).toHaveLength(1);

  const loser = responses.find((response) => !response.ok);

  if (!loser) throw new Error("Concurrent stale plan unexpectedly committed");

  await failure(loser, 409, "StaleDependency");

  const invoice = await decoded(
    await request(context.book, `/commerce/invoices/${context.invoice.id}`),
    Commerce.Invoice,
  );

  expect(invoice.outstandingMinor).toBe(responses[0]?.ok ? "100000" : "75000");
  expect(invoice.creditedMinor).toBe(responses[0]?.ok ? "25000" : "0");
  expect(invoice.recordedAllocatedMinor).toBe(responses[0]?.ok ? "0" : "50000");
}, 240000);

async function cutover(context: Awaited<ReturnType<typeof fixture>>) {
  const evidence = await post(
    context.book,
    "/evidence",
    {
      title: "Synthetic complete year-end review",
      content: "Independent review of the complete native unpaid population",
      mediaType: "text/plain",
      origin: "NEXT-38 credit fixture cutover",
    },
    Accounting.Evidence,
  );

  const input = {
    fiscalYearId: "fy_2026",
    cutoffOn: "2026-12-31",
    evidenceId: evidence.id,
    rationale: "Complete original unpaid population",
    series: "A",
  };

  const plan = await post(
    context.book,
    "/commerce/cash-method/year-end",
    input,
    Cash.CashYearEndPlan,
  );

  const approval = await post(
    context.reviewer,
    `/commerce/cash-method/year-end/${plan.id}/approvals`,
    { planDigest: plan.digest },
    Cash.CashYearEndApproval,
  );

  return post(
    context.book,
    `/commerce/cash-method/year-end/${plan.id}/execute`,
    { planDigest: plan.digest, approvalId: approval.id },
    Cash.CashYearEndReceipt,
  );
}

async function nextYear(context: Awaited<ReturnType<typeof fixture>>) {
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
}

async function snapshot(context: Awaited<ReturnType<typeof fixture>>) {
  const financial = await paymentSnapshot(context.book);
  const admin = await database();

  try {
    const rows = await admin.query(
      "select (select count(*)::text from openerp.cash_method_credits where book_id=$1) as credits,(select count(*)::text from openerp.cash_method_credit_lines where book_id=$1) as lines,(select count(*)::text from openerp.cash_method_credit_approvals where book_id=$1 and consumed_at is not null) as approvals,(select count(*)::text from openerp.command_receipts where book_id=$1) as commands",
      [context.book.bookId],
    );

    return { financial, credit: rows.rows[0] };
  } finally {
    await admin.end();
  }
}

test("recognized-unpaid credit appends one negative VAT fact and exact linked correction", async () => {
  const context = await fixture("2027-01-22");
  const original = await cutover(context);

  await nextYear(context);

  const { receipt } = await run(context);

  expect(receipt).toMatchObject({ creditGrossMinor: "25000", recognizedCorrectionMinor: "25000" });
  expect(receipt.lines[0]).toMatchObject({
    correctionNetMinor: "20000",
    correctionTaxMinor: "5000",
    correctionDeductibleMinor: "5000",
    before: { creditedGrossMinor: "0", paidGrossMinor: "0", recognizedGrossMinor: "125000" },
    after: { creditedGrossMinor: "25000", paidGrossMinor: "0", recognizedGrossMinor: "100000" },
  });
  expect(receipt.vatFactIds).toHaveLength(1);

  const vatBasis = await decoded(await request(context.book, "/vat-returns/facts"), Vat.VatBasis);

  const negative = vatBasis.facts.find(
    (observation) => observation.fact.factId === receipt.vatFactIds[0],
  )?.fact;

  if (!negative) throw new Error("Owned negative credit VAT fact is missing from the native read");

  expect(negative.input).toMatchObject({
    netMinor: "-20000",
    vatMinor: "-5000",
    grossMinor: "-25000",
    dateBasis: "cash_credit",
  });

  const protectedState = await snapshot(context);

  await failure(
    await request(context.book, `/vat-returns/facts/${negative.factId}/withdrawal`, {
      method: "POST",
      body: JSON.stringify({
        expectedDigest: negative.digest,
        evidenceId: context.creditEvidence.id,
        rationale: "Manual withdrawal must not bypass linked coverage",
      }),
    }),
    422,
    "UnsupportedProfile",
  );
  expect(await snapshot(context)).toEqual(protectedState);

  const admin = await database();

  try {
    const ledger = await admin.query(
      "select account_id,debit_minor::text as debit,credit_minor::text as credit from openerp.journal_lines where book_id=$1 and voucher_id=$2 order by account_id",
      [context.book.bookId, receipt.postingReceipt?.voucherId],
    );

    expect(ledger.rows).toEqual([
      { account_id: "account_clearing", debit: "25000", credit: "0" },
      { account_id: "account_expense", debit: "0", credit: "20000" },
      { account_id: "account_vat", debit: "0", credit: "5000" },
    ]);

    const facts = await admin.query(
      "select r.body->'input'->>'vatMinor' as vat from openerp.vat_fact_revisions r where book_id=$1 order by (r.body->'input'->>'vatMinor')::numeric",
      [context.book.bookId],
    );

    expect(facts.rows).toEqual([{ vat: "-5000" }, { vat: "25000" }]);

    const sealed = await admin.query(
      "select body from openerp.cash_method_year_end_runs where book_id=$1 and id=$2",
      [context.book.bookId, original.id],
    );

    expect(sealed.rows[0]?.body).toEqual(original);
  } finally {
    await admin.end();
  }

  const before = await snapshot(context);

  await failure(
    await request(context.book, path, { method: "POST", body: JSON.stringify(context.input) }),
    409,
    "IdempotencyConflict",
  );
  expect(await snapshot(context)).toEqual(before);
}, 240000);

test("posted retained credit source refuses reuse without financial or credit writes", async () => {
  const context = await fixture();

  const journal = await post(
    context.book,
    "/change-sets",
    {
      kind: "manual_journal",
      evidenceId: context.creditEvidence.id,
      eventKey: key(),
      accountingPeriodId: "period_2026",
      postingDate: "2026-10-01",
      series: "A",
      description: "Already accounted synthetic credit source",
      rationale: "Refusal fixture",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "account_expense",
          debitMinor: "25000",
          creditMinor: "0",
          description: "Synthetic cost",
        },
        {
          accountId: "account_bank",
          debitMinor: "0",
          creditMinor: "25000",
          description: "Synthetic offset",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  await execute(context.book, journal);

  const before = await snapshot(context);

  await failure(
    await request(context.book, path, { method: "POST", body: JSON.stringify(context.input) }),
    409,
    "AlreadyPosted",
  );
  expect(await snapshot(context)).toEqual(before);
}, 240000);

test("forward credit integrity refuses partial-null originals and altered frozen component identity", async () => {
  const context = await fixture();

  await run(context);

  const admin = await database();

  try {
    await expect(
      admin.query(
        "update openerp.cash_method_lines set original_tax_minor=null,version=version+1 where book_id=$1",
        [context.book.bookId],
      ),
    ).rejects.toThrow();
    await expect(
      admin.query(
        "update openerp.cash_method_lines set original_net_minor='99999',original_tax_minor='25001',version=version+1 where book_id=$1",
        [context.book.bookId],
      ),
    ).rejects.toThrow();

    const retained = await admin.query(
      "select original_net_minor as net,original_tax_minor as tax,credited_gross_minor as credited from openerp.cash_method_lines where book_id=$1",
      [context.book.bookId],
    );

    expect(retained.rows).toEqual([{ net: "100000", tax: "25000", credited: "25000" }]);
  } finally {
    await admin.end();
  }
}, 240000);

test("cash credit refuses paid principal rather than opening an unqualified refund", async () => {
  const context = await fixture("2026-10-01", "100000", "80000", "20000");
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
    `/commerce/allocation-plans/${plan.id}/apply`,
    { version: 1, planDigest: plan.digest, approvalId: approval.id },
    Commerce.AllocationReceipt,
  );

  const before = await snapshot(context);

  await failure(
    await request(context.book, path, { method: "POST", body: JSON.stringify(context.input) }),
    422,
    "UnsupportedProfile",
  );
  expect(await snapshot(context)).toEqual(before);
}, 240000);

test("late persistence failure rolls back credit journal, VAT, coverage, approval and receipt; original key recovers", async () => {
  const context = await fixture("2027-01-22");

  await cutover(context);
  await nextYear(context);

  const plan = await post(context.book, path, context.input, Cash.CashCreditPlan);

  const approval = await post(
    context.reviewer,
    `${path}/${plan.id}/approvals`,
    { planDigest: plan.digest },
    Cash.CashCreditApproval,
  );

  const commandKey = key();

  const execute = () =>
    request(context.book, `${path}/${plan.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify({ planDigest: plan.digest, approvalId: approval.id }),
    });

  const before = await snapshot(context);
  const admin = await database();

  try {
    await admin.query(
      "create function openerp.e2e_cash_credit_rollback() returns trigger language plpgsql as $$ begin raise exception 'synthetic late credit rollback' using errcode='23514'; end $$",
    );
    await admin.query(
      `create trigger zz_e2e_cash_credit_rollback before update on openerp.cash_method_lines for each row when (NEW.book_id='${context.book.bookId}') execute function openerp.e2e_cash_credit_rollback()`,
    );

    await failure(await execute(), 500, "InternalError");
    expect(await snapshot(context)).toEqual(before);
  } finally {
    await admin.query(
      "drop trigger if exists zz_e2e_cash_credit_rollback on openerp.cash_method_lines",
    );
    await admin.query("drop function if exists openerp.e2e_cash_credit_rollback()");
    await admin.end();
  }

  const receipt = await decoded(await execute(), Cash.CashCreditReceipt);

  expect(receipt.recognizedCorrectionMinor).toBe("25000");
  expect(await decoded(await execute(), Cash.CashCreditReceipt)).toEqual(receipt);
}, 240000);

test("unrecognized unpaid credit changes native commercial debt without journal or VAT", async () => {
  const context = await fixture();
  const before = await paymentSnapshot(context.book);
  const { receipt } = await run(context);
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

  expect(invoice).toMatchObject({
    creditedMinor: "25000",
    outstandingMinor: "100000",
    recognition: null,
  });
  const after = await paymentSnapshot(context.book);

  expect(after.vouchers).toEqual(before.vouchers);
  expect(after.facts).toEqual(before.facts);

  const alias = await createDraft(context.book, {
    ...context.creditDraft.content,
    supplierDocumentNumber: `CREDIT-ALIAS-${key()}`,
  });

  const originalBasis = Schema.decodeUnknownSync(Cash.CashInvoiceBasis)(context.invoice.cashMethod);
  const aliasBefore = await snapshot(context);

  await failure(
    await request(context.book, "/commerce/invoices/cash-method", {
      method: "POST",
      body: JSON.stringify({
        profile: originalBasis.profile,
        draftId: alias.id,
        expectedRevision: alias.revision,
        expectedDigest: alias.digest,
        controlAccountId: originalBasis.controlAccountId,
        inputVatAccountId: originalBasis.inputVatAccountId,
        lineAssignments: context.input.lineMappings.map((mapping) => ({
          lineId: mapping.creditLineId,
          expenseAccountId: "account_expense",
          treatment: mapping.treatment,
        })),
        reason: "A second label cannot re-admit the consumed credit source",
        acknowledgeSyntheticOnly: true,
      }),
    }),
    409,
    "IdempotencyConflict",
  );
  expect(await snapshot(context)).toEqual(aliasBefore);

  const cash = await postedCash(context.book, { amountMinor: "100000" });

  const allocation = await allocateCash(context, cash, "100000");

  const approval = await post(
    context.reviewer,
    `/commerce/allocation-plans/${allocation.id}/approvals`,
    { version: 1, planDigest: allocation.digest },
    Commerce.AllocationApproval,
  );

  await post(
    context.book,
    `/commerce/allocation-plans/${allocation.id}/apply`,
    { version: 1, planDigest: allocation.digest, approvalId: approval.id },
    Commerce.AllocationReceipt,
  );

  const settled = await decoded(
    await request(context.book, `/commerce/invoices/${context.invoice.id}`),
    Commerce.Invoice,
  );

  expect(settled).toMatchObject({
    effectiveAmountMinor: "100000",
    creditedMinor: "25000",
    recordedAllocatedMinor: "100000",
    outstandingMinor: "0",
  });

  const facts = await decoded(await request(context.book, "/vat-returns/facts"), Vat.VatBasis);

  expect(facts.facts.map((observation) => observation.fact.input.vatMinor)).toEqual(["20000"]);
}, 240000);

test("backdated credit requires amendment and retains the sealed year-end receipt", async () => {
  const context = await fixture("2026-12-31");

  const yearInput = {
    fiscalYearId: "fy_2026",
    cutoffOn: "2026-12-31",
    evidenceId: context.source.id,
    rationale: "Complete original unpaid population",
    series: "A",
  };

  const year = await post(
    context.book,
    "/commerce/cash-method/year-end",
    yearInput,
    Cash.CashYearEndPlan,
  );

  const approval = await post(
    context.reviewer,
    `/commerce/cash-method/year-end/${year.id}/approvals`,
    { planDigest: year.digest },
    Cash.CashYearEndApproval,
  );

  const original = await post(
    context.book,
    `/commerce/cash-method/year-end/${year.id}/execute`,
    { planDigest: year.digest, approvalId: approval.id },
    Cash.CashYearEndReceipt,
  );
  // Credit dated at/before the completed cutoff requires an owned amendment.

  const before = await paymentSnapshot(context.book);
  await failure(
    await request(context.book, path, { method: "POST", body: JSON.stringify(context.input) }),
    409,
    "StaleDependency",
  );
  expect(await paymentSnapshot(context.book)).toEqual(before);
  const admin = await database();

  try {
    const rows = await admin.query(
      "select body from openerp.cash_method_year_end_runs where book_id=$1 and id=$2",
      [context.book.bookId, original.id],
    );

    expect(rows.rows[0]?.body).toEqual(original);
  } finally {
    await admin.end();
  }
}, 240000);

test("retained source overcapacity and unknown original-line credit refuse with no financial writes", async () => {
  const context = await fixture("2026-10-01", "150000", "120000", "30000");
  const before = await paymentSnapshot(context.book);

  for (const lineMappings of [
    context.input.lineMappings,
    [{ ...context.input.lineMappings[0], sourceLineId: "invented_original" }],
  ]) {
    await failure(
      await request(context.book, path, {
        method: "POST",
        body: JSON.stringify({ ...context.input, lineMappings }),
      }),
      422,
      "UnsupportedProfile",
    );
    expect(await paymentSnapshot(context.book)).toEqual(before);
  }
}, 240000);

test("retained credit VAT split must match the original suffix before and after year-end", async () => {
  const context = await fixture("2027-01-22", "3", "2", "1");
  const originalLine = context.draft.content.lines[0];
  const basis = Schema.decodeUnknownSync(Cash.CashInvoiceBasis)(context.invoice.cashMethod);

  if (!originalLine) throw new Error("Missing original fixture line");

  const evidence = await post(
    context.book,
    "/evidence",
    {
      title: "Small independently rounded original",
      content:
        "Original N5/VAT1/G6; source credit N2/VAT1/G3 is not its exact suffix. Suffix is net3/VAT0.",
      mediaType: "text/plain",
      origin: "NEXT-38 cumulative suffix refusal",
    },
    Accounting.Evidence,
  );

  const draft = await createDraft(context.book, {
    ...context.draft.content,
    sourceEvidenceId: evidence.id,
    supplierDocumentNumber: `SMALL-${key()}`,
    sourceTotalMinor: "6",
    supplier: { ...context.draft.content.supplier, evidenceId: evidence.id },
    buyer: { ...context.draft.content.buyer, evidenceId: evidence.id },
    lines: [
      {
        ...originalLine,
        baseMinor: "5",
        unitPriceMinor: "5",
        taxMinor: "1",
        sourceGrossMinor: "6",
        taxEvidenceId: evidence.id,
      },
    ],
  });

  const invoice = await post(
    context.book,
    "/commerce/invoices/cash-method",
    {
      profile: basis.profile,
      draftId: draft.id,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      controlAccountId: basis.controlAccountId,
      inputVatAccountId: basis.inputVatAccountId,
      lineAssignments: basis.lines.map((line) => ({
        lineId: line.sourceLineId,
        expenseAccountId: line.expenseAccountId,
        treatment: line.treatment,
      })),
      reason: "Retain independently rounded source",
      acknowledgeSyntheticOnly: true,
    },
    Commerce.Invoice,
  );

  context.input.invoiceId = invoice.id;

  await nextYear(context);

  const unrecognized = await snapshot(context);

  await failure(
    await request(context.book, path, { method: "POST", body: JSON.stringify(context.input) }),
    422,
    "UnsupportedProfile",
  );
  expect(await snapshot(context)).toEqual(unrecognized);

  await cutover(context);

  const recognized = await snapshot(context);

  await failure(
    await request(context.book, path, { method: "POST", body: JSON.stringify(context.input) }),
    422,
    "UnsupportedProfile",
  );
  expect(await snapshot(context)).toEqual(recognized);
}, 240000);

test("cash credit retains supplier questions through preparation, approval and execution", async () => {
  const context = await fixture();
  const { book, creditDraft, input } = context;

  const initialQuestion = await askSupplierQuestion(
    book,
    creditDraft.id,
    "Confirm the retained credit source before preparation",
  );

  const beforePreparation = await snapshot(context);
  const history = await supplierQuestions(book, creditDraft.id);
  const prepareKey = key();

  const prepare = () =>
    request(book, path, {
      method: "POST",
      headers: { "idempotency-key": prepareKey },
      body: JSON.stringify(input),
    });

  await failure(await prepare(), 422, "MissingEvidence");
  expect(await snapshot(context)).toEqual(beforePreparation);
  expect(await supplierQuestions(book, creditDraft.id)).toEqual(history);
  await closeSupplierQuestion(book, creditDraft.id, initialQuestion.id);
  const plan = await decoded(await prepare(), Cash.CashCreditPlan);
  expect(await decoded(await prepare(), Cash.CashCreditPlan)).toEqual(plan);

  const later = await askSupplierQuestion(
    book,
    creditDraft.id,
    "Resolve the retained credit question before approval",
  );

  const approveKey = key();

  const approve = () =>
    request(context.reviewer, `${path}/${plan.id}/approvals`, {
      method: "POST",
      headers: { "idempotency-key": approveKey },
      body: JSON.stringify({ planDigest: plan.digest }),
    });

  const beforeApproval = await snapshot(context);

  await failure(await approve(), 422, "MissingEvidence");
  expect(await snapshot(context)).toEqual(beforeApproval);
  await closeSupplierQuestion(book, creditDraft.id, later.id);
  const approval = await decoded(await approve(), Cash.CashCreditApproval);

  const executionQuestion = await askSupplierQuestion(
    book,
    creditDraft.id,
    "Review the credit before consuming the retained approval",
  );

  const beforeExecution = await snapshot(context);
  const executeKey = key();

  const execute = () =>
    request(book, `${path}/${plan.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": executeKey },
      body: JSON.stringify({ planDigest: plan.digest, approvalId: approval.id }),
    });

  await failure(await execute(), 422, "MissingEvidence");
  expect(await snapshot(context)).toEqual(beforeExecution);
  const closed = await closeSupplierQuestion(book, creditDraft.id, executionQuestion.id);
  const receipt = await decoded(await execute(), Cash.CashCreditReceipt);
  expect(await decoded(await execute(), Cash.CashCreditReceipt)).toEqual(receipt);
  const completed = await supplierQuestions(book, creditDraft.id);
  expect(completed.owner.completed).toBe(true);
  expect(completed.questions.every((question) => question.state === "closed")).toBe(true);
  await writeFile(
    join(environment().artifacts, "cash-credit-question-gates.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        root: initialQuestion.root,
        draftId: creditDraft.id,
        question: closed,
        planId: plan.id,
        receipt,
        beforePreparation,
        beforeApproval,
        beforeExecution,
        afterExecution: await snapshot(context),
        exactReplay: true,
      },
      null,
      2,
    ),
  );
}, 240000);
