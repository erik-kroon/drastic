import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { legalFixture } from "./support/legal-commerce";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Controls from "@open-erp/contracts/subledger-controls";
import * as Subledgers from "@open-erp/contracts/subledgers";
import * as Disposals from "@open-erp/contracts/asset-disposals";
import * as Bank from "@open-erp/contracts/reconciliation";
import {
  database,
  failure,
  decoded,
  environment,
  evidence,
  execute,
  fixture,
  journal,
  key,
  persisted,
  post,
  request,
  createSession,
} from "./support/fixtures";

async function assetFixture(withInvoice = false) {
  const accounts = [
    { id: "asset_gross", code: "1220", name: "Asset gross" },
    { id: "asset_ordinary", code: "1229", name: "Ordinary accumulation" },
    { id: "asset_expense", code: "7830", name: "Depreciation expense" },
    { id: "asset_impairment", code: "1228", name: "Impairment contra" },
    { id: "asset_loss", code: "7730", name: "Impairment loss" },
    { id: "asset_income", code: "3990", name: "Disposal gain" },
    { id: "sale_vat", code: "2612", name: "Sale VAT" },
  ];

  const legal = withInvoice
    ? await legalFixture(accounts, {
        lines: [
          {
            id: "asset_sale_line",
            description: "Synthetic disposed machine",
            quantity: "1",
            unitPriceMinor: "450000",
            baseMinor: "450000",
            discountMinor: "0",
            chargeMinor: "0",
            taxMinor: "112500",
            taxDescription: "se-domestic-standard-25-v1",
            sourceGrossMinor: "562500",
          },
        ],
        sourceTotalMinor: "562500",
      })
    : null;

  const book = legal?.book ?? (await fixture(accounts));

  const source = await evidence(book);

  const reviewSource = await evidence(book);

  const plan = await post(
    book,
    "/change-sets",
    {
      ...journal(source.id),
      lines: [
        {
          accountId: "asset_gross",
          debitMinor: "1000000",
          creditMinor: "0",
          description: "Retained gross",
        },
        {
          accountId: "asset_ordinary",
          debitMinor: "0",
          creditMinor: "200000",
          description: "Opening ordinary",
        },
        {
          accountId: "account_clearing",
          debitMinor: "0",
          creditMinor: "800000",
          description: "Opening funding",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const opening = await execute(book, plan);

  const dates = [
    "2026-09-30",
    "2026-10-10",
    "2026-10-20",
    "2026-10-30",
    "2026-11-10",
    "2026-11-20",
    "2026-11-30",
    "2026-12-10",
  ];

  const schedule = await post(
    book,
    "/schedules",
    {
      sourceKey: `asset_${key().replaceAll("-", "")}`,
      terms: {
        kind: "asset",
        name: "Synthetic machine",
        evidenceId: source.id,
        rationale: "Retained original without-impairment history",
        costMinor: "800000",
        residualMinor: "0",
        usefulPeriods: 8,
        allocationPolicy: "equal_minor_final_remainder_v1",
        debitAccountId: "asset_expense",
        creditAccountId: "asset_ordinary",
        series: "A",
        taxAssessment: "not_applicable",
        periods: dates.map((postingDate) => ({ postingDate, accountingPeriodId: "period_2026" })),
      },
    },
    Subledgers.ScheduleRevision,
  );

  const basis = await post(
    book,
    "/subledger-controls/bases",
    {
      scheduleId: schedule.scheduleId,
      expectedDigest: schedule.digest,
      kind: "imported_opening",
      effectiveOn: "2026-09-22",
      evidenceId: source.id,
      sourceLocator: "synthetic-asset-opening",
      reviewEvidenceId: reviewSource.id,
      rationale: "Gross and ordinary opening are independently retained",
      originalCostMinor: "1000000",
      accumulatedMinor: "200000",
      carryingMinor: "800000",
      voucherId: opening.voucherId,
      lineIds: plan.groups[0]?.actions[0]?.lines.slice(0, 2).map((line) => line.lineId) ?? [],
    },
    Controls.SubledgerBasis,
  );

  const impaired = await post(
    book,
    "/subledger-controls/impairments/prepare",
    {
      profile: "synthetic_asset_impairment_v1",
      scheduleId: schedule.scheduleId,
      decisionKey: key().replaceAll("-", ""),
      expectedDigest: schedule.digest,
      expectedBasisDigest: basis.digest,
      postingDate: "2026-10-04",
      accountingPeriodId: "period_2026",
      series: "A",
      lossAccountId: "asset_loss",
      accumulatedImpairmentAccountId: "asset_impairment",
      impairmentMinor: "300000",
      futureMinor: "500000",
      residualMinor: "0",
      installments: [
        { postingDate: "2026-11-20", accountingPeriodId: "period_2026", amountMinor: "250000" },
        { postingDate: "2026-12-20", accountingPeriodId: "period_2026", amountMinor: "250000" },
      ],
      evidenceId: source.id,
      reviewEvidenceId: reviewSource.id,
      rationale: "Reviewed initial impairment",
      taxAssessment: "not_applicable",
      acknowledgeSyntheticOnly: true,
    },
    Controls.AssetImpairmentReview,
  );

  const approval = await post(
    book,
    `/subledger-controls/impairments/${impaired.id}/approve`,
    { version: 1, digest: impaired.digest, acknowledgeSyntheticOnly: true },
    Controls.AssetImpairmentApproval,
  );

  await post(
    book,
    `/subledger-controls/impairments/${impaired.id}/execute`,
    {
      version: 1,
      digest: impaired.digest,
      approvalId: approval.id,
      acknowledgeSyntheticOnly: true,
    },
    Subledgers.AssetImpairment,
  );

  const statementSource = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "synthetic_asset_cash",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-10-01",
    endsOn: "2026-10-31",
    openingMinor: "0",
    closingMinor: "812500",
    completeness: { declaredComplete: true, basis: "Synthetic sale receipt" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date: "2026-10-04",
        description: "Asset sale",
        amountMinor: "812500",
      },
    ],
  };

  const statementEvidence = await post(
    book,
    "/evidence",
    {
      title: "Synthetic asset sale receipt",
      mediaType: "application/json",
      content: JSON.stringify(statementSource),
      origin: "Synthetic disposal proof",
    },
    Accounting.Evidence,
  );

  const statement = await post(
    book,
    "/bank-statements",
    { ...statementSource, evidenceId: statementEvidence.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );

  const session = await createSession(book);

  const browser = { ...book, token: session.token };

  const input: typeof Disposals.PrepareDisposal.Type = {
    kind: "disposal",
    profile: "synthetic_asset_proceeds_v1",
    scheduleId: schedule.scheduleId,
    expectedDigest: impaired.proposedRevision.digest,
    expectedBasisDigest: basis.digest,
    postingDate: legal?.original.issuedOn ?? "2026-10-04",
    accountingPeriodId: "period_2026",
    series: "A",
    gainAccountId: "asset_income",
    lossAccountId: "asset_loss",
    evidenceId: source.id,
    reviewEvidenceId: reviewSource.id,
    rationale: "Reviewed disposal from stored sale receipt",
    acknowledgeSyntheticOnly: true,
    proceeds: {
      kind: "unposted_cash_sale",
      statementId: statement.statement.id,
      rowOrdinal: 1,
      outputVatAccountId: "sale_vat",
      taxProfile: "synthetic_domestic_standard_25_v1",
      taxEvidenceId: reviewSource.id,
    },
  };

  return { book, browser, input, basis, schedule, impaired, legal };
}

async function prepareAndApprove(state: Awaited<ReturnType<typeof assetFixture>>) {
  const review = await post(state.book, "/asset-disposals/prepare", state.input, Disposals.Review);

  const approval = await post(
    state.browser,
    `/asset-disposals/${review.id}/approve`,
    { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true },
    Disposals.Approval,
  );

  return {
    review,
    approval,
    executeInput: {
      version: 1,
      digest: review.digest,
      acknowledgeSyntheticOnly: true,
      approvalId: approval.id,
    },
  };
}

async function retain(name: string, body: unknown) {
  await writeFile(join(environment().artifacts, `${name}.json`), JSON.stringify(body, null, 2));
}

test("cash disposal clears gross and both contras, records VAT once and recovers exact replay", async () => {
  const state = await assetFixture();

  const { review, approval, executeInput } = await prepareAndApprove(state);
  expect(review.domainPlan.carryingRemovedMinor).toBe("500000");
  expect(review.domainPlan.profitMinor).toBe("150000");
  expect(review.proceeds.netMinor).toBe("650000");
  expect(review.proceeds.vatMinor).toBe("162500");
  expect(
    review.domainPlan.journal.map(({ accountId, debitMinor, creditMinor }) => ({
      accountId,
      debitMinor,
      creditMinor,
    })),
  ).toEqual([
    { accountId: "account_bank", debitMinor: "812500", creditMinor: "0" },
    { accountId: "sale_vat", debitMinor: "0", creditMinor: "162500" },
    { accountId: "asset_ordinary", debitMinor: "200000", creditMinor: "0" },
    { accountId: "asset_impairment", debitMinor: "300000", creditMinor: "0" },
    { accountId: "asset_gross", debitMinor: "0", creditMinor: "1000000" },
    { accountId: "asset_income", debitMinor: "0", creditMinor: "150000" },
  ]);

  const commandKey = key();

  const executeRequest = () =>
    request(state.browser, `/asset-disposals/${review.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(executeInput),
    });

  const result = await decoded(await executeRequest(), Disposals.DisposalEffect);

  const replay = await decoded(await executeRequest(), Disposals.DisposalEffect);
  expect(replay).toEqual(result);
  expect(result.vatFact?.input.netMinor).toBe("650000");
  expect(result.vatFact?.input.vatMinor).toBe("162500");
  expect(result.bankAllocation?.legs[0]?.amountMinor).toBe("812500");
  expect(result.carryingMinor).toBe("0");

  if (!result.vatFact || !result.bankAllocation)
    throw new Error("Cash disposal retains VAT and canonical bank allocation.");
  await failure(
    await request(state.browser, "/vat-returns/facts", {
      method: "POST",
      body: JSON.stringify({ ...result.vatFact.input, expectedDigest: result.vatFact.digest }),
    }),
    422,
    "UnsupportedProfile",
  );
  await failure(
    await request(state.browser, `/vat-returns/facts/${result.vatFact.factId}/withdrawal`, {
      method: "POST",
      body: JSON.stringify({
        expectedDigest: result.vatFact.digest,
        evidenceId: state.input.reviewEvidenceId,
        rationale: "Generic withdrawal must respect the disposal owner",
      }),
    }),
    422,
    "UnsupportedProfile",
  );
  const allocation = result.bankAllocation;
  await failure(
    await request(state.browser, `/bank-allocation-plans/${allocation.planId}/approve`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: allocation.digest }),
    }),
    403,
    "ApprovalRequired",
  );
  await failure(
    await request(state.browser, `/bank-allocation-plans/${allocation.planId}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        digest: allocation.digest,
        approvalId: allocation.approvalId,
      }),
    }),
    403,
    "ApprovalRequired",
  );
  await failure(
    await request(state.browser, "/bank-match-reversal-plans", {
      method: "POST",
      body: JSON.stringify({
        target: { kind: "allocation", allocationPlanId: allocation.planId },
        reason: "Generic unmatch must respect exact disposal correction",
      }),
    }),
    403,
    "ApprovalRequired",
  );

  const saved = await persisted(state.book);

  const admin = await database();

  try {
    const lines = await admin.query<{ count: number }>(
      "select count(*)::int as count from openerp.journal_lines where book_id=$1 and voucher_id=$2",
      [state.book.bookId, result.postingReceipt.voucherId],
    );

    expect(lines.rows[0]?.count).toBe(6);
  } finally {
    await admin.end();
  }

  await retain("asset-disposal-cash", { review, approval, result, saved });
});

