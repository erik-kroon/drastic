import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { assetClients } from "./asset-fixture-clients.mjs";

export const variableAccounts = [
  { id: "variable_salary", code: "7010", name: "Löner" },
  { id: "variable_reimbursement", code: "7390", name: "Övriga ersättningar" },
  { id: "variable_net_pay", code: "2910", name: "Löneskuld" },
  { id: "variable_withholding", code: "2710", name: "Avdragen skatt" },
  { id: "variable_contribution", code: "7510", name: "Arbetsgivaravgifter" },
  { id: "variable_contribution_liability", code: "2731", name: "Skuld för arbetsgivaravgifter" },
  { id: "variable_deduction", code: "2890", name: "Syntetiskt löneavdrag" },
  { id: "variable_holiday_expense", code: "7090", name: "Förändring av semesterskuld" },
  { id: "variable_holiday", code: "2920", name: "Semesterskuld" },
  { id: "variable_holiday_social", code: "2940", name: "Sociala avgifter på semesterskuld" },
  { id: "variable_holiday_social_expense", code: "7519", name: "Sociala avgifter på semester" },
];

function row(employeeId, prefix, ordinal, date, kind = "worked") {
  const startLocal = "07:30";
  const endLocal = "16:00";
  const breakMinutes = "60";
  return {
    rowIdentity: `${prefix}_row_${ordinal}`,
    sourceId: `${prefix}_time_${ordinal}`,
    economicOccurrence: JSON.stringify([employeeId, date, kind, startLocal, endLocal, breakMinutes]),
    kind,
    scheduleDate: date,
    startLocal,
    endLocal,
    breakMinutes,
    unitsMinor: "450",
    rateMinor: "20000",
    priorRunRow: null,
  };
}

