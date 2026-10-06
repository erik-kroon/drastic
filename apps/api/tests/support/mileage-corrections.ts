import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import * as A from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Foundation from "@open-erp/contracts/payroll-foundation";
import * as Inputs from "@open-erp/contracts/payroll-inputs";
import * as Payroll from "@open-erp/contracts/payroll-calculations";
import * as Runs from "@open-erp/contracts/payroll-runs";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Mileage from "@open-erp/contracts/mileage-corrections";
import * as Source from "@open-erp/contracts/source-intake";
import * as Onboarding from "@open-erp/contracts/onboarding";
import { equalJson } from "@open-erp/domain/canonicalization";
import { Schema } from "effect";
import { fileObjectStore } from "../../scripts/file-object-store";
import {
  createSession,
  database,
  decoded,
  environment,
  fixture,
  key,
  post,
  request,
  type BookFixture,
} from "./fixtures";

const rounding = { mode: "half_up", scale: 0 } as const;

const profile: typeof Payroll.PayrollRuleRelease.Type = {
  calculatorVersion: Payroll.SupportedCalculatorVersion,
  cashProrationPolicy: "none",
  paymentTimingPolicy: {
    kind: "in_earnings_month",
    sourceReference:
      "Explicit synthetic September payroll paid25September during the full earnings month",
  },
  supportedWorkPatterns: ["monthly_salaried"],
  withholdingRules: [
    {
      kind: "fixed_amount",
      ruleId: "r41_withholding",
      frequency: "monthly",
      amountMinor: "900000",
      sourceReference: "Independent synthetic withholding900000",
    },
  ],
  benefitBaseMappings: [],
  obligationProfiles: [
    {
      profileId: "r41_contribution",
      obligationKind: "employer_contribution",
      aggregationPeriod: "per_calendar_month",
      eligibleStatusClasses: ["synthetic"],
      minimumAgeOnPaymentOn: null,
      maximumAgeOnPaymentOn: null,
      obligationReference: "r41_contribution",
      bands: [
        { lowerMinor: "0", upperMinor: null, rate: { numerator: "3142", denominator: "10000" } },
      ],
      rounding,
      sourceReference: "Independent synthetic contribution3142/10000",
    },
  ],
  accrualProfiles: [],
  roundingByComponent: {
    gross: rounding,
    withholding: rounding,
    netDeduction: rounding,
    reimbursement: rounding,
    payable: rounding,
  },
  supportedDeductionRoleKinds: ["owner"],
  sourceManifest: "R41 synthetic arithmetic only, no statutory qualification",
};

export async function retainMileageSource(
  book: BookFixture,
  filename: string,
  lines: ReadonlyArray<string>,
) {
  const stream = `BT /F1 12 Tf 30 250 Td ${lines.map((line, index) => `${index ? "0 -18 Td " : ""}(${line.replace(/[()\\]/g, "\\$&")}) Tj`).join("\n")} ET`;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 450 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];

  let content = "%PDF-1.4\n";
  const offsets = [];

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  const bytes = Buffer.from(content);

  const occurrence = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "synthetic-mileage",
      sourceAccountId: "employee_anders_berg",
      occurrenceKey: key(),
      sourceRevision: "1",
      filename,
      mediaType: "application/pdf",
      contentBase64: bytes.toString("base64"),
    },
    Source.SourceOccurrence,
  );

  const original = await decoded(
    await request(book, `/source-occurrences/${occurrence.id}`),
    Source.SourceOccurrenceView,
  );

  const retainedBytes = Buffer.from(original.contentBase64, "base64");

  if (
    !retainedBytes.equals(bytes) ||
    `sha256:${createHash("sha256").update(retainedBytes).digest("hex")}` !== occurrence.sha256
  )
    throw new Error("Retained mileage original differs from uploaded PDF");

  const admin = await database();
  let objectKey;

  try {
    objectKey = (
      await admin.query<{ object_key: string }>(
        "select object_key from openerp.intake_contents where book_id=$1 and sha256=$2",
        [book.bookId, occurrence.sha256],
      )
    ).rows[0]?.object_key;
  } finally {
    await admin.end();
  }

  if (!objectKey) throw new Error("Retained mileage original has no owned object reference");

  const archive = await fileObjectStore(
    join(await realpath(environment().scratch), "original-objects"),
  );

  await archive.put(objectKey, retainedBytes);

  const evidence = await post(
    book,
    "/evidence",
    {
      title: filename,
      content,
      mediaType: "text/plain",
      origin: "Exact ASCII serialization of retained synthetic mileage PDF",
    },
    A.Evidence,
  );

  if (occurrence.sha256 !== `sha256:${evidence.sha256}`)
    throw new Error("Mileage accounting evidence and original must retain identical bytes");

  return { occurrence, evidence };
}