test("correction atomically restores carrying, withdraws VAT and releases reusable source", async () => {
  const state = await assetFixture();

  const { review, executeInput } = await prepareAndApprove(state);

  const disposed = await post(
    state.browser,
    `/asset-disposals/${review.id}/execute`,
    executeInput,
    Disposals.DisposalEffect,
  );

  const correction = await post(
    state.book,
    "/asset-disposals/prepare",
    {
      kind: "error_correction",
      profile: "synthetic_asset_proceeds_v1",
      disposalId: disposed.id,
      expectedDigest: disposed.digest,
      postingDate: "2026-10-05",
      accountingPeriodId: "period_2026",
      series: "A",
      evidenceId: state.input.evidenceId,
      reviewEvidenceId: state.input.reviewEvidenceId,
      rationale: "Immediate erroneous sale correction",
      acknowledgeSyntheticOnly: true,
    },
    Disposals.Review,
  );

  const approved = await post(
    state.browser,
    `/asset-disposals/${correction.id}/approve`,
    { version: 1, digest: correction.digest, acknowledgeSyntheticOnly: true },
    Disposals.Approval,
  );

  const corrected = await post(
    state.browser,
    `/asset-disposals/${correction.id}/execute`,
    {
      version: 1,
      digest: correction.digest,
      approvalId: approved.id,
      acknowledgeSyntheticOnly: true,
    },
    Disposals.DisposalEffect,
  );

  expect(
    corrected.domainPlan.journal.map(({ debitMinor, creditMinor }) => ({
      debitMinor,
      creditMinor,
    })),
  ).toEqual([
    { debitMinor: "0", creditMinor: "812500" },
    { debitMinor: "162500", creditMinor: "0" },
    { debitMinor: "0", creditMinor: "200000" },
    { debitMinor: "0", creditMinor: "300000" },
    { debitMinor: "1000000", creditMinor: "0" },
    { debitMinor: "150000", creditMinor: "0" },
  ]);
  expect(corrected.carryingMinor).toBe("500000");
  expect(corrected.futureRecognitionBlocked).toBe(false);
  expect(corrected.asset).toBeNull();
  expect(corrected.vatWithdrawal?.permanent).toBe(true);
  expect(corrected.bankReversal?.releasedLegs[0]?.amountMinor).toBe("812500");

  const controls = [];

  for (const [asOfDate, carryingMinor] of [
    ["2026-10-04", "0"],
    ["2026-10-05", "500000"],
  ] as const) {
    const control = await post(
      state.book,
      "/subledger-controls/snapshots",
      {
        asOfDate,
        accountIds: ["asset_gross", "asset_ordinary", "asset_impairment"],
        inventoryEvidenceId: state.input.reviewEvidenceId,
        rationale: "Retain immutable disposal and restoration cutoff proof",
      },
      Controls.SubledgerControl,
    );

    expect(control.controls.map((row) => row.differenceMinor)).toEqual(["0", "0", "0"]);
    expect(control.schedules[0]?.carryingMinor).toBe(carryingMinor);
    controls.push(control);
  }

  const fresh = await prepareAndApprove({
    ...state,
    input: { ...state.input, postingDate: "2026-10-05" },
  });

  const second = await post(
    state.browser,
    `/asset-disposals/${fresh.review.id}/execute`,
    fresh.executeInput,
    Disposals.DisposalEffect,
  );

  expect(second.bankAllocation?.planId).not.toBe(disposed.bankAllocation?.planId);
  expect(second.domainPlan.profitMinor).toBe("150000");

  await retain("asset-disposal-correction-reuse", {
    disposed,
    correction,
    corrected,
    controls,
    second,
  });
});

