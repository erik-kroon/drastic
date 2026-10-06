import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

export const payrollAccounts = [
  { id: "paper_salary_expense", code: "7010", name: "Synthetic salary expense" },
  { id: "paper_reimbursement_expense", code: "7390", name: "Synthetic reimbursement expense" },
  { id: "paper_salary_liability", code: "2910", name: "Synthetic salary liability" },
  { id: "paper_withholding_liability", code: "2710", name: "Synthetic withholding provision" },
  { id: "paper_contribution_expense", code: "7510", name: "Synthetic contribution expense" },
  { id: "paper_contribution_liability", code: "2731", name: "Synthetic contribution provision" },
];

const employees = [
  {
    id: "paper_anders",
    name: "Anders Berg",
    gross: "4200000",
    withheld: "1008000",
    net: "3192000",
    contribution: "1319640",
    rule: "paper_anders_withholding",
  },
  {
    id: "paper_maja",
    name: "Maja Holm",
    gross: "3600000",
    withheld: "810000",
    net: "2790000",
    contribution: "1131120",
    rule: "paper_maja_withholding",
  },
];

const rounding = { mode: "half_up", scale: 0 };

function requireLocal(value, protocol) {
  const url = new URL(value);

  if (url.hostname !== "127.0.0.1" || url.protocol !== protocol)
    throw new Error("Payroll fixture requires the disposable local runtime");

  return url;
}

async function registers(admin, bookId) {
  return (
    await admin.query(
      `select
      (select count(*)::int from openerp.vouchers where book_id=$1) vouchers,
      (select count(*)::int from openerp.payroll_run_executions where book_id=$1) executions,
      (select count(*)::int from openerp.payroll_run_obligations where book_id=$1) obligations,
      (select count(*)::int from openerp.payroll_earning_reservations where book_id=$1) earnings,
      (select count(*)::int from openerp.payroll_month_reservations where book_id=$1) months,
      (select count(*)::int from openerp.payroll_payslip_documents where book_id=$1) documents,
      (select count(*)::int from openerp.outbox where book_id=$1 and kind='payroll.payslip.render_requested') intents`,
      [bookId],
    )
  ).rows[0];
}

