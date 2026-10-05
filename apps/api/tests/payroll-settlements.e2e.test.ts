import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Runs from "@open-erp/contracts/payroll-runs";
import * as Calculations from "@open-erp/contracts/payroll-calculations";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Foundation from "@open-erp/contracts/payroll-foundation";
import {
  database,
  decoded,
  environment,
  failure,
  key,
  persisted,
  post,
  request,
} from "./support/fixtures";
import { payrollFixture } from "./support/payroll-runs";

async function paidFixture() {
  const f = await payrollFixture();
  await post(
    f.book,
    "/payroll/access",
    { actorId: f.reviewer.actorId, allowed: true },
    Foundation.PayrollAccessResult,
  );
  const run = await post(f.book, "/payroll/runs", f.input, Runs.PayrollRun);

  const approval = await post(
    f.book,
    `/payroll/runs/${run.id}/approvals`,
    { runDigest: run.digest },
    Runs.PayrollRunApproval,
  );

  const execution = await post(
    f.book,
    `/payroll/runs/${run.id}/executions`,
    { runDigest: run.digest, approvalId: approval.id },
    Runs.PayrollRunExecution,
  );

  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.accounts(book_id,id,code,name,active) values($1,'employee_recovery','1610','Synthetic employee recovery',true)",
      [f.book.bookId],
    );
  } finally {
    await admin.end();
  }

  return { ...f, run, execution };
}

async function cash(
  f: Awaited<ReturnType<typeof paidFixture>>,
  amountMinor: string,
  date = "2026-01-31",
) {
  const declaration = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "synthetic_payroll_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: date,
    endsOn: date,
    openingMinor: "10000000",
    closingMinor: (10000000n + BigInt(amountMinor)).toString(),
    completeness: { declaredComplete: true, basis: "Independent synthetic payroll row" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: key(),
        date,
        description: "Synthetic evidenced employee cash",
        amountMinor,
      },
    ],
  };

  const evidence = await post(
    f.book,
    "/evidence",
    {
      title: "Synthetic employee cash source",
      content: JSON.stringify(declaration),
      mediaType: "application/json",
      origin: "Independent payroll fixture",
    },
    Accounting.Evidence,
  );

  const statement = await post(
    f.book,
    "/bank-statements",
    { ...declaration, evidenceId: evidence.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );

  return {
    statementId: statement.statement.id,
    rowOrdinal: 1,
    bankAccountId: "account_bank",
    evidenceId: evidence.id,
    accountingPeriodId: "period_2026",
    postingDate: date,
    series: "L",
    reason: "Synthetic reviewed employee cash allocation",
  };
}