test("public boundary rejects client amounts, non-session approvals and cross-book reads", async () => {
  const state = await assetFixture();

  const malformed = await request(state.book, "/asset-disposals/prepare", {
    method: "POST",
    body: JSON.stringify({ ...state.input, proceedsMinor: "1" }),
  });

  expect(malformed.status).toBe(400);

  const review = await post(state.book, "/asset-disposals/prepare", state.input, Disposals.Review);

  const agentApproval = await request(state.book, `/asset-disposals/${review.id}/approve`, {
    method: "POST",
    body: JSON.stringify({ version: 1, digest: review.digest, acknowledgeSyntheticOnly: true }),
  });

  expect(agentApproval.status).toBe(403);

  const other = await fixture();

  const hidden = await request(other, `/asset-disposals/${review.id}`);
  expect(hidden.status).toBe(404);
  expect(JSON.stringify(await hidden.json())).not.toContain(state.book.bookId);

  await retain("asset-disposal-boundaries", {
    malformedStatus: malformed.status,
    approvalStatus: agentApproval.status,
    hiddenStatus: hidden.status,
  });
});

test("a cash-source race commits one complete disposal and generic execution cannot take its plan", async () => {
  const state = await assetFixture();
  const { review, executeInput } = await prepareAndApprove(state);
  const competitor = await prepareAndApprove(state);
  expect(competitor.review.id).not.toBe(review.id);

  const bypass = await request(state.browser, `/change-sets/${review.postingPlan.id}/approvals`, {
    method: "POST",
    body: JSON.stringify({ version: 1, planDigest: review.postingPlan.planDigest }),
  });

  await failure(bypass, 403, "ApprovalRequired");

  const responses = await Promise.all([
    request(state.browser, `/asset-disposals/${review.id}/execute`, {
      method: "POST",
      body: JSON.stringify(executeInput),
    }),
    request(state.browser, `/asset-disposals/${competitor.review.id}/execute`, {
      method: "POST",
      body: JSON.stringify(competitor.executeInput),
    }),
  ]);

  expect(responses.map((response) => response.status).toSorted((a, b) => a - b)).toEqual([
    200, 409,
  ]);
  const success = responses.find((response) => response.status === 200);
  const refused = responses.find((response) => response.status === 409);

  if (!success || !refused)
    throw new Error("The race needs one committed result and one refused duplicate.");
  const effect = await decoded(success, Disposals.DisposalEffect);
  await failure(refused, 409, "AlreadyPosted");
  const admin = await database();

  try {
    const counts = await admin.query<{ effects: number; allocations: number; facts: number }>(
      `select (select count(*)::int from openerp.asset_proceeds_effects where book_id=$1) as effects, (select count(*)::int from openerp.bank_allocation_executions where book_id=$1) as allocations, (select count(*)::int from openerp.vat_fact_components where book_id=$1) as facts`,
      [state.book.bookId],
    );

    expect(counts.rows[0]).toEqual({ effects: 1, allocations: 1, facts: 1 });
    await retain("asset-disposal-race", { effect, counts: counts.rows });
  } finally {
    await admin.end();
  }
});

