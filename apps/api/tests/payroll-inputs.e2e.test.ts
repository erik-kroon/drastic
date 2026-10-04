import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Inputs from "@open-erp/contracts/payroll-inputs";
import * as Calculations from "@open-erp/contracts/payroll-calculations";
import * as Runs from "@open-erp/contracts/payroll-runs";
import * as Accounting from "@open-erp/contracts/accounting";
import { database, decoded, environment, failure, key, post, request } from "./support/fixtures";
import { payrollFixture } from "./support/payroll-runs";

async function inputsFixture() {
  const fixture = await payrollFixture();
  const admin = await database();

  try {
    for (const [id, code] of [
      ["claim_expense", "6110"],
      ["claim_vat", "2641"],
      ["claim_liability", "2820"],
      ["mileage_expense", "7330"],
      ["mileage_taxable", "7331"],
      ["mileage_liability", "2821"],
      ["holiday_expense", "7090"],
      ["holiday_liability", "2920"],
      ["holiday_social", "2940"],
      ["holiday_social_expense", "7519"],
    ]) {
      await admin.query(
        "insert into openerp.accounts(book_id,id,code,name,active) values($1,$2,$3,$2,true)",
        [fixture.book.bookId, id, code],
      );
    }
  } finally {
    await admin.end();
  }

  const common = {
    employeeId: fixture.calculation.employeeId,
    month: "2026-01",
    recordClass: "synthetic" as const,
    evidence: { evidenceId: fixture.source.id, sha256: fixture.source.sha256 },
    purpose: "Synthetic employee business expense",
    accountingPeriodId: "period_2026",
    postingDate: "2026-01-15",
    series: "L",
    liabilityAccountId: "claim_liability",
  };

  return { ...fixture, common };
}