async function executeReview(
  f: Awaited<ReturnType<typeof paidFixture>>,
  input: typeof Settlement.PrepareSettlement.Type,
) {
  const review = await post(
    f.book,
    "/payroll/settlement-reviews",
    input,
    Settlement.SettlementReview,
  );

  const approval = await post(
    f.reviewer,
    `/payroll/settlement-reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Settlement.SettlementApproval,
  );

  const execution = await post(
    f.book,
    `/payroll/settlement-reviews/${review.id}/executions`,
    { reviewDigest: review.digest, approvalId: approval.id },
    Settlement.SettlementExecution,
  );

  return { review, approval, execution };
}

async function pay(f: Awaited<ReturnType<typeof paidFixture>>) {
  return executeReview(f, {
    kind: "payment",
    runId: f.run.id,
    employeeId: f.calculation.employeeId,
    payeeEvidenceId: f.source.id,
    ...(await cash(f, "-2090000")),
  });
}

async function comparison(
  f: Awaited<ReturnType<typeof paidFixture>>,
  paidEventId: string,
  monthlyCashSalary: string,
) {
  const employment = await f.reviseEmployment();

  return post(
    f.book,
    `/payroll/paid-events/${paidEventId}/comparisons`,
    {
      ...f.calculation.basis.reviewedInput,
      employment: {
        ...f.calculation.basis.reviewedInput.employment,
        effectiveRevision: employment.id,
        monthlyCashSalary,
      },
    },
    Settlement.CorrectionComparison,
  );
}

async function claim(
  f: Awaited<ReturnType<typeof paidFixture>>,
  beforeRecovery?: () => Promise<void>,
) {
  const payment = await pay(f);
  const paid = payment.execution.paidEvent;

  if (!paid) throw new Error("Missing paid event");

  if (beforeRecovery) await beforeRecovery();
  const compared = await comparison(f, paid.id, "2980000");

  const lawful = await post(
    f.reviewer,
    "/payroll/adjustment-bases",
    {
      comparisonId: compared.id,
      kind: "gross_recovery",
      evidenceId: f.source.id,
      reason: "Independently reviewed synthetic gross claim right",
    },
    Settlement.AdjustmentBasis,
  );

  const recovery = await executeReview(f, {
    kind: "gross_recovery",
    comparisonId: compared.id,
    lawfulBasisId: lawful.id,
    recoveryReceivableAccountId: "employee_recovery",
    futureMonth: null,
    evidenceId: f.source.id,
    accountingPeriodId: "period_2026",
    postingDate: "2026-02-05",
    series: "L",
    reason: "Synthetic correction in an open adjustment period",
  });

  return { payment, paid, compared, lawful, recovery };
}

test("full salary settlement derives2090000 and paid period while replay cannot pay twice", async () => {
  const f = await paidFixture();
  const before = await persisted(f.book);
  const source = await cash(f, "-2090000");

  const review = await post(
    f.book,
    "/payroll/settlement-reviews",
    {
      kind: "payment",
      runId: f.run.id,
      employeeId: f.calculation.employeeId,
      payeeEvidenceId: f.source.id,
      ...source,
    },
    Settlement.SettlementReview,
  );

  expect(await persisted(f.book)).toEqual(before);

  const approval = await post(
    f.reviewer,
    `/payroll/settlement-reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Settlement.SettlementApproval,
  );

  const executionKey = key();

  const execute = () =>
    request(f.book, `/payroll/settlement-reviews/${review.id}/executions`, {
      method: "POST",
      headers: { "idempotency-key": executionKey },
      body: JSON.stringify({ reviewDigest: review.digest, approvalId: approval.id }),
    });

  const [first, second] = await Promise.all([execute(), execute()]);
  const execution = await decoded(first, Settlement.SettlementExecution);
  expect(await decoded(second, Settlement.SettlementExecution)).toEqual(execution);
  expect(execution.paidEvent?.paidMinor).toBe("2090000");
  expect(execution.paidEvent?.reportingPeriod).toBe("2026-01");
  expect(execution.paidEvent?.withholdingMinor).toBe("900000");
  await failure(
    await request(f.book, "/payroll/settlement-reviews", {
      method: "POST",
      body: JSON.stringify(review.input),
    }),
    409,
    "AlreadyPosted",
  );

  const period = await post(
    f.book,
    "/payroll/periods",
    { reportingPeriod: "2026-01", evidenceId: f.source.id },
    Settlement.PayrollPeriod,
  );

  expect(period.totals).toEqual({
    grossMinor: "3000000",
    withholdingMinor: "900000",
    contributionBaseMinor: "3000000",
  });
  await writeFile(
    join(environment().artifacts, "payroll-payment-proof.json"),
    JSON.stringify({ review, approval, execution, period }, null, 2),
  );
});

test("gross recovery20000 and incoming cash5000 leave15000 without changing original withholding or cash", async () => {
  const f = await paidFixture();
  const result = await claim(f);
  expect(result.compared.kind).toBe("paid_correction_comparison");
  expect(result.compared.grossDeltaMinor).toBe("-20000");
  expect(result.recovery.execution.recoveryClaim?.claimedGrossMinor).toBe("20000");
  const claimId = result.recovery.execution.recoveryClaim?.id;

  if (!claimId) throw new Error("Missing employee claim");

  const receipt = await executeReview(f, {
    kind: "cash_recovery",
    claimId,
    ...(await cash(f, "5000", "2026-02-10")),
  });

  expect(receipt.execution.remainingReceivableMinor).toBe("15000");

  const period = await post(
    f.book,
    "/payroll/periods",
    { reportingPeriod: "2026-01", evidenceId: f.source.id },
    Settlement.PayrollPeriod,
  );

  expect(period.totals).toEqual({
    grossMinor: "2980000",
    withholdingMinor: "900000",
    contributionBaseMinor: "2980000",
  });
  expect(period.items[0]?.specificationNumber).toBe(result.paid.specificationNumber);
  const admin = await database();
  let balances;

  try {
    balances = (
      await admin.query(
        "select account_id,sum(debit_minor::numeric-credit_minor::numeric)::text balance from openerp.journal_lines where book_id=$1 and account_id in ('employee_recovery','salary_expense','salary_liability','withholding_liability','account_bank') group by account_id order by account_id",
        [f.book.bookId],
      )
    ).rows;
  } finally {
    await admin.end();
  }

  expect(balances).toEqual([
    { account_id: "account_bank", balance: "-2085000" },
    { account_id: "employee_recovery", balance: "15000" },
    { account_id: "salary_expense", balance: "2980000" },
    { account_id: "salary_liability", balance: "0" },
    { account_id: "withholding_liability", balance: "-900000" },
  ]);
  await failure(
    await request(f.book, "/payroll/settlement-reviews", {
      method: "POST",
      body: JSON.stringify(result.recovery.review.input),
    }),
    409,
    "AlreadyPosted",
  );
  await failure(
    await request(f.book, "/payroll/runs", {
      method: "POST",
      body: JSON.stringify({ ...f.input, calculationIds: [result.compared.id] }),
    }),
    404,
    "NotFound",
  );
  await writeFile(
    join(environment().artifacts, "payroll-paid-recovery-proof.json"),
    JSON.stringify({ ...result, receipt, period, balances }, null, 2),
  );
});