test("late disposal persistence failure rolls journal, allocation, VAT and retirement back before retry", async () => {
  const state = await assetFixture();
  const { review, executeInput } = await prepareAndApprove(state);
  const before = await persisted(state.book);
  const admin = await database();
  const trigger = `disposal_rollback_${key().replaceAll("-", "")}`;
  const commandKey = key();

  try {
    await admin.query(
      `create function openerp.${trigger}() returns trigger language plpgsql as $$ begin if NEW.book_id='${state.book.bookId}' then raise exception 'synthetic late disposal failure'; end if; return NEW; end $$`,
    );
    await admin.query(
      `create trigger ${trigger} before insert on openerp.asset_proceeds_effects for each row execute function openerp.${trigger}()`,
    );
    await failure(
      await request(state.browser, `/asset-disposals/${review.id}/execute`, {
        method: "POST",
        headers: { "idempotency-key": commandKey },
        body: JSON.stringify(executeInput),
      }),
      500,
      "InternalError",
    );
    expect(await persisted(state.book)).toEqual(before);

    const counts = await admin.query<{ effects: number; allocations: number; facts: number }>(
      `select (select count(*)::int from openerp.asset_proceeds_effects where book_id=$1) as effects, (select count(*)::int from openerp.bank_allocation_executions where book_id=$1) as allocations, (select count(*)::int from openerp.vat_fact_components where book_id=$1) as facts`,
      [state.book.bookId],
    );

    expect(counts.rows[0]).toEqual({ effects: 0, allocations: 0, facts: 0 });
    await admin.query(`drop trigger ${trigger} on openerp.asset_proceeds_effects`);
    await admin.query(`drop function openerp.${trigger}()`);

    const effect = await decoded(
      await request(state.browser, `/asset-disposals/${review.id}/execute`, {
        method: "POST",
        headers: { "idempotency-key": commandKey },
        body: JSON.stringify(executeInput),
      }),
      Disposals.DisposalEffect,
    );

    expect(effect.domainPlan.profitMinor).toBe("150000");
    await retain("asset-disposal-rollback", { before, counts: counts.rows, effect });
  } finally {
    await admin.query(`drop trigger if exists ${trigger} on openerp.asset_proceeds_effects`);
    await admin.query(`drop function if exists openerp.${trigger}()`);
    await admin.end();
  }
});