export async function seedVariable(config) {
  const { book, reviewer, author, post } = await assetClients(config);
  const employeeId = "employee_maja_holm";
  const period = config.fixture.periods[0].id;
  const source = await post(reviewer, "/evidence", {
    title: "R42 independently specified synthetic payroll",
    content: "Synthetic salary3000000, original variable600000, withholding900000, deduction10000, contribution1131120, payable2690000. Holiday ledger940000. Pending2250minutes at20000/hour yields750000; sickness and holiday adjustment remain unknown.",
    mediaType: "text/plain",
    origin: "R42 disposable synthetic data, no statutory qualification",
  });
  await post(book, "/payroll/access", { actorId: config.fixture.actor.id, allowed: true });
  await post(book, "/payroll/access", { actorId: "paper_asset_reviewer", allowed: true });
  const rounding = { mode: "half_up", scale: 0 };
  const payrollProfile = {
    calculatorVersion: "payroll-regular-v1",
    cashProrationPolicy: "none",
    paymentTimingPolicy: { kind: "in_earnings_month", sourceReference: "Synthetic reviewed September full-month payroll paid25September" },
    supportedWorkPatterns: ["monthly_salaried"],
    withholdingRules: [{ kind: "fixed_amount", ruleId: "r42_withholding", frequency: "monthly", amountMinor: "900000", sourceReference: "R42 independent synthetic fixed withholding" }],
    benefitBaseMappings: [],
    obligationProfiles: [{ profileId: "r42_contribution", obligationKind: "employer_contribution", aggregationPeriod: "per_calendar_month", eligibleStatusClasses: ["synthetic"], minimumAgeOnPaymentOn: null, maximumAgeOnPaymentOn: null, obligationReference: "r42_contribution", bands: [{ lowerMinor: "0", upperMinor: null, rate: { numerator: "3142", denominator: "10000" } }], rounding, sourceReference: "R42 independent synthetic contribution rate" }],
    accrualProfiles: [],
    roundingByComponent: { gross: rounding, withholding: rounding, netDeduction: rounding, reimbursement: rounding, payable: rounding },
    supportedDeductionRoleKinds: ["owner"],
    sourceManifest: "R42 synthetic arithmetic only, not a statutory release",
  };
  const releaseId = "r42_synthetic_payroll_qz_v1";
  const checksum = `sha256:${createHash("sha256").update(JSON.stringify(payrollProfile)).digest("hex")}`;
  const { Client } = createRequire(join(resolve(import.meta.dirname, "../../apps/api"), "package.json"))("pg");
  const admin = new Client({ connectionString: config.adminUrl });
  await admin.connect();
  try {
    await admin.query("insert into openerp.rule_releases(id,jurisdiction,family,version,checksum,body) values($1,'QZ','payroll',1,$2,$3)", [releaseId, checksum, {
      id: releaseId, jurisdiction: "QZ", family: "payroll", version: 1, checksum,
      applicability: { legalForms: [], accountingMethods: [], vatRegistrations: [], payrollRegistrations: [] },
      requiredFactKinds: [], requiredRoleKinds: [], calculatorVersion: "payroll-regular-v1", rounding: { mode: "half_up", scale: 2 }, validFrom: "2026-01-01", validTo: "2026-12-31", sourceManifest: "R42 isolated synthetic payroll qualification", qualificationStatus: "reviewed", recordClasses: ["synthetic"], payroll: payrollProfile,
    }]);
  } finally { await admin.end(); }
  const fact = await post(reviewer, "/company-facts", { factKind: "jurisdiction", value: { state: "known", value: "QZ" }, effectiveFrom: "2026-01-01", effectiveTo: null, supersedesId: null, evidence: [{ evidenceId: source.id, sha256: source.sha256 }], note: "R42 synthetic jurisdiction" });
  await post(author, `/company-facts/${fact.id}/reviews`, { factRevisionId: fact.id, expectedDigest: fact.digest, result: "confirmed", rationale: "Independent R42 synthetic qualification" });
  const employment = await post(reviewer, "/payroll/revisions", { employeeId, kind: "employment", effectiveOn: "2026-09-01", supersedes: null, evidenceId: source.id, body: { personRef: "Maja Holm", jurisdiction: "QZ", residency: "Synthetic", payTerms: "Synthetic monthly salary and variable input", workSchedule: "Synthetic full month", taxFacts: "Synthetic fixed withholding" } });
  const work = await post(reviewer, "/payroll/revisions", { employeeId, kind: "work", effectiveOn: "2026-09-01", supersedes: null, evidenceId: source.id, body: { periodStart: "2026-09-01", periodEnd: "2026-09-30", inputs: ["Synthetic September work"] } });
  await post(reviewer, "/payroll/revisions", { employeeId, kind: "opening", effectiveOn: "2026-09-01", supersedes: null, evidenceId: source.id, body: { asOf: "2026-09-01", balanceMinor: "0", obligation: "r42_contribution" } });
  const opening = await post(reviewer, "/change-sets", { kind: "manual_journal", evidenceId: source.id, eventKey: "r42_holiday_opening", accountingPeriodId: period, postingDate: "2026-09-01", series: "L", description: "Synthetic evidenced holiday opening", rationale: "Independent holiday liability940000", taxAssessment: "not_applicable", lines: [{ accountId: "variable_holiday_expense", debitMinor: "940000", creditMinor: "0", description: "Synthetic holiday opening" }, { accountId: "variable_holiday", debitMinor: "0", creditMinor: "940000", description: "Synthetic holiday liability" }] });
  const openingApproval = await post(author, `/change-sets/${opening.id}/approvals`, { version: 1, planDigest: opening.planDigest });
  await post(reviewer, `/change-sets/${opening.id}/execute`, { version: 1, planDigest: opening.planDigest, approvalId: openingApproval.id });

  async function retain(profile, filename) {
    const content = JSON.stringify(profile);
    const occurrence = await post(reviewer, "/source-occurrences", { sourceSystem: profile.sourceSystem, sourceAccountId: profile.sourceAccountId, occurrenceKey: profile.occurrenceKey, sourceRevision: "1", filename, mediaType: "application/json", contentBase64: Buffer.from(content).toString("base64") });
    const evidence = await post(reviewer, "/evidence", { title: filename, content, mediaType: "text/plain", origin: "R42 exact retained synthetic timesheet JSON" });
    if (occurrence.sha256 !== `sha256:${evidence.sha256}`) throw new Error("R42 source and evidence bytes differ");
    return { occurrence, evidence };
  }
  function input(profile, retained, economicKey, openingValueMinor) {
    return { employeeId, month: "2026-09", recordClass: "synthetic", economicKey, evidence: { evidenceId: retained.evidence.id, sha256: retained.evidence.sha256 }, purpose: "Retained synthetic September variable pay", accountingPeriodId: period, postingDate: "2026-09-22", series: "L", liabilityAccountId: "variable_net_pay", basis: { kind: "variable", profile: "synthetic-exact-hourly-v1", expenseAccountId: "variable_salary", work: profile.rows.map(item => ({ sourceId: item.sourceId, kind: item.kind, unitsMinor: item.unitsMinor, scheduleDate: item.scheduleDate })), earnings: profile.rows.filter(item => item.kind === "worked").map(item => ({ sourceIdentity: item.sourceId, componentKind: "cash", unitsNumerator: item.unitsMinor, unitsDenominator: "60", rateMinor: item.rateMinor, withholdingBase: true, contributionBase: true, holidayAccrualBase: true })), holiday: { openingUnitsMinor: openingValueMinor, openingValueMinor, openingSocialMinor: "0", movements: [], valuationPerUnitMinor: "1", provisionNumerator: "0", provisionDenominator: "1" }, holidayExpenseAccountId: "variable_holiday_expense", holidayLiabilityAccountId: "variable_holiday", socialExpenseAccountId: "variable_holiday_social_expense", socialProvisionAccountId: "variable_holiday_social" } };
  }
  const originalProfile = { profile: "synthetic-variable-timesheet-v1", employeeId, month: "2026-09", paymentOn: "2026-09-25", sourceSystem: "paper_variable_pay", sourceAccountId: employeeId, occurrenceKey: "r42_prior_paid_timesheet", rows: ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-15"].map((date, index) => row(employeeId, "r42_prior", index + 1, date)) };
  const originalSource = await retain(originalProfile, "Tidsrapport, betald 25 sep.json");
  const original = await post(reviewer, "/payroll/inputs", input(originalProfile, originalSource, "r42_original_variable", "940000"));
  const recognition = await post(reviewer, `/payroll/inputs/${original.id}/reviews`, { inputDigest: original.digest });
  const recognitionApproval = await post(author, `/payroll/input-reviews/${recognition.id}/approvals`, { reviewDigest: recognition.digest });
  await post(reviewer, `/payroll/input-reviews/${recognition.id}/executions`, { reviewDigest: recognition.digest, approvalId: recognitionApproval.id });
  const reference = { evidenceId: source.id, sha256: source.sha256 };
  const calculation = await post(reviewer, "/payroll/calculations", {
    recordClass: "synthetic",
    inputIds: [original.id],
    employment: { employeeId, effectiveRevision: employment.id, monthlyCashSalary: "3000000", workPattern: "monthly_salaried", withholding: { ruleId: "r42_withholding", tableColumn: null, taxStatus: "synthetic", evidence: [reference] }, grossAdjustments: [], reimbursements: [], benefitComponents: [], deductionComponents: [{ componentId: "r42_deduction", minor: "10000", description: "Synthetic post-tax deduction", destinationRole: "owner", reducesBenefit: null }], holidayPolicy: { state: "evidenced_not_applicable", evidence: [reference] }, pensionAndOtherObligations: [{ state: "applicable", selection: { profileId: "r42_contribution", obligationReference: "r42_contribution", statusClass: "synthetic", ageOnPaymentOn: 41, evidence: [reference] } }] },
    work: { effectiveRevision: work.id, earningsPeriod: { startsOn: "2026-09-01", endsOn: "2026-09-30" }, expectedPaymentOn: "2026-09-25", absence: [], adjustments: [], reimbursements: [], evidence: [reference] },
    reason: "R42 independently specified original observed payroll",
  });
  if (calculation.calculation.payableMinor !== "2690000" || calculation.calculation.employerContributionMinor !== "1131120") throw new Error("R42 original payroll differs from independent expectations");
  const run = await post(reviewer, "/payroll/runs", { calculationIds: [calculation.id], accountingPeriodId: period, postingDate: "2026-09-25", evidenceId: source.id, series: "L", reason: "Synthetic September payroll retaining prior variable sources", roles: { salaryExpenseAccountId: "variable_salary", reimbursementExpenseAccountId: "variable_reimbursement", netPayLiabilityAccountId: "variable_net_pay", withholdingLiabilityAccountId: "variable_withholding", employerContributionExpenseAccountId: "variable_contribution", employerContributionLiabilityAccountId: "variable_contribution_liability", deductions: [{ roleKind: "owner", accountId: "variable_deduction" }], accruals: [] } });
  const runApproval = await post(author, `/payroll/runs/${run.id}/approvals`, { runDigest: run.digest });
  const runExecution = await post(reviewer, `/payroll/runs/${run.id}/executions`, { runDigest: run.digest, approvalId: runApproval.id });
  for (const document of runExecution.payslips) await post(reviewer, `/payroll/payslips/${document.id}/renders`, { documentDigest: document.digest });
  const declaration = { kind: "synthetic_bank_statement_v1", statementIdentifier: "r42_salary_payment", sourceBankAccountId: "r42_synthetic_bank", accountId: "account_bank", currency: "SEK", startsOn: "2026-09-25", endsOn: "2026-09-25", openingMinor: "10000000", closingMinor: "7310000", completeness: { declaredComplete: true, basis: "Independent synthetic observed September payroll payment" }, rows: [{ rowOrdinal: 1, providerId: "r42_paid_salary_row", date: "2026-09-25", description: "Synthetic Maja Holm payroll payment", amountMinor: "-2690000" }] };
  const cashEvidence = await post(reviewer, "/evidence", { title: "R42 observed synthetic payroll payment", content: JSON.stringify(declaration), mediaType: "application/json", origin: "Independent synthetic bank observation" });
  const statement = await post(reviewer, "/bank-statements", { ...declaration, evidenceId: cashEvidence.id, existingMatches: [] });
  const payment = await post(reviewer, "/payroll/settlement-reviews", { kind: "payment", runId: run.id, employeeId, payeeEvidenceId: source.id, statementId: statement.statement.id, rowOrdinal: 1, bankAccountId: "account_bank", evidenceId: cashEvidence.id, accountingPeriodId: period, postingDate: "2026-09-25", series: "L", reason: "Independent synthetic observed payroll payment" });
  const paymentApproval = await post(author, `/payroll/settlement-reviews/${payment.id}/approvals`, { reviewDigest: payment.digest });
  const paid = await post(reviewer, `/payroll/settlement-reviews/${payment.id}/executions`, { reviewDigest: payment.digest, approvalId: paymentApproval.id });
  if (!paid.paidEvent || paid.paidEvent.paidOn !== "2026-09-25") throw new Error("R42 original payroll has no observed September25 paid event");
  const currentProfile = { ...originalProfile, occurrenceKey: "r42_pending_timesheet", paymentOn: "2026-10-25", rows: ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-15", "2026-09-16"].map((date, index) => row(employeeId, "r42_current", index + 1, date)).concat([row(employeeId, "r42_current_sick", 1, "2026-09-08", "sick"), row(employeeId, "r42_current_sick", 2, "2026-09-09", "sick")]) };
  const currentSource = await retain(currentProfile, "Tidsrapport september, Maja Holm.json");
  const submitted = await post(reviewer, "/payroll/inputs", { ...input(currentProfile, currentSource, "r42_pending_variable", "1000000"), postingDate: "2026-09-30" });
  const assessed = await post(reviewer, `/payroll/variable-pay/${submitted.id}/assessments`, { inputDigest: submitted.digest, sourceOccurrence: { occurrenceId: currentSource.occurrence.id, sha256: currentSource.occurrence.sha256 } });
  const ready = await post(reviewer, `/payroll/variable-pay/assessments/${assessed.assessment.id}/selections`, { assessmentDigest: assessed.assessment.digest });
  if (JSON.stringify(ready.current.blockers.map(item => item.code)) !== JSON.stringify(["unsupported_work", "holiday_control", "duplicate_source"]) || ready.assessment.workedMinutes !== "2250" || ready.assessment.workedAmountMinor !== "750000" || ready.assessment.sickAmountMinor !== null || ready.assessment.holidayDeltaMinor !== null || ready.assessment.submitter.displayName !== "Sara Lind" || ready.current.blockers[2].priorRunRow !== 4 || ready.current.blockers[2].paidOn !== "2026-09-25" || ready.current.blockers[2].priorPaidEventId !== paid.paidEvent.id || ready.recognition !== null || ready.dispositions.length) throw new Error("R42 seed must retain all three blockers and no financial outcome");
  const artifact = join(config.artifacts, "variable-fixture.json");
  await writeFile(artifact, JSON.stringify({ synthetic: true, assessmentId: ready.assessment.id, inputId: submitted.id, originalInputId: original.id, originalRunId: run.id, paidEventId: paid.paidEvent.id, sourceOccurrenceId: currentSource.occurrence.id, blocked: true, posted: false }, null, 2));
  return { seeded: true, assessmentId: ready.assessment.id, artifact };
}