test("partial salary bank row refuses without creating a paid or reporting event", async () => {
  const f = await paidFixture();
  const source = await cash(f, "-5000");
  const before = await persisted(f.book);
  await failure(
    await request(f.book, "/payroll/settlement-reviews", {
      method: "POST",
      body: JSON.stringify({
        kind: "payment",
        runId: f.run.id,
        employeeId: f.calculation.employeeId,
        payeeEvidenceId: f.source.id,
        ...source,
      }),
    }),
    422,
    "UnsupportedProfile",
  );
  expect(await persisted(f.book)).toEqual(before);
  await failure(
    await request(f.book, "/payroll/periods", {
      method: "POST",
      body: JSON.stringify({ reportingPeriod: "2026-01", evidenceId: f.source.id }),
    }),
    422,
    "UnsupportedProfile",
  );
  await writeFile(
    join(environment().artifacts, "payroll-paid-refusal-proof.json"),
    JSON.stringify({ before, after: await persisted(f.book) }, null, 2),
  );
});

test.each([
  {
    kind: "future_pay",
    corrected: "2994000",
    gross: "2994000",
    payable: "2084000",
    contribution: "299400",
  },
  {
    kind: "additional_compensation",
    corrected: "3007500",
    gross: "3007500",
    payable: "2097500",
    contribution: "300750",
  },
] as const)("$kind instructions join a later real regular run once", async (vector) => {
  const f = await paidFixture();
  const payment = await pay(f);
  const paid = payment.execution.paidEvent;

  if (!paid) throw new Error("Missing paid event");
  const compared = await comparison(f, paid.id, vector.corrected);

  const lawful =
    vector.kind === "future_pay"
      ? await post(
          f.reviewer,
          "/payroll/adjustment-bases",
          {
            comparisonId: compared.id,
            kind: vector.kind,
            evidenceId: f.source.id,
            reason: "Independently reviewed synthetic offset right",
          },
          Settlement.AdjustmentBasis,
        )
      : null;

  const before = await persisted(f.book);

  const adjustmentInput = {
    comparisonId: compared.id,
    recoveryReceivableAccountId: null,
    futureMonth: "2026-02",
    evidenceId: f.source.id,
    accountingPeriodId: "period_2026",
    postingDate: "2026-02-01",
    series: "L",
    reason: "Synthetic future earning instruction",
  } satisfies Omit<
    Extract<
      typeof Settlement.PrepareSettlement.Type,
      { kind: "future_pay" | "additional_compensation" }
    >,
    "kind" | "lawfulBasisId"
  >;

  if (vector.kind === "future_pay" && !lawful) throw new Error("Missing offset basis");

  const instruction = await executeReview(
    f,
    vector.kind === "future_pay" && lawful
      ? { ...adjustmentInput, kind: "future_pay", lawfulBasisId: lawful.id }
      : { ...adjustmentInput, kind: "additional_compensation", lawfulBasisId: null },
  );

  expect(await persisted(f.book)).toEqual(before);
  const retained = instruction.execution.instruction;

  if (!retained) throw new Error("Missing future instruction");

  const work = await post(
    f.book,
    "/payroll/revisions",
    {
      employeeId: paid.employeeId,
      kind: "work",
      effectiveOn: "2026-02-01",
      supersedes: null,
      evidenceId: f.source.id,
      body: {
        periodStart: "2026-02-01",
        periodEnd: "2026-02-28",
        inputs: ["Synthetic February full month"],
      },
    },
    Foundation.PayrollRevision,
  );

  await post(
    f.book,
    "/payroll/revisions",
    {
      employeeId: paid.employeeId,
      kind: "opening",
      effectiveOn: "2026-02-01",
      supersedes: null,
      evidenceId: f.source.id,
      body: { asOf: "2026-02-01", balanceMinor: "0", obligation: "synthetic_contribution" },
    },
    Foundation.PayrollRevision,
  );

  const input = {
    ...f.calculation.basis.reviewedInput,
    adjustmentIds: [retained.id],
    employment: {
      ...f.calculation.basis.reviewedInput.employment,
      effectiveRevision: compared.basis.employmentRevisionId,
    },
    work: {
      ...f.calculation.basis.reviewedInput.work,
      effectiveRevision: work.id,
      earningsPeriod: { startsOn: "2026-02-01", endsOn: "2026-02-28" },
      expectedPaymentOn: "2026-02-28",
    },
  };

  const calculation = await post(
    f.book,
    "/payroll/calculations",
    input,
    Calculations.PayrollCalculation,
  );

  expect(calculation.calculation.grossMinor).toBe(vector.gross);
  expect(calculation.calculation.payableMinor).toBe(vector.payable);
  expect(calculation.calculation.employerContributionMinor).toBe(vector.contribution);

  const run = await post(
    f.book,
    "/payroll/runs",
    { ...f.input, calculationIds: [calculation.id], postingDate: "2026-02-28" },
    Runs.PayrollRun,
  );

  const approval = await post(
    f.reviewer,
    `/payroll/runs/${run.id}/approvals`,
    { runDigest: run.digest },
    Runs.PayrollRunApproval,
  );

  const executed = await post(
    f.book,
    `/payroll/runs/${run.id}/executions`,
    { runDigest: run.digest, approvalId: approval.id },
    Runs.PayrollRunExecution,
  );

  expect(executed.employeeObligations[0]?.payableMinor).toBe(vector.payable);
  const admin = await database();

  try {
    const count = await admin.query(
      "select count(*)::int count from openerp.payroll_adjustment_consumptions where book_id=$1 and instruction_id=$2",
      [f.book.bookId, retained.id],
    );

    expect(count.rows).toEqual([{ count: 1 }]);
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, `payroll-${vector.kind}-proof.json`),
    JSON.stringify({ payment, compared, instruction, calculation, run, executed }, null, 2),
  );
});