export async function seedPayroll(config) {
  const { apiUrl, adminUrl, accessToken, fixture } = config;
  const origin = requireLocal(apiUrl, "http:");
  requireLocal(adminUrl, "postgresql:");

  if (fixture.entity.id !== "entity_synthetic" || fixture.book.id !== "book_synthetic")
    throw new Error("Payroll fixture requires the launcher's synthetic book");

  const scope = `/api/v1/entities/${fixture.entity.id}/books/${fixture.book.id}`;

  const { Client } = createRequire(
    join(resolve(import.meta.dirname, "../../apps/api"), "package.json"),
  )("pg");

  const admin = new Client({ connectionString: adminUrl });
  const reviewerId = "actor_paper_payroll_reviewer";
  const reviewerToken = randomBytes(32).toString("hex");
  const releaseId = "paper_payroll_synthetic_qz_v1";
  const checksum = `sha256:${"c".repeat(64)}`;

  async function call(path, input, token = accessToken) {
    const response = await fetch(`${origin.origin}${scope}${path}`, {
      method: input ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: input ? JSON.stringify(input) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    const result = await response.json();

    if (!response.ok)
      throw new Error(
        `Payroll fixture ${path} refused ${response.status} ${result.code ?? "UnknownError"}`,
      );

    return result;
  }

  await admin.connect();

  try {
    await call("/payroll/access", { actorId: fixture.actor.id, allowed: true });
    const existing = await call("/payroll/runs");

    if (existing.items.length || existing.next)
      throw new Error("Payroll fixture requires a fresh book without payroll runs");

    const before = await registers(admin, fixture.book.id);

    if (Object.values(before).some((value) => value !== 0))
      throw new Error("Payroll fixture requires empty financial consequence registers");

    await admin.query(
      "insert into openerp.actors(id,name) values($1,'Synthetic payroll reviewer')",
      [reviewerId],
    );
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [fixture.book.id, reviewerId],
    );
    await admin.query(
      "insert into openerp.credentials(token_hash,actor_id,expires_at) values($1,$2,now()+interval '1 day')",
      [createHash("sha256").update(reviewerToken).digest("hex"), reviewerId],
    );
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
          sourceManifest: "Disposable synthetic QZ Paper amounts, no statutory qualification",
          qualificationStatus: "reviewed",
          recordClasses: ["synthetic"],
          payroll: {
            calculatorVersion: "payroll-regular-v1",
            cashProrationPolicy: "none",
            supportedWorkPatterns: ["monthly_salaried"],
            withholdingRules: employees.map((employee) => ({
              kind: "fixed_amount",
              ruleId: employee.rule,
              frequency: "monthly",
              amountMinor: employee.withheld,
              sourceReference: "Synthetic Paper literal withholding",
            })),
            benefitBaseMappings: [],
            obligationProfiles: [
              {
                profileId: "paper_contribution",
                obligationKind: "employer_contribution",
                aggregationPeriod: "per_calendar_month",
                eligibleStatusClasses: ["synthetic"],
                minimumAgeOnPaymentOn: null,
                maximumAgeOnPaymentOn: null,
                obligationReference: "paper_contribution",
                bands: [
                  {
                    lowerMinor: "0",
                    upperMinor: null,
                    rate: { numerator: "3142", denominator: "10000" },
                  },
                ],
                rounding,
                sourceReference: "Synthetic Paper literal contribution rate",
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
            sourceManifest: "Paper UI arithmetic fixture only",
          },
        },
      ],
    );

    const source = await call("/evidence", {
      title: "Synthetic October payroll",
      content: JSON.stringify({ synthetic: true, employees }),
      mediaType: "application/json",
      origin: "Disposable Paper payroll fixture",
    });

    const fact = await call("/company-facts", {
      factKind: "jurisdiction",
      value: { state: "known", value: "QZ" },
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      supersedesId: null,
      evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
      note: "Synthetic QZ payroll jurisdiction",
    });

    const review = await call(
      `/company-facts/${fact.id}/reviews`,
      {
        factRevisionId: fact.id,
        expectedDigest: fact.digest,
        result: "confirmed",
        rationale: "Independent confirmation of synthetic Paper jurisdiction",
      },
      reviewerToken,
    );

    const calculations = [];

    for (const employee of employees) {
      const employment = await call("/payroll/revisions", {
        employeeId: employee.id,
        kind: "employment",
        effectiveOn: "2026-10-01",
        supersedes: null,
        evidenceId: source.id,
        body: {
          personRef: employee.name,
          jurisdiction: "QZ",
          residency: "Synthetic",
          payTerms: "Synthetic monthly salary",
          workSchedule: "Synthetic full month",
          taxFacts: "Synthetic fixed withholding",
        },
      });

      const work = await call("/payroll/revisions", {
        employeeId: employee.id,
        kind: "work",
        effectiveOn: "2026-10-01",
        supersedes: null,
        evidenceId: source.id,
        body: {
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
          inputs: ["Synthetic full month"],
        },
      });

      await call("/payroll/revisions", {
        employeeId: employee.id,
        kind: "opening",
        effectiveOn: "2026-10-01",
        supersedes: null,
        evidenceId: source.id,
        body: { asOf: "2026-10-01", balanceMinor: "0", obligation: "paper_contribution" },
      });

      const calculation = await call("/payroll/calculations", {
        recordClass: "synthetic",
        employment: {
          employeeId: employee.id,
          effectiveRevision: employment.id,
          monthlyCashSalary: employee.gross,
          workPattern: "monthly_salaried",
          withholding: {
            ruleId: employee.rule,
            tableColumn: null,
            taxStatus: "synthetic",
            evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
          },
          grossAdjustments: [],
          reimbursements: [],
          benefitComponents: [],
          deductionComponents: [],
          holidayPolicy: {
            state: "evidenced_not_applicable",
            evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
          },
          pensionAndOtherObligations: [
            {
              state: "applicable",
              selection: {
                profileId: "paper_contribution",
                obligationReference: "paper_contribution",
                statusClass: "synthetic",
                ageOnPaymentOn: 30,
                evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
              },
            },
          ],
        },
        work: {
          effectiveRevision: work.id,
          earningsPeriod: { startsOn: "2026-10-01", endsOn: "2026-10-31" },
          expectedPaymentOn: "2026-10-31",
          absence: [],
          adjustments: [],
          reimbursements: [],
          evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
        },
        reason: "Synthetic Paper retained October payroll amounts",
      });

      const actual = calculation.calculation;

      if (
        actual.grossMinor !== employee.gross ||
        actual.withholdingMinor !== employee.withheld ||
        actual.payableMinor !== employee.net ||
        actual.employerContributionMinor !== employee.contribution ||
        actual.cashReimbursementMinor !== "0" ||
        actual.netDeductionMinor !== "0"
      )
        throw new Error(`Stored synthetic calculation totals changed for ${employee.id}`);

      calculations.push(calculation);
    }

    const run = await call("/payroll/runs", {
      calculationIds: calculations.map((calculation) => calculation.id),
      accountingPeriodId: fixture.periods[0].id,
      postingDate: "2026-10-31",
      evidenceId: source.id,
      series: "L",
      reason: "Synthetic Paper October payroll accrual",
      roles: {
        salaryExpenseAccountId: "paper_salary_expense",
        reimbursementExpenseAccountId: "paper_reimbursement_expense",
        netPayLiabilityAccountId: "paper_salary_liability",
        withholdingLiabilityAccountId: "paper_withholding_liability",
        employerContributionExpenseAccountId: "paper_contribution_expense",
        employerContributionLiabilityAccountId: "paper_contribution_liability",
        deductions: [],
        accruals: [],
      },
    });

    const retained = await call(`/payroll/runs/${run.id}`);
    const after = await registers(admin, fixture.book.id);

    if (retained.execution !== null || JSON.stringify(after) !== JSON.stringify(before))
      throw new Error("Prepared payroll fixture created financial consequences");

    const sums = calculations.reduce(
      (totals, calculation) => {
        const actual = calculation.calculation;

        return {
          gross: totals.gross + BigInt(actual.grossMinor),
          withheld: totals.withheld + BigInt(actual.withholdingMinor),
          net: totals.net + BigInt(actual.payableMinor),
          contribution: totals.contribution + BigInt(actual.employerContributionMinor),
        };
      },
      { gross: 0n, withheld: 0n, net: 0n, contribution: 0n },
    );

    if (
      sums.gross !== 7800000n ||
      sums.withheld !== 1818000n ||
      sums.net !== 5982000n ||
      sums.contribution !== 2450760n
    )
      throw new Error("Synthetic payroll aggregate totals changed");

    const artifact = join(config.artifacts, "payroll-seed.json");
    await writeFile(
      artifact,
      JSON.stringify(
        {
          synthetic: true,
          sourceId: source.id,
          factId: fact.id,
          review: {
            factRevisionId: review.factRevisionId,
            reviewer: review.reviewer,
            digest: review.digest,
          },
          calculations,
          run: retained.run,
          registers: after,
          approved: false,
          executed: false,
        },
        null,
        2,
      ),
    );

    return { seeded: true, runId: run.id, artifact };
  } finally {
    await admin.end();
  }
}
