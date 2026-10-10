import { assertPersonalOwnersExcluded } from "./support/decision-examples";
import { proveReminderRecovery } from "./support/reminder-recovery";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as V from "@open-erp/contracts/variable-pay-review";
import * as A from "@open-erp/contracts/accounting";
import * as Inputs from "@open-erp/contracts/payroll-inputs";
import { database, decoded, environment, failure, key, post, request } from "./support/fixtures";
import {
  variablePayFixture,
  retainVariableProfile,
  variableInputFromProfile,
} from "./support/variable-pay";

test("retained unknown absence and mismatched holiday controls block financial review and return to actual submitter", async () => {
  const f = await variablePayFixture();
  await assertPersonalOwnersExcluded(f.book, "payroll");
  const view = f.assessment;
  expect(view.current.blockers.map((row) => row.code)).toEqual([
    "unsupported_work",
    "holiday_control",
    "duplicate_source",
  ]);
  expect(view.current.blockers[2]).toMatchObject({
    priorInputId: f.original.id,
    priorRunId: f.run.id,
    priorPaidEventId: f.paid.id,
    priorPaidEventDigest: f.paid.digest,
    paidOn: "2026-01-31",
    priorRunRow: 4,
  });
  expect(view.assessment.workedMinutes).toBe("2250");
  expect(view.assessment.rateMinor).toBe("20000");
  expect(view.assessment.workedAmountMinor).toBe("750000");
  expect(view.assessment.sickAmountMinor).toBeNull();
  expect(view.assessment.holidayDeltaMinor).toBeNull();
  expect(view.assessment.holidayControl).toMatchObject({
    openingMinor: "1000000",
    ledgerMinor: "940000",
    differenceMinor: "60000",
  });
  expect(view.assessment.submitter).toEqual({ actorId: f.book.actorId, displayName: "Sara Lind" });
  expect(view.current.canPrepareFinancialReview).toBe(false);

  const refused = await request(f.book, `/payroll/inputs/${f.submitted.id}/reviews`, {
    method: "POST",
    headers: { "idempotency-key": key() },
    body: JSON.stringify({ inputDigest: f.submitted.digest }),
  });

  await failure(refused, 403, "ApprovalRequired");

  const input = {
    assessmentDigest: view.assessment.digest,
    selectionId: view.selection!.id,
    kind: "returned" as const,
  };

  const retryKey = key();

  const submitDisposition = () =>
    request(f.book, `/payroll/variable-pay/assessments/${view.assessment.id}/dispositions`, {
      method: "POST",
      headers: { "idempotency-key": retryKey },
      body: JSON.stringify(input),
    });

  const result = await decoded(await submitDisposition(), V.VariablePayReviewView);
  const replay = await decoded(await submitDisposition(), V.VariablePayReviewView);
  expect(replay).toEqual(result);
  expect(result.current.status).toBe("returned");
  expect(result.dispositions).toHaveLength(1);
  expect(result.dispositions[0]?.submitterActorId).toBe(f.book.actorId);

  const retained = await decoded(
    await request(f.book, `/payroll/inputs/${f.submitted.id}`),
    Inputs.PayrollInputView,
  );

  expect(retained.submitted).toEqual(f.submitted);
  expect(retained.reviews).toHaveLength(0);
  expect(retained.executions).toHaveLength(0);

  const reloaded = await decoded(
    await request(f.book, `/payroll/variable-pay/assessments/${view.assessment.id}`),
    V.VariablePayReviewView,
  );

  expect(reloaded.current.status).toBe("returned");
  await writeFile(
    join(environment().artifacts, "variable-pay-return-proof.json"),
    JSON.stringify({ assessment: view, result, reloaded, retained }, null, 2),
  );
});

test("pending removal is durable and conflicting terminal disposition refuses", async () => {
  const f = await variablePayFixture();
  const view = f.assessment;

  const input = {
    assessmentDigest: view.assessment.digest,
    selectionId: view.selection!.id,
    kind: "removed" as const,
  };

  const result = await post(
    f.book,
    `/payroll/variable-pay/assessments/${view.assessment.id}/dispositions`,
    input,
    V.VariablePayReviewView,
  );

  expect(result.current.status).toBe("removed");

  const response = await request(
    f.book,
    `/payroll/variable-pay/assessments/${view.assessment.id}/dispositions`,
    {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ ...input, kind: "returned" }),
    },
  );

  await failure(response, 409, "AlreadyPosted");
  expect(result.selection).toEqual(view.selection);
  expect(result.financialReview).toBeNull();
  await writeFile(
    join(environment().artifacts, "variable-pay-removal-proof.json"),
    JSON.stringify(result, null, 2),
  );
});