test("January earnings paid in February retain January sources and enter only the February paid population", async () => {
  const f = await paidFixture();

  const payment = await executeReview(f, {
    kind: "payment",
    runId: f.run.id,
    employeeId: f.calculation.employeeId,
    payeeEvidenceId: f.source.id,
    ...(await cash(f, "-2090000", "2026-02-28")),
  });

  expect(payment.execution.paidEvent?.reportingPeriod).toBe("2026-02");
  expect(payment.execution.paidEvent?.originalEmployee.calculation.basis.earningsPeriod).toEqual({
    startsOn: "2026-01-01",
    endsOn: "2026-01-31",
  });
  await failure(
    await request(f.book, "/payroll/periods", {
      method: "POST",
      body: JSON.stringify({ reportingPeriod: "2026-01", evidenceId: f.source.id }),
    }),
    422,
    "UnsupportedProfile",
  );

  const period = await post(
    f.book,
    "/payroll/periods",
    {
      reportingPeriod: "2026-02",
      evidenceId: f.source.id,
    },
    Settlement.PayrollPeriod,
  );

  expect(period.totals).toEqual({
    grossMinor: "3000000",
    withholdingMinor: "900000",
    contributionBaseMinor: "3000000",
  });
  expect(period.reconciliation).toEqual({
    postedAccrualsMinor: "3000000",
    unpaidMinor: "0",
    otherPeriodMinor: "0",
    adjustmentMinor: "0",
  });
  await writeFile(
    join(environment().artifacts, "payroll-actual-paid-period-proof.json"),
    JSON.stringify({ payment, period }, null, 2),
  );
});