async function cash(book: BookFixture, amountMinor: string, date: string) {
  const declaration = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "synthetic_mileage_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: date,
    endsOn: date,
    openingMinor: "10000000",
    closingMinor: (10000000n + BigInt(amountMinor)).toString(),
    completeness: { declaredComplete: true, basis: "Independent synthetic bank observation" },
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
    book,
    "/evidence",
    {
      title: "Synthetic mileage cash observation",
      content: JSON.stringify(declaration),
      mediaType: "application/json",
      origin: "Independent synthetic bank observation",
    },
    A.Evidence,
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
    reason: "Independent synthetic observed employee cash",
  };
}

export async function mileageFixture(
  options: {
    salaryMinor?: string;
    pay?: boolean;
    assignedApprover?: boolean;
    independentApprover?: boolean;
  } = {},
) {
  const salaryMinor = options.salaryMinor ?? "4200100";

  if (salaryMinor !== "4200100" && salaryMinor !== "4200000")
    throw new Error("Unsupported independent R41 fixture salary");

  const base = await fixture([
    { id: "mileage_expense", code: "7330", name: "Synthetic exempt mileage" },
    { id: "mileage_taxable", code: "7331", name: "Synthetic taxable mileage" },
    { id: "mileage_liability", code: "2821", name: "Synthetic exempt mileage debt" },
    { id: "mileage_taxable_liability", code: "2822", name: "Synthetic taxable mileage debt" },
    { id: "employee_recovery", code: "1610", name: "Synthetic employee recovery" },
    { id: "salary_expense", code: "7010", name: "Synthetic salary" },
    { id: "salary_liability", code: "2910", name: "Synthetic net salary debt" },
    { id: "withholding_liability", code: "2710", name: "Synthetic withholding" },
    { id: "contribution_expense", code: "7510", name: "Synthetic contribution" },
    { id: "contribution_liability", code: "2731", name: "Synthetic contribution debt" },
    { id: "deduction_destination", code: "2890", name: "Synthetic deduction debt" },
  ]);

  const independent = await fixture();
  const reviewerBase = { ...base, actorId: independent.actorId, token: independent.token };
  const admin = await database();
  const releaseId = "r41_synthetic_payroll_qy_v1";
  const checksum = `sha256:${createHash("sha256").update(JSON.stringify(profile)).digest("hex")}`;
  let ruleRelease: typeof Profiles.RuleRelease.Type;

  try {
    await admin.query("BEGIN");
    await admin.query("SELECT pg_advisory_xact_lock(hashtext('r41_synthetic_payroll_qy'))");
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [base.bookId, reviewerBase.actorId],
    );

    const retained = (
      await admin.query<{ version: number; checksum: string; body: unknown }>(
        "SELECT version,checksum,body FROM openerp.rule_releases WHERE id=$1",
        [releaseId],
      )
    ).rows[0];

    const version =
      retained?.version ??
      (
        await admin.query<{ version: number }>(
          "SELECT coalesce(max(version),0)+1 AS version FROM openerp.rule_releases WHERE jurisdiction='QY' AND family='payroll'",
        )
      ).rows[0]?.version;

    if (!Number.isSafeInteger(version) || version === undefined || version < 1)
      throw new Error("Synthetic payroll release version missing or invalid");
    ruleRelease = {
      id: releaseId,
      jurisdiction: "QY",
      family: "payroll",
      version,
      checksum,
      applicability: {
        legalForms: [],
        accountingMethods: [],
        vatRegistrations: [],
        payrollRegistrations: [],
      },
      requiredFactKinds: [],
      requiredRoleKinds: [],
      calculatorVersion: Payroll.SupportedCalculatorVersion,
      rounding: { mode: "half_up", scale: 2 },
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      sourceManifest: "R41 isolated synthetic QY payroll qualification",
      qualificationStatus: "reviewed",
      recordClasses: ["synthetic"],
      payroll: profile,
    };

    if (retained) {
      const retainedRelease = Schema.decodeUnknownSync(Profiles.RuleRelease)(retained.body);

      if (retained.checksum !== checksum || !equalJson(retainedRelease, ruleRelease))
        throw new Error(
          "Retained synthetic payroll release differs from its exact qualified fixture",
        );
    } else {
      await admin.query(
        "INSERT INTO openerp.rule_releases(id,jurisdiction,family,version,checksum,body) VALUES($1,'QY','payroll',$2,$3,$4)",
        [releaseId, version, checksum, ruleRelease],
      );
    }

    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  } finally {
    await admin.end();
  }

  const bookSession = await createSession(base);
  const reviewerSession = await createSession(reviewerBase);
  const book = { ...base, token: bookSession.token };
  const reviewer = { ...reviewerBase, token: reviewerSession.token };

  const source = await post(
    book,
    "/evidence",
    {
      title: "Independent R41 payroll expectations",
      mediaType: "text/plain",
      origin: "Synthetic R41 verification",
      content: `Salary${salaryMinor}; withholding900000; post-tax deduction10000; mileage51600/exempt43000/taxable8600; contribution3142/10000, half-up aggregate. Salary4200100 gives contribution1322374 then1322028; salary4200000 gives1322342 then1321997.`,
    },
    A.Evidence,
  );

  for (const actorId of [book.actorId, reviewer.actorId])
    await post(book, "/payroll/access", { actorId, allowed: true }, Foundation.PayrollAccessResult);

  const fact = await post(
    book,
    "/company-facts",
    {
      factKind: "jurisdiction",
      value: { state: "known", value: "QY" },
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      supersedesId: null,
      evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
      note: "R41 synthetic jurisdiction",
    },
    Profiles.FactRevision,
  );

  await post(
    reviewer,
    `/company-facts/${fact.id}/reviews`,
    {
      factRevisionId: fact.id,
      expectedDigest: fact.digest,
      result: "confirmed",
      rationale: "Independent synthetic jurisdiction review",
    },
    Profiles.FactReview,
  );
  const employeeId = "employee_anders_berg";

  const employment = await post(
    book,
    "/payroll/revisions",
    {
      employeeId,
      kind: "employment",
      effectiveOn: "2026-09-01",
      supersedes: null,
      evidenceId: source.id,
      body: {
        personRef: "Anders Berg",
        jurisdiction: "QY",
        residency: "Synthetic",
        payTerms: "Synthetic monthly salary",
        workSchedule: "Synthetic September month",
        taxFacts: "Synthetic fixed withholding",
      },
    },
    Foundation.PayrollRevision,
  );

  const work = await post(
    book,
    "/payroll/revisions",
    {
      employeeId,
      kind: "work",
      effectiveOn: "2026-09-01",
      supersedes: null,
      evidenceId: source.id,
      body: {
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        inputs: ["Synthetic September work"],
      },
    },
    Foundation.PayrollRevision,
  );

  await post(
    book,
    "/payroll/revisions",
    {
      employeeId,
      kind: "opening",
      effectiveOn: "2026-09-01",
      supersedes: null,
      evidenceId: source.id,
      body: { asOf: "2026-09-01", balanceMinor: "0", obligation: "r41_contribution" },
    },
    Foundation.PayrollRevision,
  );

  const original = await retainMileageSource(book, "Original route12September.pdf", [
    "Synthetic route review",
    "MIL-2026-0012, Anders Berg",
    "12 Sep2026, Ostersund to Sundsvall",
    "Distance172km",
  ]);

  const revised = await retainMileageSource(book, "Revised route3October.pdf", [
    "Independent synthetic route review",
    "MIL-2026-0012, Anders Berg",
    "3 Oct2026, Ostersund to Sundsvall",
    "Corrected distance150km",
  ]);

  const basis = await retainMileageSource(book, "Employee attestation3October.pdf", [
    "Independent synthetic employee attestation",
    "Anders Berg,3Oct2026",
    "Original route distance was incorrect",
    "Corrected distance150km",
  ]);

  const trip = {
    id: "mil_2026_0012",
    reference: "MIL-2026-0012",
    claimantId: employeeId,
    businessPurpose: "Synthetic customer visit",
    departureOn: "2026-09-12",
    arrivalOn: "2026-09-12",
    routeEvidenceRef: original.evidence.id,
    routeReviewed: true,
    origin: "Ostersund",
    destination: "Sundsvall",
    distanceInMeters: "172000",
    vehicleIdentity: "r41_private_car",
    ownershipKind: "private_car",
    fuelPayer: "employee",
    previousRevision: null,
  } as const;

  const input = await post(
    book,
    "/payroll/inputs",
    {
      employeeId,
      month: "2026-09",
      recordClass: "synthetic",
      economicKey: `r41_${key()}`,
      evidence: { evidenceId: original.evidence.id, sha256: original.evidence.sha256 },
      purpose: trip.businessPurpose,
      accountingPeriodId: "period_2026",
      postingDate: "2026-09-12",
      series: "L",
      liabilityAccountId: "mileage_liability",
      basis: {
        kind: "mileage",
        trip,
        release: {
          releaseId: "r41_synthetic_mileage_v1",
          distanceUnitMeters: "1000",
          entitlementRateMinorPerUnit: "300",
          taxExemptRateMinorPerUnit: "250",
          requiresVehicleIdentity: true,
          requiresFuelPayer: true,
          evidenceSourceHash: original.occurrence.sha256,
        },
        expenseAccountId: "mileage_expense",
        taxableExpenseAccountId: "mileage_taxable",
        taxableLiabilityAccountId: "mileage_taxable_liability",
      },
    },
    Inputs.PayrollInput,
  );

  const recognition = await post(
    book,
    `/payroll/inputs/${input.id}/reviews`,
    { inputDigest: input.digest },
    Inputs.PayrollInputReview,
  );

  const recognitionApproval = await post(
    reviewer,
    `/payroll/input-reviews/${recognition.id}/approvals`,
    { reviewDigest: recognition.digest },
    Inputs.PayrollInputApproval,
  );

  await post(
    book,
    `/payroll/input-reviews/${recognition.id}/executions`,
    { reviewDigest: recognition.digest, approvalId: recognitionApproval.id },
    Inputs.PayrollInputExecution,
  );
  const reference = { evidenceId: source.id, sha256: source.sha256 };

  const calculation = await post(
    book,
    "/payroll/calculations",
    {
      recordClass: "synthetic",
      inputIds: [input.id],
      employment: {
        employeeId,
        effectiveRevision: employment.id,
        monthlyCashSalary: salaryMinor,
        workPattern: "monthly_salaried",
        withholding: {
          ruleId: "r41_withholding",
          tableColumn: null,
          taxStatus: "synthetic",
          evidence: [reference],
        },
        grossAdjustments: [],
        reimbursements: [],
        benefitComponents: [],
        deductionComponents: [
          {
            componentId: "r41_deduction",
            minor: "10000",
            description: "Synthetic post-tax deduction",
            destinationRole: "owner",
            reducesBenefit: null,
          },
        ],
        holidayPolicy: { state: "evidenced_not_applicable", evidence: [reference] },
        pensionAndOtherObligations: [
          {
            state: "applicable",
            selection: {
              profileId: "r41_contribution",
              obligationReference: "r41_contribution",
              statusClass: "synthetic",
              ageOnPaymentOn: 30,
              evidence: [reference],
            },
          },
        ],
      },
      work: {
        effectiveRevision: work.id,
        earningsPeriod: { startsOn: "2026-09-01", endsOn: "2026-09-30" },
        expectedPaymentOn: "2026-09-25",
        absence: [],
        adjustments: [],
        reimbursements: [],
        evidence: [reference],
      },
      reason: "Independently specified synthetic September payroll",
    },
    Payroll.PayrollCalculation,
  );

  const expected =
    salaryMinor === "4200100"
      ? { payable: "3341700", contribution: "1322374" }
      : { payable: "3341600", contribution: "1322342" };

  if (
    calculation.calculation.payableMinor !== expected.payable ||
    calculation.calculation.employerContributionMinor !== expected.contribution
  )
    throw new Error("Stored original payroll differs from independent R41 arithmetic");

  const run = await post(
    book,
    "/payroll/runs",
    {
      calculationIds: [calculation.id],
      accountingPeriodId: "period_2026",
      postingDate: "2026-09-25",
      evidenceId: source.id,
      series: "L",
      reason: "Retained synthetic September mileage payroll",
      roles: {
        salaryExpenseAccountId: "salary_expense",
        reimbursementExpenseAccountId: "mileage_expense",
        netPayLiabilityAccountId: "salary_liability",
        withholdingLiabilityAccountId: "withholding_liability",
        employerContributionExpenseAccountId: "contribution_expense",
        employerContributionLiabilityAccountId: "contribution_liability",
        deductions: [{ roleKind: "owner", accountId: "deduction_destination" }],
        accruals: [],
      },
    },
    Runs.PayrollRun,
  );

  const runApproval = await post(
    reviewer,
    `/payroll/runs/${run.id}/approvals`,
    { runDigest: run.digest },
    Runs.PayrollRunApproval,
  );

  const execution = await post(
    book,
    `/payroll/runs/${run.id}/executions`,
    { runDigest: run.digest, approvalId: runApproval.id },
    Runs.PayrollRunExecution,
  );

  for (const document of execution.payslips)
    await post(
      book,
      `/payroll/payslips/${document.id}/renders`,
      { documentDigest: document.digest },
      Runs.PayrollPayslipArtifact,
    );

  let paid: typeof Settlement.PaidPayrollEvent.Type | null = null;

  if (options.pay !== false) {
    const payment = await post(
      book,
      "/payroll/settlement-reviews",
      {
        kind: "payment",
        runId: run.id,
        employeeId,
        payeeEvidenceId: source.id,
        ...(await cash(book, `-${calculation.calculation.payableMinor}`, "2026-09-25")),
      },
      Settlement.SettlementReview,
    );

    const approval = await post(
      reviewer,
      `/payroll/settlement-reviews/${payment.id}/approvals`,
      { reviewDigest: payment.digest },
      Settlement.SettlementApproval,
    );

    const paymentExecution = await post(
      book,
      `/payroll/settlement-reviews/${payment.id}/executions`,
      { reviewDigest: payment.digest, approvalId: approval.id },
      Settlement.SettlementExecution,
    );

    paid = paymentExecution.paidEvent;

    if (!paid) throw new Error("Synthetic observed payment did not retain a paid event");
    await post(
      book,
      "/payroll/periods",
      { reportingPeriod: "2026-09", evidenceId: source.id },
      Settlement.PayrollPeriod,
    );
  }

  let approver: BookFixture | null = null;
  let assignedResponsibilities: typeof Onboarding.OnboardingResponsibilities.Type | null = null;

  if (options.assignedApprover || options.independentApprover) {
    const independentApprover = await fixture();

    const approverBase = {
      ...book,
      actorId: independentApprover.actorId,
      token: independentApprover.token,
    };

    const membership = await database();

    try {
      await membership.query(
        "INSERT INTO openerp.memberships(book_id,actor_id,role) VALUES($1,$2,'operator')",
        [book.bookId, approverBase.actorId],
      );
    } finally {
      await membership.end();
    }

    const session = await createSession(approverBase);
    approver = { ...approverBase, token: session.token };
    await post(
      book,
      "/payroll/access",
      { actorId: approver.actorId, allowed: true },
      Foundation.PayrollAccessResult,
    );

    if (options.assignedApprover) {
      assignedResponsibilities = await post(
        book,
        "/onboarding/responsibilities",
        {
          expectedRevision: 0,
          assignments: {
            preparerId: book.actorId,
            bookkeepingApproverId: approver.actorId,
            paymentApproverId: approver.actorId,
            vatResponsibleId: reviewer.actorId,
            activationConfirmerIds: [book.actorId, approver.actorId],
          },
        },
        Onboarding.OnboardingResponsibilities,
      );
    }
  }

  const originalHistory = async () => {
    const sources = [];

    for (const retained of [original, revised, basis])
      sources.push(
        await decoded(
          await request(book, `/source-occurrences/${retained.occurrence.id}`),
          Source.SourceOccurrenceView,
        ),
      );

    const payslips = [];

    for (const document of execution.payslips)
      payslips.push(
        await decoded(
          await request(book, `/payroll/payslips/${document.id}/artifact`),
          Runs.PayrollPayslipArtifactBytes,
        ),
      );

    const revisions = await decoded(
      await request(book, `/payroll/employees/${employeeId}/revisions`),
      Foundation.PayrollHistory,
    );

    const originalRevisions = [
      calculation.basis.employmentRevisionId,
      calculation.basis.workRevisionId,
      calculation.basis.openingRevisionId,
    ].map((id) => {
      const retained = revisions.items.find((item) => item.id === id);

      if (!retained) throw new Error("Original paid calculation foundation revision missing");
      const { isCurrent: _isCurrent, ...original } = retained;

      return original;
    });

    return {
      sources,
      payslips,
      input: await decoded(
        await request(book, `/payroll/inputs/${input.id}`),
        Inputs.PayrollInputView,
      ),
      run: await decoded(await request(book, `/payroll/runs/${run.id}`), Runs.PayrollRunView),
      revisions: { ...revisions, items: originalRevisions },
    };
  };

  const history = await originalHistory();

  const proposalInput: typeof Mileage.PrepareMileageCorrection.Type = {
    originalInputId: input.id,
    originalInputDigest: input.digest,
    previousCorrectionExecutionId: null,
    revisedTrip: {
      ...trip,
      id: "mil_2026_0012_r2",
      previousRevision: trip.id,
      distanceInMeters: "150000",
      routeEvidenceRef: revised.occurrence.id,
    },
    originalRouteSource: {
      occurrenceId: original.occurrence.id,
      sha256: original.occurrence.sha256,
    },
    routeSource: { occurrenceId: revised.occurrence.id, sha256: revised.occurrence.sha256 },
    recoveryBasisSource: { occurrenceId: basis.occurrence.id, sha256: basis.occurrence.sha256 },
    recoveryReason: "Incorrect original distance independently attested3October",
    recoveryReceivableAccountId: "employee_recovery",
    accountingPeriodId: "period_2026",
    postingDate: "2026-10-03",
    series: "L",
  };

  return {
    book,
    ruleRelease,
    reviewer,
    approver,
    assignedResponsibilities,
    source,
    input,
    run,
    execution,
    paid,
    basis,
    proposalInput,
    originalHistory,
    history,
  };
}