test("changing economic keys and source IDs cannot recognize the same canonical paid work twice", async () => {
  const f = await variablePayFixture();

  const profile = {
    ...f.profile,
    occurrenceKey: key(),
    rows: f.profile.rows
      .filter((row) => row.kind === "worked")
      .map((row, index) => ({
        ...row,
        sourceId: `alias_${index}`,
        rowIdentity: `alias_row_${index}`,
      })),
  };

  const retained = await retainVariableProfile(f.book, profile);
  const input = variableInputFromProfile(f.input, profile, retained.evidence);
  const submitted = await post(f.book, "/payroll/inputs", input, Inputs.PayrollInput);

  const response = await request(f.book, `/payroll/inputs/${submitted.id}/reviews`, {
    method: "POST",
    headers: { "idempotency-key": key() },
    body: JSON.stringify({ inputDigest: submitted.digest }),
  });

  await failure(response, 409, "AlreadyPosted");

  const record = await decoded(
    await request(f.book, `/payroll/inputs/${submitted.id}`),
    Inputs.PayrollInputView,
  );

  expect(record.reviews).toHaveLength(0);
  expect(record.executions).toHaveLength(0);
  await writeFile(
    join(environment().artifacts, "variable-pay-canonical-source-refusal.json"),
    JSON.stringify({ original: f.original, paid: f.paid, submitted, record }, null, 2),
  );
});

test("concurrent return and pending removal retain exactly one terminal outcome", async () => {
  const f = await variablePayFixture();
  const assessment = f.assessment.assessment;

  const result = await Promise.all(
    ["returned", "removed"].map((kind) =>
      request(f.book, `/payroll/variable-pay/assessments/${assessment.id}/dispositions`, {
        method: "POST",
        headers: { "idempotency-key": key() },
        body: JSON.stringify({
          assessmentDigest: assessment.digest,
          selectionId: f.assessment.selection!.id,
          kind,
        }),
      }),
    ),
  );

  expect(result.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 409]);

  const retained = await decoded(
    await request(f.book, `/payroll/variable-pay/assessments/${assessment.id}`),
    V.VariablePayReviewView,
  );

  expect(retained.dispositions).toHaveLength(1);
  expect(retained.current.canRemove).toBe(false);
  expect(retained.current.canReturn).toBe(false);
  await writeFile(
    join(environment().artifacts, "variable-pay-disposition-race.json"),
    JSON.stringify(retained, null, 2),
  );
});