async function recognize(
  f: Awaited<ReturnType<typeof inputsFixture>>,
  input: typeof Inputs.SubmitPayrollInput.Type,
) {
  const submitted = await post(f.book, "/payroll/inputs", input, Inputs.PayrollInput);

  const review = await post(
    f.book,
    `/payroll/inputs/${submitted.id}/reviews`,
    { inputDigest: submitted.digest },
    Inputs.PayrollInputReview,
  );

  const approval = await post(
    f.book,
    `/payroll/input-reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Inputs.PayrollInputApproval,
  );

  const execution = await post(
    f.book,
    `/payroll/input-reviews/${review.id}/executions`,
    { reviewDigest: review.digest, approvalId: approval.id },
    Inputs.PayrollInputExecution,
  );

  return { submitted, review, approval, execution };
}

function exampleClaim(
  f: Awaited<ReturnType<typeof inputsFixture>>,
): typeof Inputs.SubmitPayrollInput.Type {
  return {
    ...f.common,
    economicKey: "receipt-one",
    basis: {
      kind: "claim",
      paidBy: "employee",
      counterpartyId: "synthetic_receipt_vendor",
      supplierDocumentNumber: "SYNTHETIC-R1",
      inputVatAccountId: "claim_vat",
      line: {
        sourceLineId: "receipt_line",
        expenseAccountId: "claim_expense",
        netMinor: "10000",
        sourceTaxMinor: "2500",
        sourceGrossMinor: "12500",
        treatment: {
          treatmentId: "synthetic_full",
          rate: { numerator: "1", denominator: "4" },
          deduction: { numerator: "1", denominator: "1" },
          invoiceTaxRounding: "half_up",
          deductionRounding: "half_up",
          acceptancePolicy: "exact_match",
          toleranceMinor: "0",
          basis: "Synthetic full deduction",
        },
        sourceRefs: [{ evidenceId: f.source.id, sourceKey: "receipt-one" }],
      },
    },
  };
}

async function prepareInputRun(
  f: Awaited<ReturnType<typeof inputsFixture>>,
  ids: ReadonlyArray<string>,
) {
  const calculation = await post(
    f.book,
    "/payroll/calculations",
    { ...f.calculation.basis.reviewedInput, inputIds: ids },
    Calculations.PayrollCalculation,
  );

  const run = await post(
    f.book,
    "/payroll/runs",
    { ...f.input, calculationIds: [calculation.id] },
    Runs.PayrollRun,
  );

  return { calculation, run };
}

async function executeInputRun(
  f: Awaited<ReturnType<typeof inputsFixture>>,
  ids: ReadonlyArray<string>,
) {
  const prepared = await prepareInputRun(f, ids);

  const approval = await post(
    f.book,
    `/payroll/runs/${prepared.run.id}/approvals`,
    { runDigest: prepared.run.digest },
    Runs.PayrollRunApproval,
  );

  const execution = await post(
    f.book,
    `/payroll/runs/${prepared.run.id}/executions`,
    { runDigest: prepared.run.digest, approvalId: approval.id },
    Runs.PayrollRunExecution,
  );

  return { ...prepared, approval, execution };
}

async function preparePayment(
  f: Awaited<ReturnType<typeof inputsFixture>>,
  claim: Awaited<ReturnType<typeof recognize>>,
) {
  const payment = await post(
    f.book,
    `/payroll/inputs/${claim.submitted.id}/direct-payments`,
    {
      inputDigest: claim.submitted.digest,
      amountMinor: "5000",
      bankAccountId: "account_bank",
      evidence: f.common.evidence,
      accountingPeriodId: "period_2026",
      postingDate: "2026-01-16",
      series: "L",
    },
    Inputs.PayrollInputReview,
  );

  const approval = await post(
    f.book,
    `/payroll/input-reviews/${payment.id}/approvals`,
    { reviewDigest: payment.digest },
    Inputs.PayrollInputApproval,
  );

  return { payment, approval };
}

test("synthetic mileage retains4500 split and transfers3750 exempt plus750 taxable once", async () => {
  const f = await inputsFixture();

  const input: typeof Inputs.SubmitPayrollInput.Type = {
    ...f.common,
    economicKey: "trip-one",
    basis: {
      kind: "mileage",
      trip: {
        id: "trip_one",
        claimantId: f.common.employeeId,
        businessPurpose: "Synthetic customer visit",
        departureOn: "2026-01-15",
        arrivalOn: "2026-01-15",
        routeEvidenceRef: f.source.id,
        routeReviewed: true,
        origin: "Synthetic origin",
        destination: "Synthetic destination",
        distanceInMeters: "15000",
        vehicleIdentity: "synthetic_vehicle",
        ownershipKind: "private_car",
        fuelPayer: "employee",
        previousRevision: null,
      },
      release: {
        releaseId: "synthetic_mileage",
        distanceUnitMeters: "1000",
        entitlementRateMinorPerUnit: "300",
        taxExemptRateMinorPerUnit: "250",
        requiresVehicleIdentity: true,
        requiresFuelPayer: true,
        evidenceSourceHash: `sha256:${f.source.sha256}`,
      },
      expenseAccountId: "mileage_expense",
      taxableExpenseAccountId: "mileage_taxable",
      taxableLiabilityAccountId: "mileage_liability",
    },
  };

  const award = await recognize(f, input);
  expect(award.review.outputs.mileage).toEqual({
    distanceUnitsNumerator: "15000",
    distanceUnitsDenominator: "1000",
    entitlementMinor: "4500",
    exemptionCeilingMinor: "3750",
    exemptPaidPartMinor: "3750",
    taxablePartMinor: "750",
  });
  const run = await executeInputRun(f, [award.submitted.id]);
  expect(run.calculation.calculation.grossMinor).toBe("3000750");
  expect(run.calculation.calculation.cashReimbursementMinor).toBe("3750");
  expect(run.calculation.calculation.payableMinor).toBe("2094500");
  expect(run.calculation.calculation.employerContributionMinor).toBe("300075");
  const admin = await database();
  let balances;

  try {
    balances = (
      await admin.query(
        "select account_id,sum(debit_minor::numeric-credit_minor::numeric)::text balance from openerp.journal_lines where book_id=$1 and account_id in ('mileage_expense','mileage_taxable','mileage_liability','claim_liability') group by account_id order by account_id",
        [f.book.bookId],
      )
    ).rows;
    expect(balances).toEqual([
      { account_id: "claim_liability", balance: "0" },
      { account_id: "mileage_expense", balance: "3750" },
      { account_id: "mileage_liability", balance: "0" },
      { account_id: "mileage_taxable", balance: "750" },
    ]);
  } finally {
    await admin.end();
  }

  const duplicate = await post(
    f.book,
    "/payroll/inputs",
    { ...input, economicKey: "another-trip-key" },
    Inputs.PayrollInput,
  );

  await failure(
    await request(f.book, `/payroll/inputs/${duplicate.id}/reviews`, {
      method: "POST",
      body: JSON.stringify({ inputDigest: duplicate.digest }),
    }),
    409,
    "AlreadyPosted",
  );
  await writeFile(
    join(environment().artifacts, "payroll-input-mileage-proof.json"),
    JSON.stringify({ input, award, run, balances }, null, 2),
  );
});

test("synthetic hourly75/2 earns75000 with holiday target9000 and reversal1000", async () => {
  const f = await inputsFixture();

  const opening = await post(
    f.book,
    "/change-sets",
    {
      kind: "manual_journal",
      evidenceId: f.source.id,
      eventKey: "holiday_opening",
      accountingPeriodId: "period_2026",
      postingDate: "2026-01-01",
      series: "L",
      description: "Synthetic evidenced holiday opening",
      rationale: "Independent holiday liability10000",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "holiday_expense",
          debitMinor: "10000",
          creditMinor: "0",
          description: "Synthetic holiday opening expense",
        },
        {
          accountId: "holiday_liability",
          debitMinor: "0",
          creditMinor: "10000",
          description: "Synthetic holiday opening liability",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const openingApproval = await post(
    f.book,
    `/change-sets/${opening.id}/approvals`,
    { version: 1, planDigest: opening.planDigest },
    Accounting.Approval,
  );

  await post(
    f.book,
    `/change-sets/${opening.id}/execute`,
    { version: 1, planDigest: opening.planDigest, approvalId: openingApproval.id },
    Accounting.ExecutionReceipt,
  );

  const input: typeof Inputs.SubmitPayrollInput.Type = {
    ...f.common,
    economicKey: "hours-one",
    basis: {
      kind: "variable",
      profile: "synthetic-exact-hourly-v1",
      expenseAccountId: "salary_expense",
      work: [
        {
          sourceId: "timesheet_one",
          kind: "worked",
          unitsMinor: "2250",
          scheduleDate: "2026-01-15",
        },
      ],
      earnings: [
        {
          sourceIdentity: "earning_one",
          componentKind: "cash",
          unitsNumerator: "75",
          unitsDenominator: "2",
          rateMinor: "2000",
          withholdingBase: true,
          contributionBase: true,
          holidayAccrualBase: true,
        },
      ],
      holiday: {
        openingUnitsMinor: "10000",
        openingValueMinor: "10000",
        openingSocialMinor: "0",
        movements: [
          { kind: "earned", unitsMinor: "2000", sourceIdentity: "holiday_earned_one" },
          { kind: "used", unitsMinor: "3000", sourceIdentity: "holiday_used_one" },
        ],
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

  const variable = await recognize(f, input);
  expect(variable.review.outputs.grossMinor).toBe("75000");
  expect(variable.review.outputs.holiday).toEqual({
    unitsMinor: "9000",
    valueMinor: "9000",
    socialTargetMinor: "0",
  });
  expect(variable.review.outputs.holidayMoneyDeltaMinor).toBe("-1000");
  const run = await executeInputRun(f, [variable.submitted.id]);
  expect(run.calculation.calculation.grossMinor).toBe("3075000");
  expect(run.calculation.calculation.payableMinor).toBe("2165000");
  expect(run.calculation.calculation.employerContributionMinor).toBe("307500");
  const admin = await database();
  let balances;

  try {
    balances = (
      await admin.query(
        "select account_id,sum(debit_minor::numeric-credit_minor::numeric)::text balance from openerp.journal_lines where book_id=$1 and account_id in ('salary_expense','holiday_expense','holiday_liability','claim_liability') group by account_id order by account_id",
        [f.book.bookId],
      )
    ).rows;
    expect(balances).toEqual([
      { account_id: "claim_liability", balance: "0" },
      { account_id: "holiday_expense", balance: "9000" },
      { account_id: "holiday_liability", balance: "-9000" },
      { account_id: "salary_expense", balance: "3075000" },
    ]);
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "payroll-input-variable-proof.json"),
    JSON.stringify({ input, variable, run, balances }, null, 2),
  );
});

test("stale allocation refuses retained run and approved run reserves employee month", async () => {
  const f = await inputsFixture();
  const claim = await recognize(f, exampleClaim(f));
  const prepared = await prepareInputRun(f, [claim.submitted.id]);
  const direct = await preparePayment(f, claim);
  await post(
    f.book,
    `/payroll/input-reviews/${direct.payment.id}/executions`,
    { reviewDigest: direct.payment.digest, approvalId: direct.approval.id },
    Inputs.PayrollInputExecution,
  );
  await failure(
    await request(f.book, `/payroll/runs/${prepared.run.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ runDigest: prepared.run.digest }),
    }),
    409,
    "StaleDependency",
  );
  const latest = await prepareInputRun(f, [claim.submitted.id]);

  const competitor = await post(
    f.book,
    "/payroll/runs",
    { ...f.input, calculationIds: [latest.calculation.id] },
    Runs.PayrollRun,
  );

  const approve = (run: typeof Runs.PayrollRun.Type) =>
    request(f.book, `/payroll/runs/${run.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ runDigest: run.digest }),
    });

  const results = await Promise.all([approve(latest.run), approve(competitor)]);
  expect(results.map((row) => row.status).sort((left, right) => left - right)).toEqual([200, 409]);

  for (const response of results) {
    if (response.status === 409) await failure(response, 409, "AlreadyPosted");
    else await decoded(response, Runs.PayrollRunApproval);
  }

  await failure(
    await request(f.book, "/payroll/calculations", {
      method: "POST",
      body: JSON.stringify(f.calculation.basis.reviewedInput),
    }),
    409,
    "AlreadyPosted",
  );
  await failure(
    await request(f.book, `/payroll/inputs/${claim.submitted.id}/direct-payments`, {
      method: "POST",
      body: JSON.stringify({
        inputDigest: claim.submitted.digest,
        amountMinor: "1",
        bankAccountId: "account_bank",
        evidence: f.common.evidence,
        accountingPeriodId: "period_2026",
        postingDate: "2026-01-16",
        series: "L",
      }),
    }),
    409,
    "AlreadyPosted",
  );
  await writeFile(
    join(environment().artifacts, "payroll-input-reservation-proof.json"),
    JSON.stringify({ prepared, direct, latest, competitor, approvalStatuses: [200, 409] }, null, 2),
  );
});

test("input consumption failure rolls back payroll and private grants fence replay and reads", async () => {
  const f = await inputsFixture();
  const claim = await recognize(f, exampleClaim(f));
  const { run } = await prepareInputRun(f, [claim.submitted.id]);

  const approval = await post(
    f.book,
    `/payroll/runs/${run.id}/approvals`,
    { runDigest: run.digest },
    Runs.PayrollRunApproval,
  );

  const executionKey = key();

  const execute = () =>
    request(f.book, `/payroll/runs/${run.id}/executions`, {
      method: "POST",
      headers: { "idempotency-key": executionKey },
      body: JSON.stringify({ runDigest: run.digest, approvalId: approval.id }),
    });

  const admin = await database();
  let before;

  try {
    const counts = async () =>
      (
        await admin.query(
          "select (select count(*)::int from openerp.vouchers where book_id=$1) vouchers,(select count(*)::int from openerp.payroll_run_obligations where book_id=$1) obligations,(select count(*)::int from openerp.payroll_input_consumptions where book_id=$1) consumptions,(select count(*)::int from openerp.payroll_payslip_documents where book_id=$1) documents",
          [f.book.bookId],
        )
      ).rows[0];

    before = await counts();
    await admin.query(
      "CREATE FUNCTION openerp.synthetic_input_write_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic input write fault' USING ERRCODE='23514'; END $$",
    );
    await admin.query(
      "CREATE TRIGGER synthetic_input_write_failure BEFORE INSERT ON openerp.payroll_input_consumptions FOR EACH ROW EXECUTE FUNCTION openerp.synthetic_input_write_failure()",
    );

    try {
      await failure(await execute(), 500, "InternalError");
      expect(await counts()).toEqual(before);
    } finally {
      await admin.query(
        "DROP TRIGGER synthetic_input_write_failure ON openerp.payroll_input_consumptions",
      );
      await admin.query("DROP FUNCTION openerp.synthetic_input_write_failure()");
    }

    const execution = await decoded(await execute(), Runs.PayrollRunExecution);
    expect(execution.employeeObligations.map((row) => row.payableMinor)).toEqual(["2102500"]);
    expect(await counts()).toEqual({ vouchers: 2, obligations: 1, consumptions: 1, documents: 1 });
    await admin.query("delete from openerp.payroll_access where book_id=$1 and actor_id=$2", [
      f.book.bookId,
      f.book.actorId,
    ]);
    await failure(await request(f.book, `/payroll/inputs/${claim.submitted.id}`), 403, "Forbidden");
    await failure(await execute(), 403, "Forbidden");
    await writeFile(
      join(environment().artifacts, "payroll-input-rollback-proof.json"),
      JSON.stringify(
        {
          run,
          approval,
          before,
          execution,
          after: { vouchers: 2, obligations: 1, consumptions: 1, documents: 1 },
          removedPrivateGrant: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await admin.end();
  }
});

test("expired approval releases retained input and monthly reservations without rewriting history", async () => {
  const f = await inputsFixture();
  const claim = await recognize(f, exampleClaim(f));
  const prepared = await prepareInputRun(f, [claim.submitted.id]);

  const approval = await post(
    f.book,
    `/payroll/runs/${prepared.run.id}/approvals`,
    { runDigest: prepared.run.digest },
    Runs.PayrollRunApproval,
  );

  const admin = await database();

  try {
    await admin.query("BEGIN");
    await admin.query("ALTER TABLE openerp.approvals DISABLE TRIGGER posting_approval_consumption");
    await admin.query(
      "update openerp.approvals set expires_at=clock_timestamp()-interval '1 second' where book_id=$1 and id=$2",
      [f.book.bookId, approval.id],
    );
    await admin.query("ALTER TABLE openerp.approvals ENABLE TRIGGER posting_approval_consumption");
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  } finally {
    await admin.end();
  }

  const expiredView = await decoded(
    await request(f.book, `/payroll/runs/${prepared.run.id}`),
    Runs.PayrollRunView,
  );

  expect(expiredView.approval).toBeNull();
  expect(expiredView.execution).toBeNull();

  const direct = await preparePayment(f, claim);
  await post(
    f.book,
    `/payroll/input-reviews/${direct.payment.id}/executions`,
    { reviewDigest: direct.payment.digest, approvalId: direct.approval.id },
    Inputs.PayrollInputExecution,
  );
  const replacement = await executeInputRun(f, [claim.submitted.id]);
  expect(replacement.execution.employeeObligations.map((row) => row.payableMinor)).toEqual([
    "2097500",
  ]);
  const check = await database();
  let register;

  try {
    register = (
      await check.query(
        "select (select count(*)::int from openerp.payroll_input_reservations where book_id=$1) reservations,(select count(*)::int from openerp.payroll_run_reservation_releases where book_id=$1) releases,(select count(*)::int from openerp.payroll_input_consumptions where book_id=$1) consumptions",
        [f.book.bookId],
      )
    ).rows[0];
    expect(register).toEqual({ reservations: 2, releases: 1, consumptions: 1 });
  } finally {
    await check.end();
  }

  await writeFile(
    join(environment().artifacts, "payroll-input-expiry-proof.json"),
    JSON.stringify({ prepared, approval, expiredView, direct, replacement, register }, null, 2),
  );
});

test("company payment, duplicate receipt and generic input posting cannot mint an employee payout", async () => {
  const f = await inputsFixture();
  const example = exampleClaim(f);

  if (example.basis.kind !== "claim") throw new Error("Expected claim basis");

  const company = await post(
    f.book,
    "/payroll/inputs",
    { ...example, economicKey: "company-paid", basis: { ...example.basis, paidBy: "company" } },
    Inputs.PayrollInput,
  );

  await failure(
    await request(f.book, `/payroll/inputs/${company.id}/reviews`, {
      method: "POST",
      body: JSON.stringify({ inputDigest: company.digest }),
    }),
    422,
    "UnsupportedProfile",
  );
  const submitted = await post(f.book, "/payroll/inputs", example, Inputs.PayrollInput);

  const review = await post(
    f.book,
    `/payroll/inputs/${submitted.id}/reviews`,
    { inputDigest: submitted.digest },
    Inputs.PayrollInputReview,
  );

  await failure(
    await request(f.book, `/change-sets/${review.postingPlan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: review.postingPlan.planDigest }),
    }),
    403,
    "ApprovalRequired",
  );

  const approval = await post(
    f.book,
    `/payroll/input-reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Inputs.PayrollInputApproval,
  );

  await failure(
    await request(f.book, `/change-sets/${review.postingPlan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        planDigest: review.postingPlan.planDigest,
        approvalId: approval.id,
      }),
    }),
    403,
    "ApprovalRequired",
  );
  const executionKey = key();

  const execute = () =>
    request(f.book, `/payroll/input-reviews/${review.id}/executions`, {
      method: "POST",
      headers: { "idempotency-key": executionKey },
      body: JSON.stringify({ reviewDigest: review.digest, approvalId: approval.id }),
    });

  const [a, b] = await Promise.all([execute(), execute()]);
  const execution = await decoded(a, Inputs.PayrollInputExecution);
  expect(await decoded(b, Inputs.PayrollInputExecution)).toEqual(execution);
  await failure(
    await request(f.book, "/payroll/calculations", {
      method: "POST",
      body: JSON.stringify({
        ...f.calculation.basis.reviewedInput,
        recordClass: "actual_company",
        inputIds: [submitted.id],
      }),
    }),
    422,
    "UnsupportedProfile",
  );

  const duplicate = await post(
    f.book,
    "/payroll/inputs",
    { ...example, economicKey: "duplicate-receipt-key" },
    Inputs.PayrollInput,
  );

  await failure(
    await request(f.book, `/payroll/inputs/${duplicate.id}/reviews`, {
      method: "POST",
      body: JSON.stringify({ inputDigest: duplicate.digest }),
    }),
    409,
    "AlreadyPosted",
  );
  await writeFile(
    join(environment().artifacts, "payroll-input-admission-proof.json"),
    JSON.stringify({ company, submitted, review, approval, execution, duplicate }, null, 2),
  );
});