type MileageFixture = Awaited<ReturnType<typeof mileageFixture>>;

export async function readyMileageCorrection(f: MileageFixture) {
  const view = await post(
    f.book,
    "/payroll/mileage-corrections",
    f.proposalInput,
    Mileage.MileageCorrectionView,
  );

  if (!view.comparison)
    throw new Error(
      `Qualified mileage proposal is blocked: ${JSON.stringify(view.current.blockers)}`,
    );

  const lawfulBasis = await post(
    f.reviewer,
    "/payroll/adjustment-bases",
    {
      comparisonId: view.comparison.paidComparisonId,
      kind: "gross_recovery",
      evidenceId: f.basis.evidence.id,
      reason: f.proposalInput.recoveryReason,
    },
    Settlement.AdjustmentBasis,
  );

  return post(
    f.book,
    `/payroll/mileage-corrections/${view.proposal.id}/reviews`,
    { proposalDigest: view.proposal.digest, lawfulBasisId: lawfulBasis.id },
    Mileage.MileageCorrectionView,
  );
}

export async function recoveryCash(f: MileageFixture, claimId: string, amountMinor: string) {
  const review = await post(
    f.book,
    "/payroll/settlement-reviews",
    {
      kind: "cash_recovery",
      claimId,
      ...(await cash(f.book, amountMinor, "2026-10-03")),
    },
    Settlement.SettlementReview,
  );

  const approval = await post(
    f.approver ?? f.reviewer,
    `/payroll/settlement-reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Settlement.SettlementApproval,
  );

  return post(
    f.book,
    `/payroll/settlement-reviews/${review.id}/executions`,
    { reviewDigest: review.digest, approvalId: approval.id },
    Settlement.SettlementExecution,
  );
}
