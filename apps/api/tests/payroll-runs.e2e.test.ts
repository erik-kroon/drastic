import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Runs from "@open-erp/contracts/payroll-runs";
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

test("regular payroll executes one atomic unpaid run and retains original payslip identity", async () => {
  const { book, calculation, input, reviseEmployment } = await payrollFixture();
  const before = await persisted(book);
  const run = await post(book, "/payroll/runs", input, Runs.PayrollRun);
  expect(await persisted(book)).toEqual(before);
  expect(run.employeeObligations.map((row) => row.payableMinor)).toEqual(["2090000"]);
  expect(
    run.postingPlan.groups[0]?.actions[0]?.lines.reduce(
      (sum, line) => sum + BigInt(line.debitMinor),
      0n,
    ),
  ).toBe(3300000n);

  const approval = await post(
    book,
    `/payroll/runs/${run.id}/approvals`,
    { runDigest: run.digest },
    Runs.PayrollRunApproval,
  );

  const executionInput = { runDigest: run.digest, approvalId: approval.id };
  const executionKey = key();

  const execute = () =>
    request(book, `/payroll/runs/${run.id}/executions`, {
      method: "POST",
      headers: { "idempotency-key": executionKey },
      body: JSON.stringify(executionInput),
    });

  const [first, second] = await Promise.all([execute(), execute()]);
  const receipt = await decoded(first, Runs.PayrollRunExecution);
  expect(await decoded(second, Runs.PayrollRunExecution)).toEqual(receipt);
  expect(receipt.status).toBe("posted_unpaid");
  await failure(
    await request(book, `/payroll/runs/${run.id}/executions`, {
      method: "POST",
      body: JSON.stringify(executionInput),
    }),
    409,
    "AlreadyPosted",
  );
  const admin = await database();
  let register;

  try {
    register = (
      await admin.query(
        `select
      (select count(*)::int from openerp.payroll_run_obligations where book_id=$1) obligations,
      (select count(*)::int from openerp.payroll_earning_reservations where book_id=$1) earnings,
      (select count(*)::int from openerp.payroll_month_reservations where book_id=$1) months,
      (select count(*)::int from openerp.payroll_payslip_documents where book_id=$1) documents`,
        [book.bookId],
      )
    ).rows[0];
    expect(register).toEqual({ obligations: 1, earnings: 1, months: 1, documents: 1 });
  } finally {
    await admin.end();
  }

  const payslip = receipt.payslips[0];
  expect(payslip?.personRef).toBe("SYNTHETIC PERSON ORIGINAL");

  if (!payslip) throw new Error("Missing original payslip");

  const artifact = await post(
    book,
    `/payroll/payslips/${payslip.id}/renders`,
    { documentDigest: payslip.digest },
    Runs.PayrollPayslipArtifact,
  );

  const saved = await decoded(
    await request(book, `/payroll/payslips/${payslip.id}/artifact`),
    Runs.PayrollPayslipArtifactBytes,
  );

  expect(
    createHash("sha256").update(Buffer.from(saved.contentBase64, "base64")).digest("hex"),
  ).toBe(artifact.sha256);
  await reviseEmployment();
  expect(
    await decoded(
      await request(book, `/payroll/payslips/${payslip.id}/artifact`),
      Runs.PayrollPayslipArtifactBytes,
    ),
  ).toEqual(saved);
  expect(
    (await decoded(await request(book, `/payroll/runs/${run.id}`), Runs.PayrollRunView)).run,
  ).toEqual(run);

  const pdf = Buffer.from(saved.contentBase64, "base64");
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  await writeFile(
    join(environment().artifacts, "payroll-runs-proof.json"),
    JSON.stringify({ input, calculation, run, approval, receipt, register, artifact }, null, 2),
  );
  await writeFile(join(environment().artifacts, "payroll-payslip.pdf"), pdf);
});

