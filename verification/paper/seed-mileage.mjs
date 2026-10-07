import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { assetClients } from "./asset-fixture-clients.mjs";

export const mileageAccounts = [
  { id: "mileage_exempt", code: "7330", name: "Bilersättningar, skattefria" },
  { id: "mileage_taxable", code: "7331", name: "Bilersättningar, skattepliktiga" },
  { id: "mileage_liability", code: "2821", name: "Skuld för milersättning" },
  { id: "mileage_taxable_liability", code: "2822", name: "Skuld för skattepliktig milersättning" },
  { id: "mileage_receivable", code: "1610", name: "Fordran på anställd" },
  { id: "mileage_salary", code: "7010", name: "Löner" },
  { id: "mileage_net_pay", code: "2910", name: "Löneskuld" },
  { id: "mileage_withholding", code: "2710", name: "Avdragen skatt" },
  { id: "mileage_contribution", code: "7510", name: "Arbetsgivaravgifter" },
  { id: "mileage_contribution_liability", code: "2731", name: "Skuld för arbetsgivaravgifter" },
  { id: "mileage_deduction", code: "2890", name: "Syntetiskt löneavdrag" },
];

function pdf(lines) {
  const stream = `BT /F1 12 Tf 30 250 Td ${lines.map((line, index) => `${index ? "0 -18 Td " : ""}(${line.replace(/[()\\]/g, "\\$&")}) Tj`).join("\n")} ET`;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 450 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets = [];

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const start = Buffer.byteLength(body);

  return `${body}xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
}

export async function seedMileage(config) {
  const clients = await assetClients(config);
  const { book, author, reviewer, post } = clients;
  const employeeId = "employee_anders_berg";

  const source = await post(reviewer, "/evidence", {
    title: "R41 independently specified synthetic payroll",
    content:
      "Salary4200100, withholding900000, deduction10000, contribution3142/10000. Original mileage51600, exempt43000, taxable8600. Original payable3341700, contribution1322374. Revised payable3335100, contribution1322028.",
    mediaType: "text/plain",
    origin: "R41 local synthetic fixture, no statutory qualification",
  });

  await post(book, "/payroll/access", { actorId: config.fixture.actor.id, allowed: true });
  await post(book, "/payroll/access", { actorId: "paper_asset_reviewer", allowed: true });

  const rounding = { mode: "half_up", scale: 0 };

  const profile = {
    calculatorVersion: "payroll-regular-v1",
    cashProrationPolicy: "none",
    paymentTimingPolicy: {
      kind: "in_earnings_month",
      sourceReference: "Synthetic reviewed full-month September salary payable25September",
    },
    supportedWorkPatterns: ["monthly_salaried"],
    withholdingRules: [
      {
        kind: "fixed_amount",
        ruleId: "r41_withholding",
        frequency: "monthly",
        amountMinor: "900000",
        sourceReference: "R41 independent synthetic fixed withholding",
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
        sourceReference: "R41 independent synthetic contribution rate",
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
    sourceManifest: "R41 synthetic arithmetic only, not a statutory release",
  };

  const releaseId = "r41_synthetic_payroll_qz_v1";
  const checksum = `sha256:${createHash("sha256").update(JSON.stringify(profile)).digest("hex")}`;

  const { Client } = createRequire(
    join(resolve(import.meta.dirname, "../../apps/api"), "package.json"),
  )("pg");

  const admin = new Client({ connectionString: config.adminUrl });

  await admin.connect();

  try {
    await admin.query(
      "insert into openerp.rule_releases(id,jurisdiction,family,version,checksum,body) values($1,'QZ','payroll',1,$2,$3)",
      [
        releaseId,
        checksum,
        {
          id: releaseId,
          jurisdiction: "QZ",
          family: "payroll",
          version: 1,
          checksum,
          applicability: {
            legalForms: [],
            accountingMethods: [],
            vatRegistrations: [],
            payrollRegistrations: [],
          },
          requiredFactKinds: [],
          requiredRoleKinds: [],
          calculatorVersion: "payroll-regular-v1",
          rounding: { mode: "half_up", scale: 2 },
          validFrom: "2026-01-01",
          validTo: "2026-12-31",
          sourceManifest: "R41 isolated synthetic payroll qualification",
          qualificationStatus: "reviewed",
          recordClasses: ["synthetic"],
          payroll: profile,
        },
      ],
    );
  } finally {
    await admin.end();
  }

  const fact = await post(reviewer, "/company-facts", {
    factKind: "jurisdiction",
    value: { state: "known", value: "QZ" },
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    supersedesId: null,
    evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
    note: "R41 synthetic jurisdiction",
  });

  await post(author, `/company-facts/${fact.id}/reviews`, {
    factRevisionId: fact.id,
    expectedDigest: fact.digest,
    result: "confirmed",
    rationale: "Independent review of synthetic R41 qualification",
  });

  const employment = await post(reviewer, "/payroll/revisions", {
    employeeId,
    kind: "employment",
    effectiveOn: "2026-09-01",
    supersedes: null,
    evidenceId: source.id,
    body: {
      personRef: "Anders Berg",
      jurisdiction: "QZ",
      residency: "Synthetic",
      payTerms: "Synthetic monthly salary",
      workSchedule: "Synthetic full month",
      taxFacts: "Synthetic fixed withholding",
    },
  });

  const work = await post(reviewer, "/payroll/revisions", {
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
  });

  await post(reviewer, "/payroll/revisions", {
    employeeId,
    kind: "opening",
    effectiveOn: "2026-09-01",
    supersedes: null,
    evidenceId: source.id,
    body: { asOf: "2026-09-01", balanceMinor: "0", obligation: "r41_contribution" },
  });

  async function retain(filename, lines) {
    const content = pdf(lines);

    const occurrence = await post(reviewer, "/source-occurrences", {
      sourceSystem: "paper_mileage",
      sourceAccountId: employeeId,
      occurrenceKey: filename,
      sourceRevision: "1",
      filename,
      mediaType: "application/pdf",
      contentBase64: Buffer.from(content).toString("base64"),
    });

    const evidence = await post(reviewer, "/evidence", {
      title: filename,
      content,
      mediaType: "text/plain",
      origin: "R41 exact ASCII serialization of retained synthetic PDF",
    });

    if (occurrence.sha256 !== `sha256:${evidence.sha256}`)
      throw new Error("R41 original/evidence bytes differ");

    return { occurrence, evidence };
  }

  const original = await retain("Ruttkontroll 12 sep.pdf", [
    "Synthetic route review",
    "MIL-2026-0012, Anders Berg",
    "12 Sep 2026, Ostersund to Sundsvall",
    "Distance: 172 km",
  ]);

  const revised = await retain("Ruttkontroll 3 okt.pdf", [
    "Independent synthetic route review",
    "MIL-2026-0012, Anders Berg",
    "3 Oct 2026, Ostersund to Sundsvall",
    "Corrected distance: 150 km",
  ]);

  const basis = await retain("Intyg Anders Berg 3 okt.pdf", [
    "Independent synthetic employee attestation",
    "Anders Berg, 3 Oct 2026",
    "First route distance was incorrect",
    "Corrected distance: 150 km",
  ]);

  const trip = {
    id: "mil_2026_0012",
    reference: "MIL-2026-0012",
    claimantId: employeeId,
    businessPurpose: "Syntetiskt kundbesök",
    departureOn: "2026-09-12",
    arrivalOn: "2026-09-12",
    routeEvidenceRef: original.evidence.id,
    routeReviewed: true,
    origin: "Östersund",
    destination: "Sundsvall",
    distanceInMeters: "172000",
    vehicleIdentity: "r41_private_car",
    ownershipKind: "private_car",
    fuelPayer: "employee",
    previousRevision: null,
  };

  const input = await post(reviewer, "/payroll/inputs", {
    employeeId,
    month: "2026-09",
    recordClass: "synthetic",
    economicKey: "r41_original_mileage",
    evidence: { evidenceId: original.evidence.id, sha256: original.evidence.sha256 },
    purpose: trip.businessPurpose,
    accountingPeriodId: config.fixture.periods[0].id,
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
      expenseAccountId: "mileage_exempt",
      taxableExpenseAccountId: "mileage_taxable",
      taxableLiabilityAccountId: "mileage_taxable_liability",
    },
  });

  const recognition = await post(reviewer, `/payroll/inputs/${input.id}/reviews`, {
    inputDigest: input.digest,
  });

  const recognitionApproval = await post(
    author,
    `/payroll/input-reviews/${recognition.id}/approvals`,
    { reviewDigest: recognition.digest },
  );

  await post(reviewer, `/payroll/input-reviews/${recognition.id}/executions`, {
    reviewDigest: recognition.digest,
    approvalId: recognitionApproval.id,
  });

  const reference = { evidenceId: source.id, sha256: source.sha256 };

  const calculation = await post(reviewer, "/payroll/calculations", {
    recordClass: "synthetic",
    inputIds: [input.id],
    employment: {
      employeeId,
      effectiveRevision: employment.id,
      monthlyCashSalary: "4200100",
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
    reason: "R41 independently specified September payroll",
  });

  if (
    calculation.calculation.payableMinor !== "3341700" ||
    calculation.calculation.employerContributionMinor !== "1322374"
  )
    throw new Error("R41 original payroll differs from independent expectations");

  const run = await post(reviewer, "/payroll/runs", {
    calculationIds: [calculation.id],
    accountingPeriodId: config.fixture.periods[0].id,
    postingDate: "2026-09-25",
    evidenceId: source.id,
    series: "L",
    reason: "Synthetic September payroll containing retained mileage",
    roles: {
      salaryExpenseAccountId: "mileage_salary",
      reimbursementExpenseAccountId: "mileage_exempt",
      netPayLiabilityAccountId: "mileage_net_pay",
      withholdingLiabilityAccountId: "mileage_withholding",
      employerContributionExpenseAccountId: "mileage_contribution",
      employerContributionLiabilityAccountId: "mileage_contribution_liability",
      deductions: [{ roleKind: "owner", accountId: "mileage_deduction" }],
      accruals: [],
    },
  });

  const runApproval = await post(author, `/payroll/runs/${run.id}/approvals`, {
    runDigest: run.digest,
  });

  const runExecution = await post(reviewer, `/payroll/runs/${run.id}/executions`, {
    runDigest: run.digest,
    approvalId: runApproval.id,
  });

  for (const document of runExecution.payslips)
    await post(reviewer, `/payroll/payslips/${document.id}/renders`, {
      documentDigest: document.digest,
    });

  const declaration = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: "r41_salary_payment",
    sourceBankAccountId: "r41_synthetic_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-09-25",
    endsOn: "2026-09-25",
    openingMinor: "10000000",
    closingMinor: "6658300",
    completeness: { declaredComplete: true, basis: "Independent synthetic September payment" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: "r41_paid_salary_row",
        date: "2026-09-25",
        description: "Synthetic Anders Berg paid salary",
        amountMinor: "-3341700",
      },
    ],
  };

  const cashEvidence = await post(reviewer, "/evidence", {
    title: "R41 observed synthetic salary payment",
    content: JSON.stringify(declaration),
    mediaType: "application/json",
    origin: "Independent synthetic bank observation",
  });

  const statement = await post(reviewer, "/bank-statements", {
    ...declaration,
    evidenceId: cashEvidence.id,
    existingMatches: [],
  });

  const payment = await post(reviewer, "/payroll/settlement-reviews", {
    kind: "payment",
    runId: run.id,
    employeeId,
    payeeEvidenceId: source.id,
    statementId: statement.statement.id,
    rowOrdinal: 1,
    bankAccountId: "account_bank",
    evidenceId: cashEvidence.id,
    accountingPeriodId: config.fixture.periods[0].id,
    postingDate: "2026-09-25",
    series: "L",
    reason: "Independent synthetic observed payroll payment",
  });

  const paymentApproval = await post(
    author,
    `/payroll/settlement-reviews/${payment.id}/approvals`,
    { reviewDigest: payment.digest },
  );

  await post(reviewer, `/payroll/settlement-reviews/${payment.id}/executions`, {
    reviewDigest: payment.digest,
    approvalId: paymentApproval.id,
  });
  await post(reviewer, "/payroll/periods", { reportingPeriod: "2026-09", evidenceId: source.id });

  const proposal = await post(reviewer, "/payroll/mileage-corrections", {
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
    recoveryReason: "Felaktig sträcka i första ruttkontrollen, intygad av Anders Berg 3 okt",
    recoveryReceivableAccountId: "mileage_receivable",
    accountingPeriodId: config.fixture.periods[0].id,
    postingDate: "2026-10-03",
    series: "L",
  });

  if (!proposal.comparison) throw new Error("R41 qualified paid proposal has no comparison");

  const lawfulBasis = await post(author, "/payroll/adjustment-bases", {
    comparisonId: proposal.comparison.paidComparisonId,
    kind: "gross_recovery",
    evidenceId: basis.evidence.id,
    reason: proposal.sources.recoveryReason,
  });

  const ready = await post(
    reviewer,
    `/payroll/mileage-corrections/${proposal.proposal.id}/reviews`,
    { proposalDigest: proposal.proposal.digest, lawfulBasisId: lawfulBasis.id },
  );

  if (
    !ready.current.canSubmit ||
    ready.execution !== null ||
    ready.submissions.length ||
    ready.comparison?.entitlementDeltaMinor !== "-6600" ||
    ready.comparison.contributionCorrectionMinor !== "-346"
  )
    throw new Error("R41 fixture must stop at exact pending submission");

  const artifact = join(config.artifacts, "mileage-fixture.json");

  await writeFile(
    artifact,
    JSON.stringify(
      {
        synthetic: true,
        proposalId: ready.proposal.id,
        originalInputId: input.id,
        originalRunId: run.id,
        revisedRouteId: revised.occurrence.id,
        submitted: false,
        executed: false,
      },
      null,
      2,
    ),
  );

  return { seeded: true, proposalId: ready.proposal.id, artifact };
}