test("legal invoice proceeds reclassify exact original revenue without another cash, AR or VAT fact", async () => {
  const state = await assetFixture(true);

  if (!state.legal) throw new Error("The invoice case requires retained legal issue authority.");

  const sourcePath = `/asset-disposals/invoice-sources/${state.legal.original.id}`;

  const freeSource = await decoded(
    await request(state.browser, sourcePath),
    Disposals.InvoiceSource,
  );

  expect(freeSource.issue.id).toBe(state.legal.original.id);
  expect(freeSource.issue.lines[0]?.netMinor).toBe("450000");
  expect(freeSource.blocked).toBe(false);
  expect(freeSource.claims).toEqual([]);

  const otherBook = await fixture();
  await failure(await request(otherBook, sourcePath), 404, "NotFound");

  const input = {
    ...state.input,
    proceeds: {
      kind: "existing_legal_invoice" as const,
      issueId: state.legal.original.id,
      lineId: "asset_sale_line",
      acknowledgeRevenueReclassification: true as const,
    },
  };

  const review = await post(state.book, "/asset-disposals/prepare", input, Disposals.Review);
  const directoryPath = `/asset-disposals/for-schedule/${state.input.scheduleId}`;

  const directory = await decoded(
    await request(state.browser, directoryPath),
    Disposals.ReviewPage,
  );

  expect(directory.scheduleId).toBe(state.input.scheduleId);
  expect(directory.items.map((item) => item.id)).toContain(review.id);
  expect(directory.next).toBeNull();
  await failure(await request(otherBook, directoryPath), 404, "NotFound");
  await failure(
    await request(state.browser, `${directoryPath}?after=missing_review`),
    404,
    "NotFound",
  );

  expect(review.domainPlan.profitMinor).toBe("-50000");
  expect(review.domainPlan.newCashReceivableOrVatFacts).toBe(false);
  expect(review.domainPlan.saleTaxFacts).toEqual([]);
  expect(
    review.domainPlan.journal.map(({ accountId, debitMinor, creditMinor }) => ({
      accountId,
      debitMinor,
      creditMinor,
    })),
  ).toEqual([
    { accountId: "account_revenue", debitMinor: "450000", creditMinor: "0" },
    { accountId: "asset_ordinary", debitMinor: "200000", creditMinor: "0" },
    { accountId: "asset_impairment", debitMinor: "300000", creditMinor: "0" },
    { accountId: "asset_gross", debitMinor: "0", creditMinor: "1000000" },
    { accountId: "asset_loss", debitMinor: "50000", creditMinor: "0" },
  ]);

  const approval = await post(
    state.browser,
    `/asset-disposals/${review.id}/approve`,
    { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true },
    Disposals.Approval,
  );

  const effect = await post(
    state.browser,
    `/asset-disposals/${review.id}/execute`,
    { version: 1, digest: review.digest, approvalId: approval.id, acknowledgeSyntheticOnly: true },
    Disposals.DisposalEffect,
  );

  expect(effect.vatFact).toBeNull();
  expect(effect.bankAllocation).toBeNull();

  const claimedSource = await decoded(
    await request(state.browser, sourcePath),
    Disposals.InvoiceSource,
  );

  expect(claimedSource.claims).toEqual([
    {
      lineId: "asset_sale_line",
      effectId: effect.id,
      reviewId: review.id,
      scheduleId: state.input.scheduleId,
      assetName: review.assetBasis.schedule.terms.name,
      series: "A",
      postingReceipt: effect.postingReceipt,
    },
  ]);
  const admin = await database();

  try {
    const rows = await admin.query<{ account_id: string; debit: string; credit: string }>(
      `select account_id,sum(debit_minor)::text as debit,sum(credit_minor)::text as credit from openerp.journal_lines where book_id=$1 and voucher_id=$2 group by account_id order by account_id collate "C"`,
      [state.book.bookId, effect.postingReceipt.voucherId],
    );

    expect(
      rows.rows.some((row) =>
        ["account_ar", "account_bank", "account_vat"].includes(row.account_id),
      ),
    ).toBe(false);

    const revenue = await admin.query<{ net: string }>(
      `select sum(l.credit_minor-l.debit_minor)::text as net from openerp.journal_lines l where l.book_id=$1 and l.account_id='account_revenue'`,
      [state.book.bookId],
    );

    expect(revenue.rows[0]?.net).toBe("0");
    await retain("asset-disposal-invoice", {
      freeSource,
      claimedSource,
      review,
      effect,
      rows: rows.rows,
    });
  } finally {
    await admin.end();
  }
});

