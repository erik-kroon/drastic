import * as P from "@open-erp/contracts/payroll-calculations";
import * as Foundation from "@open-erp/contracts/payroll-foundation";
import * as Profiles from "@open-erp/contracts/company-profiles";
import type * as Runs from "@open-erp/contracts/payroll-runs";
import { database, evidence, fixture, post } from "./fixtures";

const rounding = { mode: "half_up", scale: 0 } as const;

const profile: typeof P.PayrollRuleRelease.Type = {
  calculatorVersion: P.SupportedCalculatorVersion,
  cashProrationPolicy: "none",
  supportedWorkPatterns: ["monthly_salaried"],
  withholdingRules: [
    {
      kind: "fixed_amount",
      ruleId: "synthetic_withholding",
      frequency: "monthly",
      amountMinor: "900000",
      sourceReference: "Independent synthetic H900000",
    },
  ],
  benefitBaseMappings: [],
  obligationProfiles: [
    {
      profileId: "synthetic_contribution",
      obligationKind: "employer_contribution",
      aggregationPeriod: "per_calendar_month",
      eligibleStatusClasses: ["synthetic"],
      minimumAgeOnPaymentOn: null,
      maximumAgeOnPaymentOn: null,
      obligationReference: "synthetic_contribution",
      bands: [{ lowerMinor: "0", upperMinor: null, rate: { numerator: "1", denominator: "10" } }],
      rounding,
      sourceReference: "Independent synthetic C300000 on G3000000",
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
  sourceManifest: "DRA-140 synthetic arithmetic only, no statutory qualification",
};

export async function payrollFixture(
  employeeCount = 1,
  reimbursementMinor = "0",
  options: {
    jurisdiction?: string;
    employeeName?: string;
    bookName?: string;
    releaseId?: string;
    contributionRate?: { numerator: string; denominator: string };
    salaryMinor?: string;
    deductionMinor?: string;
    period?: { startsOn: string; endsOn: string };
  } = {},
) {
  const jurisdiction = options.jurisdiction ?? "QZ";
  const period = options.period ?? { startsOn: "2026-01-01", endsOn: "2026-01-31" };

  const book = await fixture(
    [
      { id: "salary_expense", code: "7010", name: "Synthetic salary expense" },
      { id: "reimbursement_expense", code: "7390", name: "Synthetic reimbursement" },
      { id: "salary_liability", code: "2910", name: "Synthetic net salary liability" },
      { id: "withholding_liability", code: "2710", name: "Synthetic withholding provision" },
      { id: "contribution_expense", code: "7510", name: "Synthetic contribution expense" },
      { id: "contribution_liability", code: "2731", name: "Synthetic contribution provision" },
      { id: "deduction_destination", code: "2890", name: "Synthetic deduction liability" },
    ],
    undefined,
    options.bookName ? { bookName: options.bookName } : undefined,
  );

  const independent = await fixture();
  const reviewer = { ...book, actorId: independent.actorId, token: independent.token };
  const source = await evidence(book);
  const admin = await database();
  const releaseId = options.releaseId ?? "payroll_runs_synthetic_qz_v1";
  const checksum = `sha256:${"b".repeat(64)}`;

  try {
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, reviewer.actorId],
    );
    await admin.query(
      "insert into openerp.rule_releases(id,jurisdiction,family,version,checksum,body) values($1,$4,'payroll',1,$2,$3) on conflict(id) do nothing",
      [
        releaseId,
        checksum,
        {
          id: releaseId,
          jurisdiction,
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
          calculatorVersion: P.SupportedCalculatorVersion,
          rounding: { mode: "half_up", scale: 2 },
          validFrom: "2026-01-01",
          validTo: "2026-12-31",
          sourceManifest: "Synthetic QZ payroll run E2E only",
          qualificationStatus: "reviewed",
          recordClasses: ["synthetic"],
          payroll: {
            ...profile,
            obligationProfiles: profile.obligationProfiles.map((row) => ({
              ...row,
              bands: row.bands.map((band) => ({
                ...band,
                rate: options.contributionRate ?? band.rate,
              })),
            })),
          },
        },
        jurisdiction,
      ],
    );
  } finally {
    await admin.end();
  }

  const fact = await post(
    book,
    "/company-facts",
    {
      factKind: "jurisdiction",
      value: { state: "known", value: jurisdiction },
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      supersedesId: null,
      evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
      note: "Synthetic payroll jurisdiction",
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
  await post(
    book,
    "/payroll/access",
    { actorId: book.actorId, allowed: true },
    Foundation.PayrollAccessResult,
  );
  const calculations = [];

  const revisionInputs: Array<
    Extract<typeof Foundation.CapturePayrollRevision.Type, { kind: "employment" }>
  > = [];

  const revisions: Array<typeof Foundation.PayrollRevision.Type> = [];

  for (let ordinal = 0; ordinal < employeeCount; ordinal += 1) {
    const employeeId = `synthetic_employee_${ordinal}`;

    const employmentInput = {
      employeeId,
      kind: "employment",
      effectiveOn: "2026-01-01",
      supersedes: null,
      evidenceId: source.id,
      body: {
        personRef: options.employeeName ?? "SYNTHETIC PERSON ORIGINAL",
        jurisdiction,
        residency: "Synthetic",
        payTerms: "Synthetic monthly salary",
        workSchedule: "Synthetic monthly",
        taxFacts: "Synthetic fixed withholding",
      },
    } as const;

    const employment = await post(
      book,
      "/payroll/revisions",
      employmentInput,
      Foundation.PayrollRevision,
    );

    const work = await post(
      book,
      "/payroll/revisions",
      {
        employeeId,
        kind: "work",
        effectiveOn: "2026-01-01",
        supersedes: null,
        evidenceId: source.id,
        body: {
          periodStart: period.startsOn,
          periodEnd: period.endsOn,
          inputs: ["Synthetic full month"],
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
        effectiveOn: "2026-01-01",
        supersedes: null,
        evidenceId: source.id,
        body: { asOf: "2026-01-01", balanceMinor: "0", obligation: "synthetic_contribution" },
      },
      Foundation.PayrollRevision,
    );

    const calculation = await post(
      book,
      "/payroll/calculations",
      {
        recordClass: "synthetic",
        employment: {
          employeeId,
          effectiveRevision: employment.id,
          monthlyCashSalary: options.salaryMinor ?? "3000000",
          workPattern: "monthly_salaried",
          withholding: {
            ruleId: "synthetic_withholding",
            tableColumn: null,
            taxStatus: "synthetic",
            evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
          },
          grossAdjustments: [],
          reimbursements:
            reimbursementMinor === "0"
              ? []
              : [
                  {
                    componentId: "synthetic_reimbursement",
                    minor: reimbursementMinor,
                    description: "Synthetic new reimbursement",
                    evidence: { evidenceId: source.id, sha256: source.sha256 },
                    treatment: "non_taxable_reimbursement",
                  },
                ],
          benefitComponents: [],
          deductionComponents: [
            {
              componentId: "synthetic_deduction",
              minor: options.deductionMinor ?? "10000",
              description: "Synthetic post-tax deduction",
              destinationRole: "owner",
              reducesBenefit: null,
            },
          ],
          holidayPolicy: {
            state: "evidenced_not_applicable",
            evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
          },
          pensionAndOtherObligations: [
            {
              state: "applicable",
              selection: {
                profileId: "synthetic_contribution",
                obligationReference: "synthetic_contribution",
                statusClass: "synthetic",
                ageOnPaymentOn: 30,
                evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
              },
            },
          ],
        },
        work: {
          effectiveRevision: work.id,
          earningsPeriod: period,
          expectedPaymentOn: period.endsOn,
          absence: [],
          adjustments: [],
          reimbursements: [],
          evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
        },
        reason: "Independent synthetic G3000000 H900000 D10000 C300000",
      },
      P.PayrollCalculation,
    );

    calculations.push(calculation);
    revisionInputs.push(employmentInput);
    revisions.push(employment);
  }

  const calculation = calculations[0];

  if (!calculation) throw new Error("Missing synthetic calculation");

  const input: typeof Runs.PreparePayrollRun.Type = {
    calculationIds: calculations.map((row) => row.id),
    accountingPeriodId: "period_2026",
    postingDate: period.endsOn,
    evidenceId: source.id,
    series: "L",
    reason: "Synthetic payroll run accrual",
    roles: {
      salaryExpenseAccountId: "salary_expense",
      reimbursementExpenseAccountId: "reimbursement_expense",
      netPayLiabilityAccountId: "salary_liability",
      withholdingLiabilityAccountId: "withholding_liability",
      employerContributionExpenseAccountId: "contribution_expense",
      employerContributionLiabilityAccountId: "contribution_liability",
      deductions: [{ roleKind: "owner", accountId: "deduction_destination" }],
      accruals: [],
    },
  };

  return {
    book,
    source,
    fact,
    reviewer,
    calculation,
    calculations,
    input,
    reviseEmployment: async () => {
      const previous = revisions[0];
      const prior = revisionInputs[0];

      if (!previous || !prior) throw new Error("Missing synthetic employment");

      return post(
        book,
        "/payroll/revisions",
        {
          ...prior,
          supersedes: previous.id,
          body: { ...prior.body, personRef: options.employeeName ?? "SYNTHETIC PERSON CHANGED" },
        },
        Foundation.PayrollRevision,
      );
    },
  };
}