test("equal-byte evidence supports distinct reviewed receipt identities without duplicate financial effects", async () => {
  const f = await inputsFixture();
  const example = exampleClaim(f);

  if (example.basis.kind !== "claim") throw new Error("Expected claim basis");

  const first = await recognize(f, example);

  const second = await recognize(f, {
    ...example,
    economicKey: "receipt-two",
    basis: { ...example.basis, supplierDocumentNumber: "SYNTHETIC-R2" },
  });

  expect(second.submitted.input.evidence).toEqual(first.submitted.input.evidence);
  expect(first.review.outputs.reimbursementMinor).toBe("12500");
  expect(second.review.outputs.reimbursementMinor).toBe("12500");

  const duplicate = await post(
    f.book,
    "/payroll/inputs",
    { ...second.submitted.input, economicKey: "receipt-two-repeated" },
    Inputs.PayrollInput,
  );

  await failure(
    await request(f.book, `/payroll/inputs/${duplicate.id}/reviews`, {
      method: "POST",
      body: JSON.stringify({ inputDigest: duplicate.digest }),
    }),
    409,
    "AlreadyPosted",
  );

  const check = await database();
  let balances;

  try {
    balances = await check.query(
      "select account_id,sum(debit_minor::numeric-credit_minor::numeric)::text as balance from openerp.journal_lines where book_id=$1 and account_id in ('claim_expense','claim_vat','claim_liability') group by account_id order by account_id",
      [f.book.bookId],
    );
  } finally {
    await check.end();
  }

  expect(balances.rows).toEqual([
    { account_id: "claim_expense", balance: "20000" },
    { account_id: "claim_liability", balance: "-25000" },
    { account_id: "claim_vat", balance: "5000" },
  ]);

  await writeFile(
    join(environment().artifacts, "payroll-input-equal-byte-proof.json"),
    JSON.stringify({ first, second, duplicate, balances: balances.rows }, null, 2),
  );
});