test("changed retained source, account or closed period refuses disposal without financial writes", async () => {
  for (const scenario of ["source", "account", "period"] as const) {
    const state = await assetFixture();
    const { review, executeInput } = await prepareAndApprove(state);
    const before = await persisted(state.book);
    const admin = await database();

    try {
      if (scenario === "source")
        await admin.query(
          "update openerp.bank_sources set revision=revision+1 where book_id=$1 and account_id='account_bank'",
          [state.book.bookId],
        );

      if (scenario === "account")
        await admin.query(
          "update openerp.accounts set active=false,version=version+1 where book_id=$1 and id='asset_income'",
          [state.book.bookId],
        );

      if (scenario === "period")
        await admin.query(
          "update openerp.periods set locked=true,version=version+1 where book_id=$1 and id='period_2026'",
          [state.book.bookId],
        );
      await failure(
        await request(state.browser, `/asset-disposals/${review.id}/execute`, {
          method: "POST",
          body: JSON.stringify(executeInput),
        }),
        scenario === "account" ? 422 : 409,
        ({ source: "StaleDependency", account: "InvalidJournal", period: "PeriodLocked" } as const)[
          scenario
        ],
      );
      expect(await persisted(state.book)).toEqual(before);

      const result = await admin.query<{ effects: number; allocations: number; facts: number }>(
        "select (select count(*)::int from openerp.asset_proceeds_effects where book_id=$1) as effects,(select count(*)::int from openerp.bank_allocation_executions where book_id=$1) as allocations,(select count(*)::int from openerp.vat_fact_components where book_id=$1) as facts",
        [state.book.bookId],
      );

      expect(result.rows[0]).toEqual({ effects: 0, allocations: 0, facts: 0 });
      await retain(`asset-disposal-stale-${scenario}`, { review, before, persisted: result.rows });
    } finally {
      await admin.end();
    }
  }
});

