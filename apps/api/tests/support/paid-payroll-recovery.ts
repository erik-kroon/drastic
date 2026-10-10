import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Foundation from "@open-erp/contracts/payroll-foundation";
import * as Calculations from "@open-erp/contracts/payroll-calculations";
import * as Runs from "@open-erp/contracts/payroll-runs";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Onboarding from "@open-erp/contracts/onboarding";
import { createSession, database, fixture, key, post, type BookFixture } from "./fixtures";
import { payrollFixture } from "./payroll-runs";

export async function paidRecoveryFixture(options?: { visualNames: boolean }) {
  const f = await payrollFixture(1, "0", {
    jurisdiction: "QR",
    ...(options?.visualNames ? { employeeName: "Sara Lind", bookName: "Fjällby Konsult AB" } : {}),
    releaseId: "paid_recovery_synthetic_qr_v1",
    contributionRate: { numerator: "3142", denominator: "10000" },
    salaryMinor: "3600000",
    deductionMinor: "0",
    period: { startsOn: "2026-09-01", endsOn: "2026-09-30" },
  });

  const independent = await fixture();
  const approverBase = { ...f.book, actorId: independent.actorId, token: independent.token };
  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.memberships(book_id,actor_id,role) VALUES($1,$2,'operator')",
      [f.book.bookId, approverBase.actorId],
    );
    await admin.query(
      "INSERT INTO openerp.accounts(book_id,id,code,name,active) VALUES($1,'employee_recovery','1610','Synthetic employee recovery',true)",
      [f.book.bookId],
    );
  } finally {
    await admin.end();
  }

  const authorSession = await createSession(f.book, options?.visualNames ? "Elin Sund" : undefined);
  const qualifierSession = await createSession(f.reviewer);
  const approverSession = await createSession(approverBase);
  const book = { ...f.book, token: authorSession.token };
  const qualifier = { ...f.reviewer, token: qualifierSession.token };
  const approver = { ...approverBase, token: approverSession.token };

  for (const actor of [qualifier, approver])
    await post(
      book,
      "/payroll/access",
      { actorId: actor.actorId, allowed: true },
      Foundation.PayrollAccessResult,
    );

  const responsibilities = await post(
    book,
    "/onboarding/responsibilities",
    {
      expectedRevision: 0,
      assignments: {
        preparerId: book.actorId,
        bookkeepingApproverId: approver.actorId,
        paymentApproverId: approver.actorId,
        vatResponsibleId: qualifier.actorId,
        activationConfirmerIds: [book.actorId, approver.actorId],
      },
    },
    Onboarding.OnboardingResponsibilities,
  );

  const run = await post(book, "/payroll/runs", f.input, Runs.PayrollRun);

  const runApproval = await post(
    approver,
    `/payroll/runs/${run.id}/approvals`,
    { runDigest: run.digest },
    Runs.PayrollRunApproval,
  );

  const runExecution = await post(
    book,
    `/payroll/runs/${run.id}/executions`,
    { runDigest: run.digest, approvalId: runApproval.id },
    Runs.PayrollRunExecution,
  );

  const payslip = runExecution.payslips[0];

  if (!payslip) throw new Error("Missing actual original payslip");
  await post(
    book,
    `/payroll/payslips/${payslip.id}/renders`,
    { documentDigest: payslip.digest },
    Runs.PayrollPayslipArtifact,
  );

  async function cash(amountMinor: string, date: string) {
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
      completeness: { declaredComplete: true, basis: "Independent synthetic R43 row" },
      rows: [
        {
          rowOrdinal: 1,
          providerId: key(),
          date,
          description: "Synthetic R43 evidenced cash",
          amountMinor,
        },
      ],
    };

    const evidence = await post(
      book,
      "/evidence",
      {
        title: "Synthetic R43 salary bank source",
        content: JSON.stringify(declaration),
        mediaType: "application/json",
        origin: "DRA-178 synthetic fixture",
      },
      Accounting.Evidence,
    );

    const statement = await post(
      book,
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
      reason: "Independent synthetic R43 cash evidence",
    };
  }

  async function executeReview(input: unknown) {
    const review = await post(
      book,
      "/payroll/settlement-reviews",
      input,
      Settlement.SettlementReview,
    );

    const approval = await post(
      approver,
      `/payroll/settlement-reviews/${review.id}/approvals`,
      { reviewDigest: review.digest },
      Settlement.SettlementApproval,
    );

    const execution = await post(
      book,
      `/payroll/settlement-reviews/${review.id}/executions`,
      { reviewDigest: review.digest, approvalId: approval.id },
      Settlement.SettlementExecution,
    );

    return { review, approval, execution };
  }

  const payment = await executeReview({
    kind: "payment",
    runId: run.id,
    employeeId: f.calculation.employeeId,
    payeeEvidenceId: f.source.id,
    ...(await cash("-2700000", "2026-09-30")),
  });

  const paid = payment.execution.paidEvent;

  if (!paid) throw new Error("Missing actual original paid event");

  const originalPaidId = paid.id;
  const originalPayslipId = payslip.id;

  const employment = await f.reviseEmployment();

  const correctedInput = {
    ...f.calculation.basis.reviewedInput,
    employment: {
      ...f.calculation.basis.reviewedInput.employment,
      effectiveRevision: employment.id,
      monthlyCashSalary: "3540000",
    },
  };

  const comparison = await post(
    book,
    `/payroll/paid-events/${paid.id}/comparisons`,
    correctedInput,
    Settlement.CorrectionComparison,
  );

  async function laterInput(
    month: "2026-10" | "2026-11",
    payableMinor: string,
    adjustmentIds: readonly string[] = [],
  ) {
    const endsOn = `${month}-${month === "2026-10" ? "31" : "30"}`;

    const work = await post(
      book,
      "/payroll/revisions",
      {
        employeeId: f.calculation.employeeId,
        kind: "work",
        effectiveOn: `${month}-01`,
        supersedes: null,
        evidenceId: f.source.id,
        body: {
          periodStart: `${month}-01`,
          periodEnd: endsOn,
          inputs: ["Independent R43 future month"],
        },
      },
      Foundation.PayrollRevision,
    );

    return {
      ...correctedInput,
      adjustmentIds,
      employment: {
        ...correctedInput.employment,
        monthlyCashSalary: (900000n + BigInt(payableMinor)).toString(),
      },
      work: {
        ...correctedInput.work,
        effectiveRevision: work.id,
        earningsPeriod: { startsOn: `${month}-01`, endsOn },
        expectedPaymentOn: endsOn,
      },
    };
  }

  const octoberInput = await laterInput("2026-10", "45000");

  const capacity = await post(
    book,
    "/payroll/calculations",
    octoberInput,
    Calculations.PayrollCalculation,
  );

  async function history() {
    const observer = await database();

    try {
      const bodies = [];

      const identifiers = [
        originalPaidId,
        run.id,
        originalPayslipId,
        runExecution.postingReceipt.voucherId,
        payment.execution.postingReceipt?.voucherId,
      ].filter((id) => id !== undefined);

      for (const table of [
        "payroll_paid_events",
        "payroll_runs",
        "payroll_payslip_documents",
        "payroll_payslip_artifacts",
        "vouchers",
        "journal_lines",
      ])
        bodies.push({
          table,
          rows: (
            await observer.query(
              `SELECT to_jsonb(t) AS body FROM openerp.${observer.escapeIdentifier(table)} t WHERE book_id=$1 AND (to_jsonb(t)->>'id'=ANY($2::text[]) OR to_jsonb(t)->>'voucher_id'=ANY($2::text[]) OR to_jsonb(t)->>'document_id'=ANY($2::text[])) ORDER BY to_jsonb(t)::text COLLATE "C"`,
              [book.bookId, identifiers],
            )
          ).rows,
        });

      return bodies;
    } finally {
      await observer.end();
    }
  }

  return {
    ...f,
    book,
    qualifier,
    approver,
    responsibilities,
    run,
    runExecution,
    paid,
    payment,
    comparison,
    capacity,
    octoberInput,
    laterInput,
    cash,
    executeReview,
    history,
  };
}

export async function paidRecoveryCensus(book: BookFixture) {
  const admin = await database();

  try {
    const rows = [];

    for (const table of [
      "books",
      "vouchers",
      "journal_lines",
      "payroll_paid_events",
      "payroll_recovery_claims",
      "payroll_recovery_allocations",
      "payroll_reporting_corrections",
      "payroll_adjustment_instructions",
    ])
      rows.push({
        table,
        rows: (
          await admin.query(
            `SELECT to_jsonb(t) AS body FROM openerp.${admin.escapeIdentifier(table)} t WHERE ${table === "books" ? "id" : "book_id"}=$1 ORDER BY to_jsonb(t)::text COLLATE "C"`,
            [book.bookId],
          )
        ).rows,
      });

    return rows;
  } finally {
    await admin.end();
  }
}