test("claim partial direct payment then payroll consumes7500 without expense or VAT twice", async () => {
  const f = await inputsFixture();

  const claim = await recognize(f, {
    ...f.common,
    economicKey: "receipt-one",
    basis: {
      kind: "claim",
      paidBy: "employee",
      counterpartyId: "synthetic_receipt_vendor",
      supplierDocumentNumber: "SYNTHETIC-R1",
      line: {
        sourceLineId: "receipt_line",
        expenseAccountId: "claim_expense",
        netMinor: "10000",
        sourceTaxMinor: "2500",
        sourceGrossMinor: "12500",
        treatment: {
          treatmentId: "synthetic_full",
          rate: { numerator: "1", denominator: "4" },
          deduction: { numerator: "1", denominator: "1" },
          invoiceTaxRounding: "half_up",
          deductionRounding: "half_up",
          acceptancePolicy: "exact_match",
          toleranceMinor: "0",
          basis: "Synthetic qualified full deduction",
        },
        sourceRefs: [{ evidenceId: f.source.id, sourceKey: "receipt-one" }],
      },
      inputVatAccountId: "claim_vat",
    },
  });

  expect(claim.review.outputs.reimbursementMinor).toBe("12500");
  expect(claim.review.outputs.grossMinor).toBe("0");

  const payment = await post(
    f.book,
    `/payroll/inputs/${claim.submitted.id}/direct-payments`,
    {
      inputDigest: claim.submitted.digest,
      amountMinor: "5000",
      bankAccountId: "account_bank",
      evidence: f.common.evidence,
      accountingPeriodId: "period_2026",
      postingDate: "2026-01-16",
      series: "L",
    },
    Inputs.PayrollInputReview,
  );

  const approved = await post(
    f.book,
    `/payroll/input-reviews/${payment.id}/approvals`,
    { reviewDigest: payment.digest },
    Inputs.PayrollInputApproval,
  );

  await post(
    f.book,
    `/payroll/input-reviews/${payment.id}/executions`,
    { reviewDigest: payment.digest, approvalId: approved.id },
    Inputs.PayrollInputExecution,
  );

  const calculation = await post(
    f.book,
    "/payroll/calculations",
    { ...f.calculation.basis.reviewedInput, inputIds: [claim.submitted.id] },
    Calculations.PayrollCalculation,
  );

  expect(calculation.calculation.cashReimbursementMinor).toBe("7500");
  expect(calculation.calculation.payableMinor).toBe("2097500");

  const run = await post(
    f.book,
    "/payroll/runs",
    { ...f.input, calculationIds: [calculation.id] },
    Runs.PayrollRun,
  );

  const approval = await post(
    f.book,
    `/payroll/runs/${run.id}/approvals`,
    { runDigest: run.digest },
    Runs.PayrollRunApproval,
  );

  const executeInput = { runDigest: run.digest, approvalId: approval.id };
  const commandKey = key();

  const execute = () =>
    request(f.book, `/payroll/runs/${run.id}/executions`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(executeInput),
    });

  const [first, second] = await Promise.all([execute(), execute()]);
  const execution = await decoded(first, Runs.PayrollRunExecution);
  expect(await decoded(second, Runs.PayrollRunExecution)).toEqual(execution);
  const admin = await database();
  let balances;

  try {
    balances = (
      await admin.query(
        "select account_id,sum(debit_minor::numeric-credit_minor::numeric)::text balance from openerp.journal_lines where book_id=$1 and account_id in ('claim_expense','claim_vat','claim_liability','account_bank') group by account_id order by account_id",
        [f.book.bookId],
      )
    ).rows;
    expect(balances).toEqual([
      { account_id: "account_bank", balance: "-5000" },
      { account_id: "claim_expense", balance: "10000" },
      { account_id: "claim_liability", balance: "0" },
      { account_id: "claim_vat", balance: "2500" },
    ]);
    expect(
      (
        await admin.query(
          "select count(*)::int count from openerp.payroll_input_consumptions where book_id=$1",
          [f.book.bookId],
        )
      ).rows[0],
    ).toEqual({ count: 1 });
  } finally {
    await admin.end();
  }

  await failure(
    await request(f.book, `/payroll/inputs/${claim.submitted.id}/direct-payments`, {
      method: "POST",
      body: JSON.stringify({
        inputDigest: claim.submitted.digest,
        amountMinor: "1",
        bankAccountId: "account_bank",
        evidence: f.common.evidence,
        accountingPeriodId: "period_2026",
        postingDate: "2026-01-16",
        series: "L",
      }),
    }),
    409,
    "AlreadyPosted",
  );
  await writeFile(
    join(environment().artifacts, "payroll-input-claim-proof.json"),
    JSON.stringify({ claim, payment, calculation, run, approval, execution, balances }, null, 2),
  );
});