test("generic execution and stale payroll revisions refuse without owned effects", async () => {
  const { book, input, reviseEmployment } = await payrollFixture();
  const run = await post(book, "/payroll/runs", input, Runs.PayrollRun);
  const before = await persisted(book);
  await failure(
    await request(book, `/change-sets/${run.postingPlan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: run.postingPlan.planDigest }),
    }),
    403,
    "ApprovalRequired",
  );

  const alternatePlan = await post(
    book,
    "/change-sets",
    {
      kind: "manual_journal",
      evidenceId: input.evidenceId,
      eventKey: run.id,
      accountingPeriodId: input.accountingPeriodId,
      postingDate: input.postingDate,
      series: input.series,
      description: "Synthetic attempted payroll event bypass",
      rationale: "Exercise alternate plan ownership admission",
      taxAssessment: "not_applicable",
      lines: run.postingPlan.groups[0]?.actions[0]?.lines,
    },
    Accounting.ChangeSet,
  );

  expect(alternatePlan.id).not.toBe(run.postingPlan.id);
  expect(alternatePlan.groups[0]?.actions[0]?.eventId).toBe(
    run.postingPlan.groups[0]?.actions[0]?.eventId,
  );
  await failure(
    await request(book, `/change-sets/${alternatePlan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: alternatePlan.planDigest }),
    }),
    403,
    "ApprovalRequired",
  );

  const approval = await post(
    book,
    `/payroll/runs/${run.id}/approvals`,
    { runDigest: run.digest },
    Runs.PayrollRunApproval,
  );

  await failure(
    await request(book, `/change-sets/${run.postingPlan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        planDigest: run.postingPlan.planDigest,
        approvalId: approval.id,
      }),
    }),
    403,
    "ApprovalRequired",
  );
  await failure(
    await request(book, `/change-sets/${alternatePlan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        planDigest: alternatePlan.planDigest,
        approvalId: approval.id,
      }),
    }),
    403,
    "ApprovalRequired",
  );
  await reviseEmployment();
  await failure(
    await request(book, `/payroll/runs/${run.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ runDigest: run.digest }),
    }),
    409,
    "StaleDependency",
  );
  expect(await persisted(book)).toEqual(before);
});

test("superseded reviewed company facts refuse approval and execution of frozen payroll", async () => {
  const { book, reviewer, fact, source, input } = await payrollFixture();
  const run = await post(book, "/payroll/runs", input, Runs.PayrollRun);

  const approval = await post(
    book,
    `/payroll/runs/${run.id}/approvals`,
    { runDigest: run.digest },
    Runs.PayrollRunApproval,
  );

  const before = await payrollRegisterCounts(book.bookId);

  const replacement = await post(
    book,
    "/company-facts",
    {
      factKind: "jurisdiction",
      value: { state: "known", value: "QZ" },
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      supersedesId: fact.id,
      evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
      note: "Synthetic replacement changes retained profile witness",
    },
    Profiles.FactRevision,
  );

  await post(
    reviewer,
    `/company-facts/${replacement.id}/reviews`,
    {
      factRevisionId: replacement.id,
      expectedDigest: replacement.digest,
      result: "confirmed",
      rationale: "Independent synthetic replacement jurisdiction review",
    },
    Profiles.FactReview,
  );
  await failure(
    await request(book, `/payroll/runs/${run.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ runDigest: run.digest }),
    }),
    409,
    "StaleDependency",
  );
  await failure(
    await request(book, `/payroll/runs/${run.id}/executions`, {
      method: "POST",
      body: JSON.stringify({ runDigest: run.digest, approvalId: approval.id }),
    }),
    409,
    "StaleDependency",
  );
  expect(await payrollRegisterCounts(book.bookId)).toEqual(before);
});

async function payrollRegisterCounts(bookId: string) {
  const admin = await database();

  try {
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
  } finally {
    await admin.end();
  }
}

test("new reimbursement conserves payable and journal controls", async () => {
  const { book, input } = await payrollFixture(1, "50000");
  const run = await post(book, "/payroll/runs", input, Runs.PayrollRun);
  expect(run.employeeObligations.map((row) => row.payableMinor)).toEqual(["2140000"]);
  const lines = run.postingPlan.groups[0]?.actions[0]?.lines;
  expect(lines?.reduce((sum, line) => sum + BigInt(line.debitMinor), 0n)).toBe(3350000n);
  expect(lines?.reduce((sum, line) => sum + BigInt(line.creditMinor), 0n)).toBe(3350000n);
});

test("two employees roll back as one group on obligation and outbox failures", async () => {
  const { book, input } = await payrollFixture(2);
  const run = await post(book, "/payroll/runs", input, Runs.PayrollRun);

  const approval = await post(
    book,
    `/payroll/runs/${run.id}/approvals`,
    { runDigest: run.digest },
    Runs.PayrollRunApproval,
  );

  const before = await payrollRegisterCounts(book.bookId);
  const executionKey = key();

  const execute = () =>
    request(book, `/payroll/runs/${run.id}/executions`, {
      method: "POST",
      headers: { "idempotency-key": executionKey },
      body: JSON.stringify({ runDigest: run.digest, approvalId: approval.id }),
    });

  for (const [table, condition] of [
    ["payroll_run_obligations", "NEW.employee_id='synthetic_employee_1'"],
    ["outbox", "NEW.kind='payroll.payslip.render_requested'"],
  ]) {
    const admin = await database();

    try {
      await admin.query(
        `CREATE FUNCTION openerp.synthetic_payroll_write_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'synthetic payroll write fault' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`,
      );
      await admin.query(
        `CREATE TRIGGER synthetic_payroll_write_failure BEFORE INSERT ON openerp.${table} FOR EACH ROW EXECUTE FUNCTION openerp.synthetic_payroll_write_failure()`,
      );
      await failure(await execute(), 500, "InternalError");
      expect(await payrollRegisterCounts(book.bookId)).toEqual(before);
    } finally {
      await admin.query(
        `DROP TRIGGER IF EXISTS synthetic_payroll_write_failure ON openerp.${table}`,
      );
      await admin.query("DROP FUNCTION IF EXISTS openerp.synthetic_payroll_write_failure()");
      await admin.end();
    }
  }

  const receipt = await decoded(await execute(), Runs.PayrollRunExecution);
  expect(receipt.employeeObligations.map((row) => row.payableMinor)).toEqual([
    "2090000",
    "2090000",
  ]);
  expect(await payrollRegisterCounts(book.bookId)).toEqual({
    vouchers: 1,
    executions: 1,
    obligations: 2,
    earnings: 2,
    months: 2,
    documents: 2,
    intents: 2,
  });
  await writeFile(
    join(environment().artifacts, "payroll-two-employee-rollback.json"),
    JSON.stringify(
      { before, run, receipt, after: await payrollRegisterCounts(book.bookId) },
      null,
      2,
    ),
  );
});

