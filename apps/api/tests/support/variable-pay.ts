import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileObjectStore } from "../../scripts/file-object-store";
import { createHash } from "node:crypto";
import * as V from "@open-erp/contracts/variable-pay-review";
import * as Inputs from "@open-erp/contracts/payroll-inputs";
import * as Source from "@open-erp/contracts/source-intake";
import * as Calculations from "@open-erp/contracts/payroll-calculations";
import * as Runs from "@open-erp/contracts/payroll-runs";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Foundation from "@open-erp/contracts/payroll-foundation";
import * as A from "@open-erp/contracts/accounting";
import { createSession, database, environment, key, post } from "./fixtures";
import { payrollFixture } from "./payroll-runs";

export async function variablePayFixture() {
  const f = await payrollFixture();
  const session = await createSession(f.book);
  const book = { ...f.book, token: session.token };
  const admin = await database();

  try {
    await admin.query('update openerp_auth."user" set name=$2 where id=$1', [
      book.actorId,
      "Sara Lind",
    ]);

    for (const [id, code] of [
      ["holiday_expense", "7090"],
      ["holiday_liability", "2920"],
      ["holiday_social", "2940"],
      ["holiday_social_expense", "7519"],
    ])
      await admin.query(
        "insert into openerp.accounts(book_id,id,code,name,active) values($1,$2,$3,$2,true)",
        [book.bookId, id, code],
      );
  } finally {
    await admin.end();
  }

  const opening = await post(
    book,
    "/change-sets",
    {
      kind: "manual_journal",
      evidenceId: f.source.id,
      eventKey: key(),
      accountingPeriodId: "period_2026",
      postingDate: "2026-01-01",
      series: "L",
      description: "Synthetic holiday opening",
      rationale: "Independent holiday ledger940000",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "holiday_expense",
          debitMinor: "940000",
          creditMinor: "0",
          description: "Synthetic holiday opening",
        },
        {
          accountId: "holiday_liability",
          debitMinor: "0",
          creditMinor: "940000",
          description: "Synthetic holiday liability",
        },
      ],
    },
    A.ChangeSet,
  );

  const approved = await post(
    book,
    `/change-sets/${opening.id}/approvals`,
    { version: 1, planDigest: opening.planDigest },
    A.Approval,
  );

  await post(
    book,
    `/change-sets/${opening.id}/execute`,
    { version: 1, planDigest: opening.planDigest, approvalId: approved.id },
    A.ExecutionReceipt,
  );
  const rows: Array<(typeof V.VariablePaySourceProfile.Type.rows)[number]> = [];

  for (const [date, start, end, minutes, kind] of [
    ["01", "08:00", "16:00", "480", "worked"],
    ["02", "08:00", "16:00", "480", "worked"],
    ["03", "08:00", "16:00", "480", "worked"],
    ["04", "08:00", "16:00", "480", "worked"],
    ["05", "08:00", "13:30", "330", "worked"],
    ["08", "08:00", "16:00", "480", "sick"],
    ["09", "08:00", "16:00", "480", "sick"],
  ] as const) {
    const scheduleDate = `2026-01-${date}`;
    rows.push({
      rowIdentity: `row_${date}`,
      sourceId: `time_${date}`,
      economicOccurrence: JSON.stringify([
        f.calculation.employeeId,
        scheduleDate,
        kind,
        start,
        end,
        "0",
      ]),
      kind,
      scheduleDate,
      startLocal: start,
      endLocal: end,
      breakMinutes: "0",
      unitsMinor: minutes,
      rateMinor: "20000",
      priorRunRow: null,
    });
  }

  const profile: typeof V.VariablePaySourceProfile.Type = {
    profile: "synthetic-variable-timesheet-v1",
    employeeId: f.calculation.employeeId,
    month: "2026-01",
    paymentOn: "2026-02-25",
    sourceSystem: "synthetic-variable-test",
    sourceAccountId: f.calculation.employeeId,
    occurrenceKey: key(),
    rows,
  };

  const bytes = Buffer.from(JSON.stringify(profile));
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const source = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: profile.sourceSystem,
      sourceAccountId: profile.sourceAccountId,
      occurrenceKey: profile.occurrenceKey,
      sourceRevision: "v1",
      filename: "Synthetic timesheet.json",
      mediaType: "application/json",
      contentBase64: bytes.toString("base64"),
    },
    Source.SourceOccurrence,
  );

  await archiveVariableSource(book, source.id, bytes);

  const evidence = await post(
    book,
    "/evidence",
    {
      title: "Synthetic variable timesheet",
      origin: "synthetic-variable-test exact JSON bytes",
      mediaType: "text/plain",
      content: bytes.toString(),
    },
    A.Evidence,
  );

  const input: typeof Inputs.SubmitPayrollInput.Type = {
    employeeId: f.calculation.employeeId,
    month: "2026-01",
    recordClass: "synthetic",
    economicKey: key(),
    evidence: { evidenceId: evidence.id, sha256 },
    purpose: "Synthetic retained blocked variable pay",
    accountingPeriodId: "period_2026",
    postingDate: "2026-01-31",
    series: "L",
    liabilityAccountId: "salary_liability",
    basis: {
      kind: "variable",
      profile: "synthetic-exact-hourly-v1",
      expenseAccountId: "salary_expense",
      work: rows.map((row) => ({
        sourceId: row.sourceId,
        kind: row.kind,
        unitsMinor: row.unitsMinor,
        scheduleDate: row.scheduleDate,
      })),
      earnings: rows
        .filter((row) => row.kind === "worked")
        .map((row) => ({
          sourceIdentity: row.sourceId,
          componentKind: "cash",
          unitsNumerator: row.unitsMinor,
          unitsDenominator: "60",
          rateMinor: row.rateMinor,
          withholdingBase: true,
          contributionBase: true,
          holidayAccrualBase: true,
        })),
      holiday: {
        openingUnitsMinor: "1000000",
        openingValueMinor: "1000000",
        openingSocialMinor: "0",
        movements: [],
        valuationPerUnitMinor: "1",
        provisionNumerator: "0",
        provisionDenominator: "1",
      },
      holidayExpenseAccountId: "holiday_expense",
      holidayLiabilityAccountId: "holiday_liability",
      socialExpenseAccountId: "holiday_social_expense",
      socialProvisionAccountId: "holiday_social",
    },
  };

  const priorProfile: typeof V.VariablePaySourceProfile.Type = {
    ...profile,
    paymentOn: "2026-01-31",
    occurrenceKey: key(),
    rows: profile.rows.slice(0, 4).map((row, index) => {
      const scheduleDate = index === 3 ? row.scheduleDate : `2026-01-${10 + index}`;

      return {
        ...row,
        sourceId: `prior_${index}`,
        rowIdentity: `prior_row_${index}`,
        scheduleDate,
        economicOccurrence: JSON.stringify([
          profile.employeeId,
          scheduleDate,
          row.kind,
          row.startLocal,
          row.endLocal,
          row.breakMinutes,
        ]),
      };
    }),
  };

  const priorBytes = Buffer.from(JSON.stringify(priorProfile));

  const priorSource = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: priorProfile.sourceSystem,
      sourceAccountId: priorProfile.sourceAccountId,
      occurrenceKey: priorProfile.occurrenceKey,
      sourceRevision: "v1",
      filename: "Synthetic prior paid timesheet.json",
      mediaType: "application/json",
      contentBase64: priorBytes.toString("base64"),
    },
    Source.SourceOccurrence,
  );

  await archiveVariableSource(book, priorSource.id, priorBytes);

  const priorEvidence = await post(
    book,
    "/evidence",
    {
      title: "Synthetic prior paid source",
      content: priorBytes.toString(),
      mediaType: "text/plain",
      origin: "Exact synthetic prior timesheet JSON",
    },
    A.Evidence,
  );

  if (input.basis.kind !== "variable") throw new Error("Expected variable fixture");

  const priorInput = {
    ...input,
    economicKey: key(),
    evidence: { evidenceId: priorEvidence.id, sha256: priorSource.sha256.slice(7) },
    basis: {
      ...input.basis,
      work: priorProfile.rows.map((row) => ({
        sourceId: row.sourceId,
        kind: row.kind,
        unitsMinor: row.unitsMinor,
        scheduleDate: row.scheduleDate,
      })),
      earnings: priorProfile.rows.map((row) => ({
        sourceIdentity: row.sourceId,
        componentKind: "cash" as const,
        unitsNumerator: row.unitsMinor,
        unitsDenominator: "60",
        rateMinor: row.rateMinor,
        withholdingBase: true,
        contributionBase: true,
        holidayAccrualBase: true,
      })),
      holiday: { ...input.basis.holiday, openingUnitsMinor: "940000", openingValueMinor: "940000" },
    },
  };

  const original = await post(book, "/payroll/inputs", priorInput, Inputs.PayrollInput);

  const priorReview = await post(
    book,
    `/payroll/inputs/${original.id}/reviews`,
    { inputDigest: original.digest },
    Inputs.PayrollInputReview,
  );

  const reviewerSession = await createSession(f.reviewer);
  const reviewer = { ...f.reviewer, token: reviewerSession.token };
  await post(
    book,
    "/payroll/access",
    { actorId: reviewer.actorId, allowed: true },
    Foundation.PayrollAccessResult,
  );

  const priorApproval = await post(
    reviewer,
    `/payroll/input-reviews/${priorReview.id}/approvals`,
    { reviewDigest: priorReview.digest },
    Inputs.PayrollInputApproval,
  );

  await post(
    book,
    `/payroll/input-reviews/${priorReview.id}/executions`,
    { reviewDigest: priorReview.digest, approvalId: priorApproval.id },
    Inputs.PayrollInputExecution,
  );

  const calculation = await post(
    book,
    "/payroll/calculations",
    { ...f.calculation.basis.reviewedInput, inputIds: [original.id] },
    Calculations.PayrollCalculation,
  );

  const run = await post(
    book,
    "/payroll/runs",
    { ...f.input, calculationIds: [calculation.id] },
    Runs.PayrollRun,
  );

  const runApproval = await post(
    reviewer,
    `/payroll/runs/${run.id}/approvals`,
    { runDigest: run.digest },
    Runs.PayrollRunApproval,
  );

  await post(
    book,
    `/payroll/runs/${run.id}/executions`,
    { runDigest: run.digest, approvalId: runApproval.id },
    Runs.PayrollRunExecution,
  );
  const date = "2026-01-31";
  const amountMinor = `-${calculation.calculation.payableMinor}`;

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
    completeness: { declaredComplete: true, basis: "Independent synthetic paid work row" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: key(),
        date,
        description: "Synthetic observed payroll payment",
        amountMinor,
      },
    ],
  };

  const cashEvidence = await post(
    book,
    "/evidence",
    {
      title: "Synthetic observed payroll",
      content: JSON.stringify(declaration),
      mediaType: "application/json",
      origin: "Independent synthetic bank statement",
    },
    A.Evidence,
  );

  const statement = await post(
    book,
    "/bank-statements",
    { ...declaration, evidenceId: cashEvidence.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );

  const payment = await post(
    book,
    "/payroll/settlement-reviews",
    {
      kind: "payment",
      runId: run.id,
      employeeId: profile.employeeId,
      payeeEvidenceId: f.source.id,
      statementId: statement.statement.id,
      rowOrdinal: 1,
      bankAccountId: "account_bank",
      evidenceId: cashEvidence.id,
      accountingPeriodId: "period_2026",
      postingDate: date,
      series: "L",
      reason: "Synthetic observed paid source",
    },
    Settlement.SettlementReview,
  );

  const paymentApproval = await post(
    reviewer,
    `/payroll/settlement-reviews/${payment.id}/approvals`,
    { reviewDigest: payment.digest },
    Settlement.SettlementApproval,
  );

  const paymentExecution = await post(
    book,
    `/payroll/settlement-reviews/${payment.id}/executions`,
    { reviewDigest: payment.digest, approvalId: paymentApproval.id },
    Settlement.SettlementExecution,
  );

  if (!paymentExecution.paidEvent) throw new Error("Missing observed paid event");

  const submitted = await post(book, "/payroll/inputs", input, Inputs.PayrollInput);

  const assessment = await post(
    book,
    `/payroll/variable-pay/${submitted.id}/assessments`,
    {
      inputDigest: submitted.digest,
      sourceOccurrence: { occurrenceId: source.id, sha256: source.sha256 },
    },
    V.VariablePayReviewView,
  );

  const selected = await post(
    book,
    `/payroll/variable-pay/assessments/${assessment.assessment.id}/selections`,
    { assessmentDigest: assessment.assessment.digest },
    V.VariablePayReviewView,
  );

  return {
    ...f,
    baseEvidence: f.source,
    credentialReviewer: f.reviewer,
    book,
    reviewer,
    profile,
    source,
    input,
    submitted,
    original,
    priorSource,
    run,
    paid: paymentExecution.paidEvent,
    assessment: selected,
  };
}