test.each(["0", "100"])(
  "a current complete assessment with own holiday delta%s remains current after independent recognition",
  async (delta) => {
    const f = await variablePayFixture();

    const profile = {
      ...f.profile,
      occurrenceKey: key(),
      rows: f.profile.rows
        .filter((row) => row.kind === "worked")
        .map((row, index) => {
          const scheduleDate = `2026-01-${20 + index}`;

          return {
            ...row,
            sourceId: `ready_${index}`,
            rowIdentity: `ready_row_${index}`,
            scheduleDate,
            economicOccurrence: JSON.stringify([
              f.profile.employeeId,
              scheduleDate,
              row.kind,
              row.startLocal,
              row.endLocal,
              row.breakMinutes,
            ]),
          };
        }),
    };

    const retained = await retainVariableProfile(f.book, profile);
    const input = variableInputFromProfile(f.input, profile, retained.evidence);
    input.basis.holiday = {
      ...input.basis.holiday,
      openingUnitsMinor: "940000",
      openingValueMinor: "940000",
      movements: [{ kind: "earned", unitsMinor: delta, sourceIdentity: "ready_holiday" }],
    };
    const submitted = await post(f.book, "/payroll/inputs", input, Inputs.PayrollInput);

    const assessment = await post(
      f.book,
      `/payroll/variable-pay/${submitted.id}/assessments`,
      {
        inputDigest: submitted.digest,
        sourceOccurrence: { occurrenceId: retained.source.id, sha256: retained.source.sha256 },
      },
      V.VariablePayReviewView,
    );

    expect(assessment.current.blockers).toHaveLength(0);

    const selection = await post(
      f.book,
      `/payroll/variable-pay/assessments/${assessment.assessment.id}/selections`,
      { assessmentDigest: assessment.assessment.digest },
      V.VariablePayReviewView,
    );

    expect(selection.current.canPrepareFinancialReview).toBe(true);

    const review = await post(
      f.book,
      `/payroll/inputs/${submitted.id}/reviews`,
      { inputDigest: submitted.digest },
      Inputs.PayrollInputReview,
    );

    expect(review.outputs.grossMinor).toBe("750000");
    expect(review.outputs.holidayMoneyDeltaMinor).toBe(delta);

    const self = await request(f.book, `/payroll/input-reviews/${review.id}/approvals`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ reviewDigest: review.digest }),
    });

    await failure(self, 403, "Forbidden");

    const reviewerView = await decoded(
      await request(f.reviewer, `/payroll/variable-pay/assessments/${assessment.assessment.id}`),
      V.VariablePayReviewView,
    );

    expect(reviewerView.current.canApprove).toBe(true);

    const lines = review.postingPlan.groups.flatMap((group) =>
      group.actions.flatMap((action) => action.lines),
    );

    expect(lines.reduce((sum, line) => sum + BigInt(line.debitMinor), 0n)).toBe(
      750000n + BigInt(delta),
    );
    expect(lines.reduce((sum, line) => sum + BigInt(line.creditMinor), 0n)).toBe(
      750000n + BigInt(delta),
    );

    const approved = await post(
      f.reviewer,
      `/payroll/input-reviews/${review.id}/approvals`,
      { reviewDigest: review.digest },
      Inputs.PayrollInputApproval,
    );

    expect(approved.actorId).not.toBe(submitted.createdBy);

    const execution = await post(
      f.book,
      `/payroll/input-reviews/${review.id}/executions`,
      { reviewDigest: review.digest, approvalId: approved.id },
      Inputs.PayrollInputExecution,
    );

    const current = await decoded(
      await request(f.book, `/payroll/variable-pay/assessments/${assessment.assessment.id}`),
      V.VariablePayReviewView,
    );

    expect(current.current.assessmentCurrent).toBe(true);
    expect(current.current.blockers).toHaveLength(0);
    expect(current.recognition?.id).toBe(execution.id);
    expect(current.current.status).toBe("recognized");
    expect(current.current.canPrepareFinancialReview).toBe(false);
    expect(current.financialReview?.id).toBe(review.id);
    await creditHoliday(f);

    const changed = await decoded(
      await request(f.book, `/payroll/variable-pay/assessments/${assessment.assessment.id}`),
      V.VariablePayReviewView,
    );

    expect(changed.current.assessmentCurrent).toBe(false);
    expect(changed.current.blockers.some((row) => row.code === "holiday_control")).toBe(true);
    expect(changed.recognition?.voucherId).toBe(execution.postingReceipt.voucherId);
    expect(changed.current.canPrepareFinancialReview).toBe(false);
    await writeFile(
      join(environment().artifacts, `variable-pay-recognition-reload-${delta}.json`),
      JSON.stringify({ current, changed }, null, 2),
    );
    await writeFile(
      join(environment().artifacts, "variable-pay-complete-handoff.json"),
      JSON.stringify({ assessment, selection, review, approved, execution, current }, null, 2),
    );
  },
);

test("populated assessment selection and disposition survive genuine V8 dump inspect and fenced restore", async () => {
  const f = await variablePayFixture();
  const assessment = f.assessment.assessment;

  const result = await post(
    f.book,
    `/payroll/variable-pay/assessments/${assessment.id}/dispositions`,
    {
      assessmentDigest: assessment.digest,
      selectionId: f.assessment.selection!.id,
      kind: "returned",
    },
    V.VariablePayReviewView,
  );

  const recovery = await proveReminderRecovery(f.book.bookId, [8]);
  expect(recovery).toHaveLength(1);
  await writeFile(
    join(environment().artifacts, "variable-pay-v8-recovery.json"),
    JSON.stringify({ assessment, result, recovery }, null, 2),
  );
});