test("changed digest and removed private grant refuse payroll commands and saved reads", async () => {
  const { book, input } = await payrollFixture();
  const run = await post(book, "/payroll/runs", input, Runs.PayrollRun);
  await failure(
    await request(book, `/payroll/runs/${run.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ runDigest: `sha256:${"0".repeat(64)}` }),
    }),
    409,
    "StaleDependency",
  );
  await request(book, "/payroll/access", {
    method: "POST",
    body: JSON.stringify({ actorId: book.actorId, allowed: false }),
  }).then(async (response) => {
    expect(response.status).toBe(200);
  });
  await failure(await request(book, `/payroll/runs/${run.id}`), 403, "Forbidden");
  await failure(
    await request(book, "/payroll/runs", { method: "POST", body: JSON.stringify(input) }),
    403,
    "Forbidden",
  );
  await failure(
    await request(book, `/payroll/runs/${run.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ runDigest: run.digest }),
    }),
    403,
    "Forbidden",
  );
});

test("competing run keys consume one earning identity and one monthly reservation", async () => {
  const { book, input } = await payrollFixture();
  const left = await post(book, "/payroll/runs", input, Runs.PayrollRun);
  const right = await post(book, "/payroll/runs", input, Runs.PayrollRun);

  const approvals = await Promise.all(
    [left, right].map((run) =>
      post(
        book,
        `/payroll/runs/${run.id}/approvals`,
        { runDigest: run.digest },
        Runs.PayrollRunApproval,
      ),
    ),
  );

  const responses = await Promise.all(
    [left, right].map((run, ordinal) =>
      request(book, `/payroll/runs/${run.id}/executions`, {
        method: "POST",
        body: JSON.stringify({ runDigest: run.digest, approvalId: approvals[ordinal]?.id }),
      }),
    ),
  );

  expect(responses.map((response) => response.status).sort((left, right) => left - right)).toEqual([
    200, 409,
  ]);
  const winning = responses.find((response) => response.status === 200);
  const losing = responses.find((response) => response.status === 409);

  if (!winning || !losing) throw new Error("Missing competing execution outcome");
  const receipt = await decoded(winning, Runs.PayrollRunExecution);
  await failure(losing, 409, "AlreadyPosted");
  expect(receipt.employeeObligations.map((row) => row.payableMinor)).toEqual(["2090000"]);
  expect(await payrollRegisterCounts(book.bookId)).toEqual({
    vouchers: 1,
    executions: 1,
    obligations: 1,
    earnings: 1,
    months: 1,
    documents: 1,
    intents: 1,
  });
});

test("expired approval refuses without financial or employee effects", async () => {
  const { book, input } = await payrollFixture();
  const run = await post(book, "/payroll/runs", input, Runs.PayrollRun);

  const approval = await post(
    book,
    `/payroll/runs/${run.id}/approvals`,
    { runDigest: run.digest },
    Runs.PayrollRunApproval,
  );

  const admin = await database();

  try {
    await admin.query("BEGIN");
    await admin.query("ALTER TABLE openerp.approvals DISABLE TRIGGER posting_approval_consumption");
    await admin.query(
      "UPDATE openerp.approvals SET expires_at=clock_timestamp()-interval '1 second' WHERE book_id=$1 AND id=$2",
      [book.bookId, approval.id],
    );
    await admin.query("ALTER TABLE openerp.approvals ENABLE TRIGGER posting_approval_consumption");
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  } finally {
    await admin.end();
  }

  const before = await payrollRegisterCounts(book.bookId);
  await failure(
    await request(book, `/payroll/runs/${run.id}/executions`, {
      method: "POST",
      body: JSON.stringify({ runDigest: run.digest, approvalId: approval.id }),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await payrollRegisterCounts(book.bookId)).toEqual(before);
});