export async function retainVariableProfile(
  book: Awaited<ReturnType<typeof variablePayFixture>>["book"],
  profile: typeof V.VariablePaySourceProfile.Type,
) {
  const bytes = Buffer.from(JSON.stringify(profile));

  const source = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: profile.sourceSystem,
      sourceAccountId: profile.sourceAccountId,
      occurrenceKey: profile.occurrenceKey,
      sourceRevision: "v1",
      filename: "Synthetic reviewed timesheet.json",
      mediaType: "application/json",
      contentBase64: bytes.toString("base64"),
    },
    Source.SourceOccurrence,
  );

  await archiveVariableSource(book, source.id, bytes);

  const evidence = await post(
    book,
    "/evidence",
    {
      title: "Synthetic reviewed source",
      content: bytes.toString(),
      mediaType: "text/plain",
      origin: "Exact synthetic timesheet JSON",
    },
    A.Evidence,
  );

  return { source, evidence: { evidenceId: evidence.id, sha256: source.sha256.slice(7) } };
}

export function variableInputFromProfile(
  input: typeof Inputs.SubmitPayrollInput.Type,
  profile: typeof V.VariablePaySourceProfile.Type,
  evidence: typeof Inputs.InputEvidence.Type,
) {
  if (input.basis.kind !== "variable") throw new Error("Expected variable source");

  return {
    ...input,
    economicKey: key(),
    evidence,
    basis: {
      ...input.basis,
      work: profile.rows.map((row) => ({
        sourceId: row.sourceId,
        kind: row.kind,
        unitsMinor: row.unitsMinor,
        scheduleDate: row.scheduleDate,
      })),
      earnings: profile.rows
        .filter((row) => ["worked", "overtime"].includes(row.kind))
        .map((row) => ({
          sourceIdentity: row.sourceId,
          componentKind: "cash" as const,
          unitsNumerator: row.unitsMinor,
          unitsDenominator: "60",
          rateMinor: row.rateMinor,
          withholdingBase: true,
          contributionBase: true,
          holidayAccrualBase: true,
        })),
    },
  };
}

async function archiveVariableSource(
  book: { bookId: string },
  occurrenceId: string,
  bytes: Uint8Array,
) {
  const admin = await database();
  let objectKey: string | null = null;

  try {
    objectKey =
      (
        await admin.query<{ object_key: string | null }>(
          "select c.object_key from openerp.intake_occurrences o join openerp.intake_contents c on c.book_id=o.book_id and c.sha256=o.sha256 where o.book_id=$1 and o.id=$2",
          [book.bookId, occurrenceId],
        )
      ).rows[0]?.object_key ?? null;
  } finally {
    await admin.end();
  }

  if (!objectKey) throw new Error("Retained variable source has no originalobjectreference");

  const archive = await fileObjectStore(
    join(await realpath(environment().scratch), "original-objects"),
  );

  await archive.put(objectKey, bytes);
}