test("new ledger control invalidates retained selection before disposition or financial preparation", async () => {
  const f = await variablePayFixture();

  const plan = await post(
    f.book,
    "/change-sets",
    {
      kind: "manual_journal",
      evidenceId: f.baseEvidence.id,
      eventKey: key(),
      accountingPeriodId: "period_2026",
      postingDate: "2026-01-31",
      series: "L",
      description: "Synthetic independent holiday change",
      rationale: "Independent credit100 changes ledger940000 to940100",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "holiday_expense",
          debitMinor: "100",
          creditMinor: "0",
          description: "Synthetic additionalholiday",
        },
        {
          accountId: "holiday_liability",
          debitMinor: "0",
          creditMinor: "100",
          description: "Synthetic additionalholiday",
        },
      ],
    },
    A.ChangeSet,
  );

  const approval = await post(
    f.reviewer,
    `/change-sets/${plan.id}/approvals`,
    { version: 1, planDigest: plan.planDigest },
    A.Approval,
  );

  await post(
    f.book,
    `/change-sets/${plan.id}/execute`,
    { version: 1, planDigest: plan.planDigest, approvalId: approval.id },
    A.ExecutionReceipt,
  );

  const retained = await decoded(
    await request(f.book, `/payroll/variable-pay/assessments/${f.assessment.assessment.id}`),
    V.VariablePayReviewView,
  );

  expect(retained.current.assessmentCurrent).toBe(false);
  expect(retained.current.blockers.find((row) => row.code === "holiday_control")?.amountMinor).toBe(
    "59900",
  );
  expect(retained.assessment.holidayControl.ledgerMinor).toBe("940000");

  const response = await request(
    f.book,
    `/payroll/variable-pay/assessments/${retained.assessment.id}/dispositions`,
    {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        assessmentDigest: retained.assessment.digest,
        selectionId: retained.selection!.id,
        kind: "removed",
      }),
    },
  );

  await failure(response, 409, "StaleDependency");

  const fresh = await post(
    f.book,
    `/payroll/variable-pay/${f.submitted.id}/assessments`,
    { inputDigest: f.submitted.digest, sourceOccurrence: retained.assessment.sourceOccurrence },
    V.VariablePayReviewView,
  );

  const raced = await Promise.all([
    request(f.book, `/payroll/variable-pay/assessments/${fresh.assessment.id}/selections`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ assessmentDigest: fresh.assessment.digest }),
    }),
    request(f.book, `/payroll/variable-pay/assessments/${retained.assessment.id}/dispositions`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({
        assessmentDigest: retained.assessment.digest,
        selectionId: retained.selection!.id,
        kind: "removed",
      }),
    }),
  ]);

  const refreshed = await decoded(raced[0]!, V.VariablePayReviewView);
  await failure(raced[1]!, 409, "StaleDependency");
  expect(refreshed.selection?.id).not.toBe(retained.selection?.id);

  const removed = await post(
    f.book,
    `/payroll/variable-pay/assessments/${fresh.assessment.id}/dispositions`,
    {
      assessmentDigest: fresh.assessment.digest,
      selectionId: refreshed.selection!.id,
      kind: "removed",
    },
    V.VariablePayReviewView,
  );

  expect(removed.current.status).toBe("removed");
  expect(removed.dispositions).toHaveLength(1);
  expect(removed.recognition).toBeNull();
  await writeFile(
    join(environment().artifacts, "variable-pay-stale-selection-refresh.json"),
    JSON.stringify({ retained, fresh, refreshed, removed }, null, 2),
  );
  await writeFile(
    join(environment().artifacts, "variable-pay-stale-ledger-refusal.json"),
    JSON.stringify(retained, null, 2),
  );
});