test("current disabled actor authority precedes successful disposal replay", async () => {
  const state = await assetFixture();
  const { review, executeInput } = await prepareAndApprove(state);
  const commandKey = key();

  const invoke = () =>
    request(state.browser, `/asset-disposals/${review.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(executeInput),
    });

  const effect = await decoded(await invoke(), Disposals.DisposalEffect);
  const before = await persisted(state.book);
  const admin = await database();

  try {
    await admin.query("update openerp.identity_admissions set enabled=false where actor_id=$1", [
      state.book.actorId,
    ]);
    await failure(await invoke(), 401, "Unauthorized");
    expect(await persisted(state.book)).toEqual(before);
    await retain("asset-disposal-authority-replay", { effect, before });
  } finally {
    await admin.query("update openerp.identity_admissions set enabled=true where actor_id=$1", [
      state.book.actorId,
    ]);
    await admin.end();
  }
});

test("equal invoice principal and unimpaired gross retire an asset with exactly two posted lines", async () => {
  const legal = await legalFixture(
    [
      { id: "asset_gross", code: "1220", name: "Asset gross" },
      { id: "asset_ordinary", code: "1229", name: "Ordinary accumulation" },
      { id: "asset_expense", code: "7830", name: "Depreciation expense" },
      { id: "asset_loss", code: "7730", name: "Disposal loss" },
      { id: "asset_income", code: "3990", name: "Disposal gain" },
    ],
    {
      lines: [
        {
          id: "asset_sale_line",
          description: "Synthetic unimpaired asset",
          quantity: "1",
          unitPriceMinor: "450000",
          baseMinor: "450000",
          discountMinor: "0",
          chargeMinor: "0",
          taxMinor: "112500",
          taxDescription: "se-domestic-standard-25-v1",
          sourceGrossMinor: "562500",
        },
      ],
      sourceTotalMinor: "562500",
    },
  );

  const book = legal.book;
  const browser = { ...book, token: (await createSession(book)).token };
  const source = await evidence(book);

  const openingPlan = await post(
    book,
    "/change-sets",
    {
      ...journal(source.id),
      lines: [
        {
          accountId: "asset_gross",
          debitMinor: "450000",
          creditMinor: "0",
          description: "Retained unimpaired gross",
        },
        {
          accountId: "account_clearing",
          debitMinor: "0",
          creditMinor: "450000",
          description: "Opening funding",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const opening = await execute(book, openingPlan);

  const schedule = await post(
    book,
    "/schedules",
    {
      sourceKey: `minimal_asset_${key().replaceAll("-", "")}`,
      terms: {
        kind: "asset",
        name: "Synthetic unimpaired machine",
        evidenceId: source.id,
        rationale: "Zero ordinary accumulation and zero impairment",
        costMinor: "450000",
        residualMinor: "0",
        usefulPeriods: 1,
        allocationPolicy: "equal_minor_final_remainder_v1",
        debitAccountId: "asset_expense",
        creditAccountId: "asset_ordinary",
        series: "A",
        taxAssessment: "not_applicable",
        periods: [{ postingDate: "2026-12-31", accountingPeriodId: "period_2026" }],
      },
    },
    Subledgers.ScheduleRevision,
  );

  const basis = await post(
    book,
    "/subledger-controls/bases",
    {
      scheduleId: schedule.scheduleId,
      expectedDigest: schedule.digest,
      kind: "imported_opening",
      effectiveOn: "2026-09-22",
      evidenceId: source.id,
      sourceLocator: "minimal-unimpaired-opening",
      reviewEvidenceId: source.id,
      rationale: "Only retained gross establishes carrying",
      originalCostMinor: "450000",
      accumulatedMinor: "0",
      carryingMinor: "450000",
      voucherId: opening.voucherId,
      lineIds:
        openingPlan.groups[0]?.actions[0]?.lines.slice(0, 1).map((line) => line.lineId) ?? [],
    },
    Controls.SubledgerBasis,
  );

  const input: typeof Disposals.PrepareDisposal.Type = {
    kind: "disposal",
    profile: "synthetic_asset_proceeds_v1",
    scheduleId: schedule.scheduleId,
    expectedDigest: schedule.digest,
    expectedBasisDigest: basis.digest,
    postingDate: legal.original.issuedOn,
    accountingPeriodId: "period_2026",
    series: "A",
    gainAccountId: "asset_income",
    lossAccountId: "asset_loss",
    evidenceId: source.id,
    reviewEvidenceId: source.id,
    rationale: "Exact retained invoice principal equals carrying",
    acknowledgeSyntheticOnly: true,
    proceeds: {
      kind: "existing_legal_invoice",
      issueId: legal.original.id,
      lineId: "asset_sale_line",
      acknowledgeRevenueReclassification: true,
    },
  };

  const malformed = await request(book, "/asset-disposals/prepare", {
    method: "POST",
    body: JSON.stringify({ ...input, netMinor: "1" }),
  });

  expect(malformed.status).toBe(400);
  const beforeIssueDate = new Date(`${legal.original.issuedOn}T00:00:00Z`);
  beforeIssueDate.setUTCDate(beforeIssueDate.getUTCDate() - 1);
  const preIssuePostingDate = beforeIssueDate.toISOString().slice(0, 10);
  const before = await persisted(book);

  await failure(
    await request(book, "/asset-disposals/prepare", {
      method: "POST",
      body: JSON.stringify({ ...input, postingDate: preIssuePostingDate }),
    }),
    409,
    "StaleDependency",
  );
  expect(await persisted(book)).toEqual(before);

  const review = await post(book, "/asset-disposals/prepare", input, Disposals.Review);
  expect(review.assetBasis.totalAccumulatedMinor).toBe("0");
  expect(review.assetBasis.impairmentMinor).toBe("0");
  expect(review.proceeds.netMinor).toBe("450000");
  expect(review.proceeds.vatMinor).toBe("112500");
  expect(review.domainPlan.carryingRemovedMinor).toBe("450000");
  expect(review.domainPlan.profitMinor).toBe("0");
  expect(
    review.domainPlan.journal.map(({ accountId, debitMinor, creditMinor }) => ({
      accountId,
      debitMinor,
      creditMinor,
    })),
  ).toEqual([
    { accountId: "account_revenue", debitMinor: "450000", creditMinor: "0" },
    { accountId: "asset_gross", debitMinor: "0", creditMinor: "450000" },
  ]);

  const approval = await post(
    browser,
    `/asset-disposals/${review.id}/approve`,
    { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true },
    Disposals.Approval,
  );

  const effect = await post(
    browser,
    `/asset-disposals/${review.id}/execute`,
    { version: 1, digest: review.digest, approvalId: approval.id, acknowledgeSyntheticOnly: true },
    Disposals.DisposalEffect,
  );

  expect(effect.vatFact).toBeNull();
  expect(effect.bankAllocation).toBeNull();
  expect(effect.carryingMinor).toBe("0");
  expect(effect.futureRecognitionBlocked).toBe(true);
  const admin = await database();

  try {
    const lines = await admin.query<{ accountId: string; debitMinor: string; creditMinor: string }>(
      'select account_id as "accountId", debit_minor::text as "debitMinor", credit_minor::text as "creditMinor" from openerp.journal_lines where book_id=$1 and voucher_id=$2 order by ordinal',
      [book.bookId, effect.postingReceipt.voucherId],
    );

    expect(lines.rows).toEqual([
      { accountId: "account_revenue", debitMinor: "450000", creditMinor: "0" },
      { accountId: "asset_gross", debitMinor: "0", creditMinor: "450000" },
    ]);

    const counts = await admin.query<{ facts: number; allocations: number }>(
      "select (select count(*)::int from openerp.vat_fact_components where book_id=$1) as facts,(select count(*)::int from openerp.bank_allocation_executions where book_id=$1) as allocations",
      [book.bookId],
    );

    expect(counts.rows[0]).toEqual({ facts: 0, allocations: 0 });

    const revenue = await admin.query<{ net: string }>(
      "select sum(credit_minor-debit_minor)::text as net from openerp.journal_lines where book_id=$1 and account_id='account_revenue'",
      [book.bookId],
    );

    expect(revenue.rows[0]?.net).toBe("0");

    const balances = await admin.query<{ vat: string; receivable: string; cash: string }>(
      "select coalesce(sum(credit_minor-debit_minor) filter(where account_id='account_vat'),0)::text as vat,coalesce(sum(debit_minor-credit_minor) filter(where account_id='account_ar'),0)::text as receivable,coalesce(sum(debit_minor-credit_minor) filter(where account_id='account_bank'),0)::text as cash from openerp.journal_lines where book_id=$1",
      [book.bookId],
    );

    expect(balances.rows[0]).toEqual({ vat: "112500", receivable: "562500", cash: "0" });
    await retain("asset-disposal-minimal-invoice", {
      preIssuePostingDate,
      before,
      review,
      effect,
      lines: lines.rows,
      counts: counts.rows,
    });
  } finally {
    await admin.end();
  }
});