test("reporting-only replaces a retained stale item after ledger recovery and posts no second salary or cash effect", async () => {
  const f = await paidFixture();
  let prior: typeof Settlement.PayrollPeriod.Type | undefined;

  const result = await claim(f, async () => {
    prior = await post(
      f.book,
      "/payroll/periods",
      { reportingPeriod: "2026-01", evidenceId: f.source.id },
      Settlement.PayrollPeriod,
    );
  });

  expect(prior?.totals.grossMinor).toBe("3000000");
  const before = await persisted(f.book);

  const reporting = await executeReview(f, {
    kind: "reporting_only",
    comparisonId: result.compared.id,
    lawfulBasisId: null,
    recoveryReceivableAccountId: null,
    futureMonth: null,
    evidenceId: f.source.id,
    accountingPeriodId: "period_2026",
    postingDate: "2026-02-05",
    series: "L",
    reason: "Replace the retained stale synthetic item using the actual recovered ledger",
  });

  expect(reporting.execution.postingReceipt).toBeNull();
  expect(await persisted(f.book)).toEqual(before);

  const revised = await post(
    f.book,
    "/payroll/periods",
    { reportingPeriod: "2026-01", evidenceId: f.source.id },
    Settlement.PayrollPeriod,
  );

  expect(revised.totals).toEqual({
    grossMinor: "2980000",
    withholdingMinor: "900000",
    contributionBaseMinor: "2980000",
  });
  expect(revised.items[0]?.specificationNumber).toBe(prior?.items[0]?.specificationNumber);
  await writeFile(
    join(environment().artifacts, "payroll-reporting-only-proof.json"),
    JSON.stringify(
      { prior, result, reporting, revised, before, after: await persisted(f.book) },
      null,
      2,
    ),
  );
});