test("an overlapping legacy source with unavailable canonical intervals remains unknown and blocks copied recognition", async () => {
  const f = await variablePayFixture();

  if (f.input.basis.kind !== "variable") throw new Error("Expected variable fixture");

  const legacyInput = {
    ...f.input,
    economicKey: key(),
    evidence: { evidenceId: f.baseEvidence.id, sha256: f.baseEvidence.sha256 },
    basis: {
      ...f.input.basis,
      work: [
        {
          sourceId: "legacy_time",
          kind: "worked" as const,
          unitsMinor: "480",
          scheduleDate: "2026-01-20",
        },
      ],
      earnings: [
        {
          sourceIdentity: "legacy_earning",
          componentKind: "cash" as const,
          unitsNumerator: "8",
          unitsDenominator: "1",
          rateMinor: "20000",
          withholdingBase: true,
          contributionBase: true,
          holidayAccrualBase: true,
        },
      ],
      holiday: {
        ...f.input.basis.holiday,
        openingUnitsMinor: "940000",
        openingValueMinor: "940000",
      },
    },
  };

  const legacy = await post(f.book, "/payroll/inputs", legacyInput, Inputs.PayrollInput);

  const review = await post(
    f.book,
    `/payroll/inputs/${legacy.id}/reviews`,
    { inputDigest: legacy.digest },
    Inputs.PayrollInputReview,
  );

  const approval = await post(
    f.reviewer,
    `/payroll/input-reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Inputs.PayrollInputApproval,
  );

  await post(
    f.book,
    `/payroll/input-reviews/${review.id}/executions`,
    { reviewDigest: review.digest, approvalId: approval.id },
    Inputs.PayrollInputExecution,
  );

  const profile = {
    ...f.profile,
    occurrenceKey: key(),
    rows: f.profile.rows
      .filter((row) => row.kind === "worked")
      .map((row, index) => {
        const scheduleDate = `2026-01-${20 + index}`;

        return {
          ...row,
          sourceId: `legacy_copy_${index}`,
          rowIdentity: `legacy_copy_row_${index}`,
          scheduleDate,
          economicOccurrence: JSON.stringify([
            f.profile.employeeId,
            scheduleDate,
            row.kind,
            row.startLocal,
            row.endLocal,
            row.breakMinutes,
          ]),
        };
      }),
  };

  const retained = await retainVariableProfile(f.book, profile);
  const input = variableInputFromProfile(f.input, profile, retained.evidence);
  input.basis.holiday = {
    ...input.basis.holiday,
    openingUnitsMinor: "940000",
    openingValueMinor: "940000",
  };
  const submitted = await post(f.book, "/payroll/inputs", input, Inputs.PayrollInput);

  const assessment = await post(
    f.book,
    `/payroll/variable-pay/${submitted.id}/assessments`,
    {
      inputDigest: submitted.digest,
      sourceOccurrence: { occurrenceId: retained.source.id, sha256: retained.source.sha256 },
    },
    V.VariablePayReviewView,
  );

  expect(assessment.current.blockers).toHaveLength(1);
  expect(assessment.current.blockers[0]).toMatchObject({
    code: "invalid_source",
    priorInputId: legacy.id,
    priorRunId: null,
    priorPaidEventId: null,
    amountMinor: null,
  });
  expect(assessment.current.canPrepareFinancialReview).toBe(false);

  const refused = await request(f.book, `/payroll/inputs/${submitted.id}/reviews`, {
    method: "POST",
    headers: { "idempotency-key": key() },
    body: JSON.stringify({ inputDigest: submitted.digest }),
  });

  await failure(refused, 403, "ApprovalRequired");
  await writeFile(
    join(environment().artifacts, "variable-pay-unresolved-legacy-source.json"),
    JSON.stringify({ legacy, submitted, assessment }, null, 2),
  );
});

test.each([
  {
    kind: "worked" as const,
    startLocal: "08:00",
    endLocal: "16:00",
    breakMinutes: "60",
    unitsMinor: "420",
  },
  {
    kind: "overtime" as const,
    startLocal: "08:00",
    endLocal: "16:00",
    breakMinutes: "0",
    unitsMinor: "480",
  },
  {
    kind: "worked" as const,
    startLocal: "09:00",
    endLocal: "15:00",
    breakMinutes: "0",
    unitsMinor: "360",
  },
])(
  "recognized intervals cannot be paid again after kind, break or clock edits: %j",
  async (changes) => {
    const f = await variablePayFixture();
    const row = f.profile.rows.find((row) => row.scheduleDate === "2026-01-04")!;
    const changed = { ...row, ...changes, sourceId: key(), rowIdentity: `row_${key()}` };
    changed.economicOccurrence = JSON.stringify([
      f.profile.employeeId,
      changed.scheduleDate,
      changed.kind,
      changed.startLocal,
      changed.endLocal,
      changed.breakMinutes,
    ]);
    const profile = { ...f.profile, occurrenceKey: key(), rows: [changed] };
    const retained = await retainVariableProfile(f.book, profile);
    const input = variableInputFromProfile(f.input, profile, retained.evidence);
    const submitted = await post(f.book, "/payroll/inputs", input, Inputs.PayrollInput);

    const response = await request(f.book, `/payroll/inputs/${submitted.id}/reviews`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ inputDigest: submitted.digest }),
    });

    await failure(response, 409, "AlreadyPosted");

    const record = await decoded(
      await request(f.book, `/payroll/inputs/${submitted.id}`),
      Inputs.PayrollInputView,
    );

    expect(record.executions).toHaveLength(0);
    await writeFile(
      join(
        environment().artifacts,
        `variable-pay-overlap-${changes.kind}-${changes.unitsMinor}.json`,
      ),
      JSON.stringify({ profile, record }, null, 2),
    );
  },
);

test("qualified paid work cannot bypass ownership through incoming legacy evidence", async () => {
  const f = await variablePayFixture();

  const input = {
    ...f.input,
    economicKey: key(),
    evidence: { evidenceId: f.baseEvidence.id, sha256: f.baseEvidence.sha256 },
  };

  const submitted = await post(f.book, "/payroll/inputs", input, Inputs.PayrollInput);
  await failure(
    await request(f.book, `/payroll/inputs/${submitted.id}/reviews`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ inputDigest: submitted.digest }),
    }),
    409,
    "AlreadyPosted",
  );

  const record = await decoded(
    await request(f.book, `/payroll/inputs/${submitted.id}`),
    Inputs.PayrollInputView,
  );

  expect(record.executions).toHaveLength(0);
  await writeFile(
    join(environment().artifacts, "variable-pay-qualified-to-legacy-refusal.json"),
    JSON.stringify(record, null, 2),
  );
});

async function readyInput(
  f: Awaited<ReturnType<typeof variablePayFixture>>,
  scheduleDate = "2026-01-25",
  startLocal = "08:00",
  endLocal = "16:00",
) {
  const row = {
    ...f.profile.rows[0]!,
    scheduleDate,
    sourceId: key(),
    rowIdentity: `row_${key()}`,
    startLocal,
    endLocal,
    breakMinutes: "0",
    unitsMinor: String((Number(endLocal.slice(0, 2)) - Number(startLocal.slice(0, 2))) * 60),
  };

  row.economicOccurrence = JSON.stringify([
    f.profile.employeeId,
    scheduleDate,
    row.kind,
    startLocal,
    endLocal,
    "0",
  ]);
  const profile = { ...f.profile, occurrenceKey: key(), rows: [row] };
  const retained = await retainVariableProfile(f.book, profile);
  const input = variableInputFromProfile(f.input, profile, retained.evidence);
  input.basis.holiday = {
    ...input.basis.holiday,
    openingUnitsMinor: "940000",
    openingValueMinor: "940000",
  };

  return { profile, retained, input };
}

async function assessReady(
  f: Awaited<ReturnType<typeof variablePayFixture>>,
  submitted: typeof Inputs.PayrollInput.Type,
  retained: Awaited<ReturnType<typeof retainVariableProfile>>,
) {
  return post(
    f.book,
    `/payroll/variable-pay/${submitted.id}/assessments`,
    {
      inputDigest: submitted.digest,
      sourceOccurrence: { occurrenceId: retained.source.id, sha256: retained.source.sha256 },
    },
    V.VariablePayReviewView,
  );
}

test("nonoverlapping qualified intervals on a recognized day retain financial preparation", async () => {
  const f = await variablePayFixture();
  const ready = await readyInput(f, "2026-01-04", "16:00", "20:00");
  const submitted = await post(f.book, "/payroll/inputs", ready.input, Inputs.PayrollInput);
  const assessment = await assessReady(f, submitted, ready.retained);
  expect(assessment.current.blockers).toHaveLength(0);
  await post(
    f.book,
    `/payroll/variable-pay/assessments/${assessment.assessment.id}/selections`,
    { assessmentDigest: assessment.assessment.digest },
    V.VariablePayReviewView,
  );

  const review = await post(
    f.book,
    `/payroll/inputs/${submitted.id}/reviews`,
    { inputDigest: submitted.digest },
    Inputs.PayrollInputReview,
  );

  await writeFile(
    join(environment().artifacts, "variable-pay-nonoverlap-positive.json"),
    JSON.stringify({ assessment, review }, null, 2),
  );
});

test("self approval obtained before assessment cannot execute after the managed selection", async () => {
  const f = await variablePayFixture();
  const ready = await readyInput(f);
  const submitted = await post(f.book, "/payroll/inputs", ready.input, Inputs.PayrollInput);

  const review = await post(
    f.book,
    `/payroll/inputs/${submitted.id}/reviews`,
    { inputDigest: submitted.digest },
    Inputs.PayrollInputReview,
  );

  const self = await post(
    f.book,
    `/payroll/input-reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Inputs.PayrollInputApproval,
  );

  const assessment = await assessReady(f, submitted, ready.retained);

  const selected = await post(
    f.book,
    `/payroll/variable-pay/assessments/${assessment.assessment.id}/selections`,
    { assessmentDigest: assessment.assessment.digest },
    V.VariablePayReviewView,
  );

  expect(selected.financialApproval?.usable).toBe(false);
  await failure(
    await request(f.book, `/payroll/input-reviews/${review.id}/executions`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ reviewDigest: review.digest, approvalId: self.id }),
    }),
    403,
    "Forbidden",
  );

  const record = await decoded(
    await request(f.book, `/payroll/inputs/${submitted.id}`),
    Inputs.PayrollInputView,
  );

  expect(record.executions).toHaveLength(0);

  const independent = await post(
    f.reviewer,
    `/payroll/input-reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Inputs.PayrollInputApproval,
  );

  const execution = await post(
    f.book,
    `/payroll/input-reviews/${review.id}/executions`,
    { reviewDigest: review.digest, approvalId: independent.id },
    Inputs.PayrollInputExecution,
  );

  await writeFile(
    join(environment().artifacts, "variable-pay-preassessment-approval-refusal.json"),
    JSON.stringify({ selected, self, record, independent, execution }, null, 2),
  );
});

test.each(["fraction", "negative", "unsupported"] as const)(
  "unknown holiday target %s remains blocked",
  async (kind) => {
    const f = await variablePayFixture();
    const ready = await readyInput(f);
    const holiday = { ...ready.input.basis.holiday };

    if (kind === "negative")
      holiday.movements = [{ kind: "used", unitsMinor: "940001", sourceIdentity: key() }];
    else if (kind === "unsupported")
      holiday.movements = [{ kind: "corrected", unitsMinor: "1", sourceIdentity: key() }];
    else {
      holiday.provisionNumerator = "1";
      holiday.provisionDenominator = "3";
    }

    ready.input.basis.holiday = holiday;

    const submitted = await post(f.book, "/payroll/inputs", ready.input, Inputs.PayrollInput);
    const assessment = await assessReady(f, submitted, ready.retained);
    expect(assessment.current.blockers.some((row) => row.code === "invalid_source")).toBe(true);
    expect(assessment.assessment.holidayDeltaMinor).toBeNull();
    expect(assessment.current.canPrepareFinancialReview).toBe(false);
    expect(assessment.current.canApprove).toBe(false);
    await writeFile(
      join(environment().artifacts, `variable-pay-invalid-holiday-${kind}.json`),
      JSON.stringify(assessment, null, 2),
    );
  },
);

async function creditHoliday(f: Awaited<ReturnType<typeof variablePayFixture>>) {
  const plan = await post(
    f.book,
    "/change-sets",
    {
      kind: "manual_journal",
      evidenceId: f.baseEvidence.id,
      eventKey: key(),
      accountingPeriodId: "period_2026",
      postingDate: "2026-01-31",
      series: "L",
      description: "Synthetic independent holiday change",
      rationale: "Independent ledger control change",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "holiday_expense",
          debitMinor: "100",
          creditMinor: "0",
          description: "Synthetic holiday change",
        },
        {
          accountId: "holiday_liability",
          debitMinor: "0",
          creditMinor: "100",
          description: "Synthetic holiday change",
        },
      ],
    },
    A.ChangeSet,
  );

  const approval = await post(
    f.reviewer,
    `/change-sets/${plan.id}/approvals`,
    { version: 1, planDigest: plan.planDigest },
    A.Approval,
  );

  await post(
    f.book,
    `/change-sets/${plan.id}/execute`,
    { version: 1, planDigest: plan.planDigest, approvalId: approval.id },
    A.ExecutionReceipt,
  );
}

test("recomputed assessment-family body hashes cannot forge the scoped input digest", async () => {
  const f = await variablePayFixture();
  const assessment = f.assessment.assessment;
  await post(
    f.book,
    `/payroll/variable-pay/assessments/${assessment.id}/dispositions`,
    {
      assessmentDigest: assessment.digest,
      selectionId: f.assessment.selection!.id,
      kind: "removed",
    },
    V.VariablePayReviewView,
  );
  const ready = await readyInput(f);
  const readySubmitted = await post(f.book, "/payroll/inputs", ready.input, Inputs.PayrollInput);
  const readyAssessment = await assessReady(f, readySubmitted, ready.retained);

  const readySelection = await post(
    f.book,
    `/payroll/variable-pay/assessments/${readyAssessment.assessment.id}/selections`,
    { assessmentDigest: readyAssessment.assessment.digest },
    V.VariablePayReviewView,
  );

  const unselected = await assessReady(f, readySubmitted, ready.retained);
  const admin = await database();
  const refused: string[] = [];

  try {
    for (const table of [
      "payroll_input_assessments",
      "payroll_input_pending_selections",
      "payroll_input_dispositions",
    ] as const) {
      const result = await admin.query(
        `select body from openerp.${table} where book_id=$1 and input_id=$2 limit 1`,
        [f.book.bookId, f.submitted.id],
      );

      const body = {
        ...result.rows[0].body,
        id: `forged_${key()}`,
        inputDigest: `sha256:${"0".repeat(64)}`,
      };

      if (table === "payroll_input_pending_selections") {
        body.inputId = readySubmitted.id;
        body.assessmentId = unselected.assessment.id;
        body.assessmentDigest = unselected.assessment.digest;
      }

      if (table === "payroll_input_dispositions") {
        body.inputId = readySubmitted.id;
        body.assessmentId = readyAssessment.assessment.id;
        body.assessmentDigest = readyAssessment.assessment.digest;
        body.selectionId = readySelection.selection!.id;
      }

      delete body.digest;
      await admin.query("begin");

      try {
        await expect(
          admin.query(
            `with candidate as (select $3::jsonb as body), signed as (select body || jsonb_build_object('digest',openerp.digest(body)) as body from candidate) insert into openerp.${table}(book_id,id,digest,body) select $1,$2,body->>'digest',body from signed`,
            [f.book.bookId, body.id, JSON.stringify(body)],
          ),
        ).rejects.toMatchObject({ code: "23503" });
        refused.push(table);
      } finally {
        await admin.query("rollback");
      }
    }
  } finally {
    await admin.end();
  }

  expect(refused).toHaveLength(3);
  await writeFile(
    join(environment().artifacts, "variable-pay-input-digest-lineage-refusals.json"),
    JSON.stringify({ inputId: f.submitted.id, inputDigest: f.submitted.digest, refused }, null, 2),
  );
});

test("an independent human identity's preassessment API credential approval cannot substitute for human session approval", async () => {
  const f = await variablePayFixture();
  const ready = await readyInput(f);
  const submitted = await post(f.book, "/payroll/inputs", ready.input, Inputs.PayrollInput);

  const review = await post(
    f.book,
    `/payroll/inputs/${submitted.id}/reviews`,
    { inputDigest: submitted.digest },
    Inputs.PayrollInputReview,
  );

  const credentialApproval = await post(
    f.credentialReviewer,
    `/payroll/input-reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Inputs.PayrollInputApproval,
  );

  expect(credentialApproval.actorId).toBe(f.reviewer.actorId);
  const assessment = await assessReady(f, submitted, ready.retained);

  const selected = await post(
    f.book,
    `/payroll/variable-pay/assessments/${assessment.assessment.id}/selections`,
    { assessmentDigest: assessment.assessment.digest },
    V.VariablePayReviewView,
  );

  expect(selected.financialApproval?.id).toBe(credentialApproval.id);
  expect(selected.financialApproval?.usable).toBe(false);
  await failure(
    await request(f.book, `/payroll/input-reviews/${review.id}/executions`, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ reviewDigest: review.digest, approvalId: credentialApproval.id }),
    }),
    403,
    "Forbidden",
  );

  const record = await decoded(
    await request(f.book, `/payroll/inputs/${submitted.id}`),
    Inputs.PayrollInputView,
  );

  expect(record.executions).toHaveLength(0);

  const humanApproval = await post(
    f.reviewer,
    `/payroll/input-reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Inputs.PayrollInputApproval,
  );

  const execution = await post(
    f.book,
    `/payroll/input-reviews/${review.id}/executions`,
    { reviewDigest: review.digest, approvalId: humanApproval.id },
    Inputs.PayrollInputExecution,
  );

  const current = await decoded(
    await request(f.book, `/payroll/variable-pay/assessments/${assessment.assessment.id}`),
    V.VariablePayReviewView,
  );

  expect(current.recognition?.id).toBe(execution.id);
  expect(current.current.assessmentCurrent).toBe(true);
  await writeFile(
    join(environment().artifacts, "variable-pay-approval-authentication-provenance.json"),
    JSON.stringify(
      { credentialApproval, selected, record, humanApproval, execution, current },
      null,
      2,
    ),
  );
});