test("competing salary approvals reserve one obligation and reject caller amounts and generic execution bypass", async () => {
  const f = await paidFixture();
  const source = await cash(f, "-2090000");

  const input = {
    kind: "payment",
    runId: f.run.id,
    employeeId: f.calculation.employeeId,
    payeeEvidenceId: f.source.id,
    ...source,
  };

  const before = await persisted(f.book);

  const malformed = await request(f.book, "/payroll/settlement-reviews", {
    method: "POST",
    body: JSON.stringify({ ...input, amountMinor: "1" }),
  });

  expect(malformed.status).toBe(400);
  expect(await persisted(f.book)).toEqual(before);

  const reviews = await Promise.all([
    post(f.book, "/payroll/settlement-reviews", input, Settlement.SettlementReview),
    post(f.book, "/payroll/settlement-reviews", input, Settlement.SettlementReview),
  ]);

  const responses = await Promise.all(
    reviews.map((review) =>
      request(f.reviewer, `/payroll/settlement-reviews/${review.id}/approvals`, {
        method: "POST",
        body: JSON.stringify({ reviewDigest: review.digest }),
      }),
    ),
  );

  expect(responses.map((response) => response.status).sort((left, right) => left - right)).toEqual([
    200, 409,
  ]);
  const winner = responses.findIndex((response) => response.status === 200);
  const review = reviews[winner];
  const response = responses[winner];

  if (!review?.postingPlan || !response) throw new Error("Missing approved salary plan");
  const approval = await decoded(response, Settlement.SettlementApproval);
  await failure(
    await request(f.book, `/change-sets/${review.postingPlan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        planDigest: review.postingPlan.planDigest,
        approvalId: approval.kernelApprovalId,
      }),
    }),
    403,
    "ApprovalRequired",
  );

  const executed = await post(
    f.book,
    `/payroll/settlement-reviews/${review.id}/executions`,
    { reviewDigest: review.digest, approvalId: approval.id },
    Settlement.SettlementExecution,
  );

  expect(executed.paidEvent?.paidMinor).toBe("2090000");
  await writeFile(
    join(environment().artifacts, "payroll-settlement-capacity-proof.json"),
    JSON.stringify({ reviews, approval, executed, malformedStatus: malformed.status }, null, 2),
  );
});

test("a paid-child failure rolls back voucher, bank match, capacity and approval consumption before the exact-key retry", async () => {
  const f = await paidFixture();

  const review = await post(
    f.book,
    "/payroll/settlement-reviews",
    {
      kind: "payment",
      runId: f.run.id,
      employeeId: f.calculation.employeeId,
      payeeEvidenceId: f.source.id,
      ...(await cash(f, "-2090000")),
    },
    Settlement.SettlementReview,
  );

  const approval = await post(
    f.reviewer,
    `/payroll/settlement-reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Settlement.SettlementApproval,
  );

  const before = await persisted(f.book);
  const executionKey = key();

  const execute = () =>
    request(f.book, `/payroll/settlement-reviews/${review.id}/executions`, {
      method: "POST",
      headers: { "idempotency-key": executionKey },
      body: JSON.stringify({ reviewDigest: review.digest, approvalId: approval.id }),
    });

  const admin = await database();

  try {
    await admin.query(
      `CREATE FUNCTION openerp.synthetic_paid_child_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.book_id='${f.book.bookId}' THEN RAISE EXCEPTION 'synthetic paid child fault' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`,
    );
    await admin.query(
      "CREATE TRIGGER synthetic_paid_child_failure BEFORE INSERT ON openerp.payroll_paid_events FOR EACH ROW EXECUTE FUNCTION openerp.synthetic_paid_child_failure()",
    );
    await failure(await execute(), 500, "InternalError");
    expect(await persisted(f.book)).toEqual(before);

    const rows = (
      await admin.query(
        "select (select count(*)::int from openerp.bank_matches where book_id=$1) matches,(select count(*)::int from openerp.payroll_paid_events where book_id=$1) paid,(select count(*)::int from openerp.payroll_settlement_executions where book_id=$1) executions",
        [f.book.bookId],
      )
    ).rows;

    expect(rows).toEqual([{ matches: 0, paid: 0, executions: 0 }]);
  } finally {
    await admin.query(
      "DROP TRIGGER IF EXISTS synthetic_paid_child_failure ON openerp.payroll_paid_events",
    );
    await admin.query("DROP FUNCTION IF EXISTS openerp.synthetic_paid_child_failure()");
    await admin.end();
  }

  const execution = await decoded(await execute(), Settlement.SettlementExecution);
  expect(execution.paidEvent?.paidMinor).toBe("2090000");
  await writeFile(
    join(environment().artifacts, "payroll-settlement-rollback-proof.json"),
    JSON.stringify(
      { review, approval, before, execution, after: await persisted(f.book) },
      null,
      2,
    ),
  );
});

test("kernel approval expiry frees salary capacity and current private access fences stored reads and exact replays", async () => {
  const f = await paidFixture();

  const input = {
    kind: "payment",
    runId: f.run.id,
    employeeId: f.calculation.employeeId,
    payeeEvidenceId: f.source.id,
    ...(await cash(f, "-2090000")),
  };

  const review = await post(
    f.book,
    "/payroll/settlement-reviews",
    input,
    Settlement.SettlementReview,
  );

  const approval = await post(
    f.reviewer,
    `/payroll/settlement-reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Settlement.SettlementApproval,
  );

  if (!approval.kernelApprovalId) throw new Error("Missing salary kernel approval");
  const admin = await database();

  try {
    await admin.query("BEGIN");
    await admin.query("ALTER TABLE openerp.approvals DISABLE TRIGGER posting_approval_consumption");
    await admin.query(
      "UPDATE openerp.approvals SET expires_at=clock_timestamp()-interval '1 second' WHERE book_id=$1 AND id=$2",
      [f.book.bookId, approval.kernelApprovalId],
    );
    await admin.query("ALTER TABLE openerp.approvals ENABLE TRIGGER posting_approval_consumption");
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  } finally {
    await admin.end();
  }

  const before = await persisted(f.book);
  await failure(
    await request(f.book, `/payroll/settlement-reviews/${review.id}/executions`, {
      method: "POST",
      body: JSON.stringify({ reviewDigest: review.digest, approvalId: approval.id }),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await persisted(f.book)).toEqual(before);

  const replacement = await post(
    f.book,
    "/payroll/settlement-reviews",
    input,
    Settlement.SettlementReview,
  );

  const replacementApproval = await post(
    f.reviewer,
    `/payroll/settlement-reviews/${replacement.id}/approvals`,
    { reviewDigest: replacement.digest },
    Settlement.SettlementApproval,
  );

  const executionKey = key();

  const execute = () =>
    request(f.book, `/payroll/settlement-reviews/${replacement.id}/executions`, {
      method: "POST",
      headers: { "idempotency-key": executionKey },
      body: JSON.stringify({
        reviewDigest: replacement.digest,
        approvalId: replacementApproval.id,
      }),
    });

  const execution = await decoded(await execute(), Settlement.SettlementExecution);
  const revoke = await database();

  try {
    await revoke.query("delete from openerp.payroll_access where book_id=$1 and actor_id=$2", [
      f.book.bookId,
      f.book.actorId,
    ]);
  } finally {
    await revoke.end();
  }

  await failure(await execute(), 403, "Forbidden");
  await failure(
    await request(f.book, `/payroll/settlement-reviews/${replacement.id}`),
    403,
    "Forbidden",
  );
  await writeFile(
    join(environment().artifacts, "payroll-settlement-expiry-access-proof.json"),
    JSON.stringify({ approval, replacementApproval, execution, before }, null, 2),
  );
});

test.each(["source", "period"] as const)(
  "retained recovery approval refuses changed %s with zero additional financial effects",
  async (vector) => {
    const f = await paidFixture();
    const payment = await pay(f);
    const paid = payment.execution.paidEvent;

    if (!paid) throw new Error("Missing paid event");
    const compared = await comparison(f, paid.id, "2980000");

    const lawful = await post(
      f.reviewer,
      "/payroll/adjustment-bases",
      {
        comparisonId: compared.id,
        kind: "gross_recovery",
        evidenceId: f.source.id,
        reason: "Independent synthetic claim facts",
      },
      Settlement.AdjustmentBasis,
    );

    const review = await post(
      f.book,
      "/payroll/settlement-reviews",
      {
        kind: "gross_recovery",
        comparisonId: compared.id,
        lawfulBasisId: lawful.id,
        recoveryReceivableAccountId: "employee_recovery",
        futureMonth: null,
        evidenceId: f.source.id,
        accountingPeriodId: "period_2026",
        postingDate: "2026-02-05",
        series: "L",
        reason: "Synthetic recovery stale refusal",
      },
      Settlement.SettlementReview,
    );

    const approval = await post(
      f.reviewer,
      `/payroll/settlement-reviews/${review.id}/approvals`,
      { reviewDigest: review.digest },
      Settlement.SettlementApproval,
    );

    if (vector === "source")
      await post(
        f.book,
        "/payroll/revisions",
        {
          employeeId: paid.employeeId,
          kind: "employment",
          effectiveOn: "2026-01-01",
          evidenceId: f.source.id,
          supersedes: compared.basis.employmentRevisionId,
          body: {
            personRef: "SYNTHETIC PERSON CHANGED AGAIN",
            jurisdiction: "QZ",
            residency: "Synthetic",
            payTerms: "Synthetic monthly salary",
            workSchedule: "Synthetic monthly",
            taxFacts: "Synthetic fixed withholding",
          },
        },
        Foundation.PayrollRevision,
      );
    else {
      const admin = await database();

      try {
        await admin.query("update openerp.periods set locked=true where book_id=$1", [
          f.book.bookId,
        ]);
      } finally {
        await admin.end();
      }
    }

    const before = await persisted(f.book);
    await failure(
      await request(f.book, `/payroll/settlement-reviews/${review.id}/executions`, {
        method: "POST",
        body: JSON.stringify({ reviewDigest: review.digest, approvalId: approval.id }),
      }),
      409,
      vector === "source" ? "StaleDependency" : "PeriodLocked",
    );
    expect(await persisted(f.book)).toEqual(before);
    await writeFile(
      join(environment().artifacts, `payroll-recovery-${vector}-refusal-proof.json`),
      JSON.stringify({ review, approval, before, after: await persisted(f.book) }, null, 2),
    );
  },
);

test("reporting-only compares the latest complete monthly item across two paid runs", async () => {
  const f = await paidFixture();

  const payment = await executeReview(f, {
    kind: "payment",
    runId: f.run.id,
    employeeId: f.calculation.employeeId,
    payeeEvidenceId: f.source.id,
    ...(await cash(f, "-2090000", "2026-02-27")),
  });

  const paid = payment.execution.paidEvent;

  if (!paid) throw new Error("Missing first paid event");

  const prior = await post(
    f.book,
    "/payroll/periods",
    { reportingPeriod: "2026-02", evidenceId: f.source.id },
    Settlement.PayrollPeriod,
  );

  const work = await post(
    f.book,
    "/payroll/revisions",
    {
      employeeId: paid.employeeId,
      kind: "work",
      effectiveOn: "2026-02-01",
      supersedes: null,
      evidenceId: f.source.id,
      body: {
        periodStart: "2026-02-01",
        periodEnd: "2026-02-28",
        inputs: ["Independent February salary facts"],
      },
    },
    Foundation.PayrollRevision,
  );

  await post(
    f.book,
    "/payroll/revisions",
    {
      employeeId: paid.employeeId,
      kind: "opening",
      effectiveOn: "2026-02-01",
      supersedes: null,
      evidenceId: f.source.id,
      body: { asOf: "2026-02-01", balanceMinor: "0", obligation: "synthetic_contribution" },
    },
    Foundation.PayrollRevision,
  );

  const calculation = await post(
    f.book,
    "/payroll/calculations",
    {
      ...f.calculation.basis.reviewedInput,
      work: {
        ...f.calculation.basis.reviewedInput.work,
        effectiveRevision: work.id,
        earningsPeriod: { startsOn: "2026-02-01", endsOn: "2026-02-28" },
        expectedPaymentOn: "2026-02-28",
      },
    },
    Calculations.PayrollCalculation,
  );

  const run = await post(
    f.book,
    "/payroll/runs",
    { ...f.input, calculationIds: [calculation.id], postingDate: "2026-02-28" },
    Runs.PayrollRun,
  );

  const approval = await post(
    f.book,
    `/payroll/runs/${run.id}/approvals`,
    { runDigest: run.digest },
    Runs.PayrollRunApproval,
  );

  await post(
    f.book,
    `/payroll/runs/${run.id}/executions`,
    { runDigest: run.digest, approvalId: approval.id },
    Runs.PayrollRunExecution,
  );

  const secondPayment = await executeReview(f, {
    kind: "payment",
    runId: run.id,
    employeeId: paid.employeeId,
    payeeEvidenceId: f.source.id,
    ...(await cash(f, "-2090000", "2026-02-28")),
  });

  expect(secondPayment.execution.paidEvent?.specificationNumber).toBe(paid.specificationNumber);
  const compared = await comparison(f, paid.id, "3000000");

  const input = {
    kind: "reporting_only",
    comparisonId: compared.id,
    lawfulBasisId: null,
    recoveryReceivableAccountId: null,
    futureMonth: null,
    evidenceId: f.source.id,
    accountingPeriodId: "period_2026",
    postingDate: "2026-03-01",
    series: "L",
    reason: "Compare the complete current monthly item with its latest retained revision",
  } satisfies typeof Settlement.PrepareSettlement.Type;

  const before = await persisted(f.book);
  const correction = await executeReview(f, input);
  expect(correction.review.reportingReplacement).toEqual({
    employerId: f.book.entityId,
    reportingPeriod: "2026-02",
    payeeId: paid.employeeId,
    specificationNumber: paid.specificationNumber,
    grossCashMinor: "6000000",
    withholdingMinor: "1800000",
    contributionBaseMinor: "6000000",
  });
  expect(correction.execution.postingReceipt).toBeNull();
  expect(await persisted(f.book)).toEqual(before);

  const current = await post(
    f.book,
    "/payroll/periods",
    { reportingPeriod: "2026-02", evidenceId: f.source.id },
    Settlement.PayrollPeriod,
  );

  expect(current.items).toHaveLength(1);
  expect(current.totals).toEqual({
    grossMinor: "6000000",
    withholdingMinor: "1800000",
    contributionBaseMinor: "6000000",
  });

  const currentComparison = await post(
    f.book,
    `/payroll/paid-events/${paid.id}/comparisons`,
    compared.input,
    Settlement.CorrectionComparison,
  );

  await failure(
    await request(f.book, "/payroll/settlement-reviews", {
      method: "POST",
      body: JSON.stringify({ ...input, comparisonId: currentComparison.id }),
    }),
    422,
    "UnsupportedProfile",
  );
  expect(await persisted(f.book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "payroll-monthly-item-population-proof.json"),
    JSON.stringify(
      {
        payment,
        secondPayment,
        prior,
        correction,
        current,
        currentComparison,
        before,
        after: await persisted(f.book),
      },
      null,
      2,
    ),
  );
});
