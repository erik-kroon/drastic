import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Closing from "@open-erp/contracts/closing";
import * as Corrections from "@open-erp/contracts/corrections";
import * as Controls from "@open-erp/contracts/subledger-controls";
import * as Subledgers from "@open-erp/contracts/subledgers";
import {
  database,
  decoded,
  environment,
  evidence,
  execute,
  failure,
  fixture,
  journal,
  key,
  persisted,
  post,
  request,
} from "./support/fixtures";

async function assetFixture() {
  const book = await fixture([
    { id: "asset_gross", code: "1220", name: "Asset gross" },
    { id: "asset_ordinary", code: "1229", name: "Ordinary accumulation" },
    { id: "asset_expense", code: "7830", name: "Depreciation expense" },
    { id: "asset_impairment", code: "1228", name: "Impairment contra" },
    { id: "asset_loss", code: "7730", name: "Impairment loss" },
    { id: "asset_income", code: "3990", name: "Reversal income" },
  ]);

  const source = await evidence(book);
  const reviewSource = await evidence(book);

  const plan = await post(
    book,
    "/change-sets",
    {
      ...journal(source.id),
      lines: [
        {
          accountId: "asset_gross",
          debitMinor: "1000000",
          creditMinor: "0",
          description: "Retained gross",
        },
        {
          accountId: "asset_ordinary",
          debitMinor: "0",
          creditMinor: "200000",
          description: "Opening ordinary",
        },
        {
          accountId: "account_clearing",
          debitMinor: "0",
          creditMinor: "800000",
          description: "Opening funding",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const opening = await execute(book, plan);

  const dates = [
    "2026-09-30",
    "2026-10-10",
    "2026-10-20",
    "2026-10-30",
    "2026-11-10",
    "2026-11-20",
    "2026-11-30",
    "2026-12-10",
  ];

  const schedule = await post(
    book,
    "/schedules",
    {
      sourceKey: `asset_${key().replaceAll("-", "")}`,
      terms: {
        kind: "asset",
        name: "Synthetic machine",
        evidenceId: source.id,
        rationale: "Retained original without-impairment history",
        costMinor: "800000",
        residualMinor: "0",
        usefulPeriods: 8,
        allocationPolicy: "equal_minor_final_remainder_v1",
        debitAccountId: "asset_expense",
        creditAccountId: "asset_ordinary",
        series: "A",
        taxAssessment: "not_applicable",
        periods: dates.map((postingDate) => ({ postingDate, accountingPeriodId: "period_2026" })),
      },
    },
    Subledgers.ScheduleRevision,
  );

  const basis = await post(
    book,
    "/subledger-controls/bases",
    {
      scheduleId: schedule.scheduleId,
      expectedDigest: schedule.digest,
      kind: "imported_opening",
      effectiveOn: "2026-09-22",
      evidenceId: source.id,
      sourceLocator: "synthetic-asset-opening",
      reviewEvidenceId: reviewSource.id,
      rationale: "Gross and ordinary opening are independently retained",
      originalCostMinor: "1000000",
      accumulatedMinor: "200000",
      carryingMinor: "800000",
      voucherId: opening.voucherId,
      lineIds: plan.groups[0]?.actions[0]?.lines.slice(0, 2).map((line) => line.lineId) ?? [],
    },
    Controls.SubledgerBasis,
  );

  const impaired = await post(
    book,
    "/subledger-controls/impairments/prepare",
    {
      profile: "synthetic_asset_impairment_v1",
      scheduleId: schedule.scheduleId,
      decisionKey: key().replaceAll("-", ""),
      expectedDigest: schedule.digest,
      expectedBasisDigest: basis.digest,
      postingDate: "2026-10-04",
      accountingPeriodId: "period_2026",
      series: "A",
      lossAccountId: "asset_loss",
      accumulatedImpairmentAccountId: "asset_impairment",
      impairmentMinor: "300000",
      futureMinor: "500000",
      residualMinor: "0",
      installments: [
        { postingDate: "2026-11-20", accountingPeriodId: "period_2026", amountMinor: "250000" },
        { postingDate: "2026-12-20", accountingPeriodId: "period_2026", amountMinor: "250000" },
      ],
      evidenceId: source.id,
      reviewEvidenceId: reviewSource.id,
      rationale: "Reviewed initial impairment",
      taxAssessment: "not_applicable",
      acknowledgeSyntheticOnly: true,
    },
    Controls.AssetImpairmentReview,
  );

  const approval = await post(
    book,
    `/subledger-controls/impairments/${impaired.id}/approve`,
    { version: 1, digest: impaired.digest, acknowledgeSyntheticOnly: true },
    Controls.AssetImpairmentApproval,
  );

  await post(
    book,
    `/subledger-controls/impairments/${impaired.id}/execute`,
    {
      version: 1,
      digest: impaired.digest,
      approvalId: approval.id,
      acknowledgeSyntheticOnly: true,
    },
    Subledgers.AssetImpairment,
  );

  const input: typeof Controls.PrepareAssetValuation.Type = {
    profile: "synthetic_asset_valuation_v1",
    policyRelease: "synthetic_without_impairment_v1",
    scheduleId: schedule.scheduleId,
    decisionKey: key().replaceAll("-", ""),
    kind: "economic_reversal",
    correctionOf: null,
    expectedDigest: impaired.proposedRevision.digest,
    expectedBasisDigest: basis.digest,
    postingDate: "2026-10-04",
    accountingPeriodId: "period_2026",
    series: "A",
    targetCarryingMinor: "650000",
    residualMinor: "0",
    installments: [
      { postingDate: "2026-12-20", accountingPeriodId: "period_2026", amountMinor: "650000" },
    ],
    accumulatedImpairmentAccountId: "asset_impairment",
    incomeOrLossAccountId: "asset_income",
    evidenceId: source.id,
    reviewEvidenceId: reviewSource.id,
    rationale: "New economic recovery with retained original counterfactual",
    taxAssessment: "not_applicable",
    acknowledgeSyntheticOnly: true,
  };

  return { book, input, basis, schedule, impaired };
}

async function apply(
  book: Awaited<ReturnType<typeof fixture>>,
  input: typeof Controls.PrepareAssetValuation.Type,
) {
  const review = await post(
    book,
    "/subledger-controls/valuations/prepare",
    input,
    Controls.AssetValuationReview,
  );

  const approval = await post(
    book,
    `/subledger-controls/valuations/${review.id}/approve`,
    { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true },
    Controls.AssetValuationApproval,
  );

  await failure(
    await request(book, `/change-sets/${review.postingPlan.id}/execute`, {
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

  const command = {
    version: 1,
    digest: review.digest,
    acknowledgeSyntheticOnly: true,
    approvalId: approval.id,
  };

  const run = () =>
    request(book, `/subledger-controls/valuations/${review.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": executionKey },
      body: JSON.stringify(command),
    });

  const [first, second] = await Promise.all([run(), run()]);
  const event = await decoded(first, Subledgers.AssetValuationEvent);
  expect(await decoded(second, Subledgers.AssetValuationEvent)).toEqual(event);
  await failure(
    await request(book, `/subledger-controls/valuations/${review.id}/execute`, {
      method: "POST",
      body: JSON.stringify(command),
    }),
    409,
    "AlreadyPosted",
  );

  return { review, approval, event, executionKey, command };
}

test("economic reversal uses retained counterfactual cap and atomic current authority", async () => {
  const { book, input, schedule } = await assetFixture();
  const before = await persisted(book);

  const beforeClosing = await decoded(
    await request(book, "/periods/period_2026/closing-readiness"),
    Closing.ClosingReadiness,
  );

  await failure(
    await request(book, "/subledger-controls/valuations/prepare", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        targetCarryingMinor: "750000",
        installments: [
          { postingDate: "2026-12-20", accountingPeriodId: "period_2026", amountMinor: "750000" },
        ],
      }),
    }),
    422,
    "InvalidJournal",
  );
  expect(await persisted(book)).toEqual(before);
  const result = await apply(book, input);
  expect(result.review.basis.counterfactualCarryingMinor).toBe("700000");
  expect(result.event.magnitudeMinor).toBe("150000");
  expect(result.event.netImpairmentMinor).toBe("150000");

  const view = await decoded(
    await request(book, `/schedules/${schedule.scheduleId}`),
    Subledgers.ScheduleView,
  );

  expect(view.carryingMinor).toBe("650000");
  expect(view.netImpairmentMinor).toBe("150000");
  expect(view.postingBasis?.supported).toBe(true);
  const inventory = await evidence(book);

  const control = await post(
    book,
    "/subledger-controls/snapshots",
    {
      asOfDate: "2026-10-04",
      accountIds: ["asset_gross", "asset_ordinary", "asset_impairment"],
      inventoryEvidenceId: inventory.id,
      rationale: "Independently reconcile three asset roles",
    },
    Controls.SubledgerControl,
  );

  expect(control.controls.map((row) => row.differenceMinor)).toEqual(["0", "0", "0"]);
  expect(control.schedules[0]?.carryingMinor).toBe("650000");

  const closing = await decoded(
    await request(book, "/periods/period_2026/closing-readiness"),
    Closing.ClosingReadiness,
  );

  expect(closing.dependencies.scheduleDigest).not.toBe(beforeClosing.dependencies.scheduleDigest);
  expect(closing.dependencies.subledgerControls?.basisDigest).not.toBe(
    beforeClosing.dependencies.subledgerControls?.basisDigest,
  );

  const impact = await post(
    book,
    `/vouchers/${result.event.postingReceipt.voucherId}/correction-impact-reviews`,
    {
      datePolicy: "explicit_open_period",
      accountingPeriodId: "period_2026",
      postingDate: "2026-10-04",
      rationale: "Inspect owned valuation correction protection",
      replacement: {
        description: "Same retained reversal for impact inspection",
        lines:
          result.review.postingPlan.groups[0]?.actions[0]?.lines.map((line) => ({
            accountId: line.accountId,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
            description: line.description,
          })) ?? [],
      },
    },
    Corrections.CorrectionImpact,
  );

  expect(
    impact.basis.resources.some(
      (row) => row.kind === "schedule" && row.id === schedule.scheduleId && row.blocks,
    ),
  ).toBe(true);
  const admin = await database();

  try {
    await admin.query("DELETE FROM openerp.memberships WHERE book_id=$1 AND actor_id=$2", [
      book.bookId,
      book.actorId,
    ]);
  } finally {
    await admin.end();
  }

  await failure(
    await request(book, `/subledger-controls/valuations/${result.review.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": result.executionKey },
      body: JSON.stringify(result.command),
    }),
    403,
    "Forbidden",
  );
  await writeFile(
    join(environment().artifacts, "asset-valuation-reversal.json"),
    JSON.stringify({ input, result, view, control, beforeClosing, closing, impact }, null, 2),
  );
});

test("full impairment remains owned and no-proceeds disposal adds no loss", async () => {
  const { book, input, basis, schedule } = await assetFixture();

  const result = await apply(book, {
    ...input,
    kind: "full_impairment",
    targetCarryingMinor: "0",
    residualMinor: "0",
    installments: [],
    incomeOrLossAccountId: "asset_loss",
  });

  expect(result.event.magnitudeMinor).toBe("500000");

  const view = await decoded(
    await request(book, `/schedules/${schedule.scheduleId}`),
    Subledgers.ScheduleView,
  );

  expect(view.carryingMinor).toBe("0");
  expect(view.netImpairmentMinor).toBe("800000");
  expect(view.current.state).toBe("zero_carrying_in_use");
  expect(view.current.occurrences).toEqual([]);
  expect(view.disposal).toBeNull();
  const source = await evidence(book);

  const disposal = await post(
    book,
    "/subledger-controls/disposals/prepare",
    {
      profile: "synthetic_no_proceeds_asset_disposal_v1",
      scheduleId: schedule.scheduleId,
      expectedDigest: view.current.digest,
      expectedBasisDigest: basis.digest,
      postingDate: "2026-10-04",
      accountingPeriodId: "period_2026",
      series: "A",
      lossAccountId: "asset_loss",
      evidenceId: source.id,
      reviewEvidenceId: source.id,
      rationale: "End ownership after complete impairment",
      proceedsMinor: "0",
      taxAssessment: "not_applicable",
      acknowledgeSyntheticOnly: true,
    },
    Controls.AssetDisposalReview,
  );

  expect(disposal.basis.carryingMinor).toBe("0");
  expect(
    disposal.postingPlan.groups[0]?.actions[0]?.lines.some(
      (line) => line.accountId === "asset_loss",
    ),
  ).toBe(false);

  const approval = await post(
    book,
    `/subledger-controls/disposals/${disposal.id}/approve`,
    { version: 1, digest: disposal.digest, acknowledgeSyntheticOnly: true },
    Controls.AssetDisposalApproval,
  );

  const disposed = await post(
    book,
    `/subledger-controls/disposals/${disposal.id}/execute`,
    {
      version: 1,
      digest: disposal.digest,
      acknowledgeSyntheticOnly: true,
      approvalId: approval.id,
    },
    Subledgers.AssetDisposal,
  );

  expect(disposed.impairmentMinorReleased).toBe("800000");
  await failure(
    await request(book, "/subledger-controls/valuations/prepare", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        decisionKey: key().replaceAll("-", ""),
        expectedDigest: view.current.digest,
      }),
    }),
    409,
    "AlreadyPosted",
  );
  await writeFile(
    join(environment().artifacts, "asset-valuation-zero-disposal.json"),
    JSON.stringify({ result, view, disposal, disposed }, null, 2),
  );
});

test("recovery from zero uses fresh occurrence keys and immediate correction restores the owned basis", async () => {
  const { book, input, impaired } = await assetFixture();

  const zero = await apply(book, {
    ...input,
    kind: "full_impairment",
    targetCarryingMinor: "0",
    installments: [],
    incomeOrLossAccountId: "asset_loss",
  });

  const recovered = await apply(book, {
    ...input,
    decisionKey: key().replaceAll("-", ""),
    expectedDigest: zero.review.proposedRevision.digest,
    targetCarryingMinor: "300000",
    installments: [
      { postingDate: "2026-12-20", accountingPeriodId: "period_2026", amountMinor: "300000" },
    ],
  });

  const oldKeys = new Set(impaired.proposedRevision.occurrences.map((row) => row.eventKey));
  expect(
    recovered.review.proposedRevision.occurrences.every((row) => !oldKeys.has(row.eventKey)),
  ).toBe(true);
  expect(recovered.event.magnitudeMinor).toBe("300000");
  expect(recovered.event.netImpairmentMinor).toBe("500000");

  const correction = await apply(book, {
    ...input,
    decisionKey: key().replaceAll("-", ""),
    kind: "error_correction",
    correctionOf: recovered.event.id,
    expectedDigest: recovered.review.proposedRevision.digest,
    targetCarryingMinor: "0",
    installments: [],
  });

  expect(correction.event.direction).toBe("increase");
  expect(correction.event.netImpairmentMinor).toBe("800000");
  expect(correction.event.carryingMinor).toBe("0");
  await writeFile(
    join(environment().artifacts, "asset-valuation-recovery-correction.json"),
    JSON.stringify({ zero, recovered, correction }, null, 2),
  );
});

test("valuation refuses stale reviews, repeated decisions and consumed correction", async () => {
  const { book, input } = await assetFixture();

  const retired = await post(
    book,
    `/schedules/${input.scheduleId}/prepare`,
    { expectedDigest: input.expectedDigest, ordinal: 1 },
    Subledgers.SchedulePreparation,
  );

  const stale = await post(
    book,
    "/subledger-controls/valuations/prepare",
    input,
    Controls.AssetValuationReview,
  );

  await failure(
    await request(book, "/subledger-controls/valuations/prepare", {
      method: "POST",
      body: JSON.stringify(input),
    }),
    409,
    "IdempotencyConflict",
  );

  const changed = await apply(book, {
    ...input,
    decisionKey: key().replaceAll("-", ""),
    targetCarryingMinor: "600000",
    installments: [
      { postingDate: "2026-12-20", accountingPeriodId: "period_2026", amountMinor: "600000" },
    ],
  });

  await failure(
    await request(book, `/subledger-controls/valuations/${stale.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: stale.digest, acknowledgeSyntheticOnly: true }),
    }),
    409,
    "StaleDependency",
  );

  const occurrence = await post(
    book,
    `/schedules/${input.scheduleId}/prepare`,
    { expectedDigest: changed.review.proposedRevision.digest, ordinal: 1 },
    Subledgers.SchedulePreparation,
  );

  expect(occurrence.changeSetId).not.toBe(retired.changeSetId);

  const retiredPlan = await decoded(
    await request(book, `/change-sets/${retired.changeSetId}`),
    Accounting.ChangeSet,
  );

  await failure(
    await request(book, `/change-sets/${retiredPlan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ planDigest: retiredPlan.planDigest, version: retiredPlan.version }),
    }),
    409,
    "StaleDependency",
  );

  const plan = await decoded(
    await request(book, `/change-sets/${occurrence.changeSetId}`),
    Accounting.ChangeSet,
  );

  await execute(book, plan);
  await failure(
    await request(book, "/subledger-controls/valuations/prepare", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        decisionKey: key().replaceAll("-", ""),
        kind: "error_correction",
        correctionOf: changed.event.id,
        expectedDigest: changed.review.proposedRevision.digest,
        postingDate: "2026-12-20",
        targetCarryingMinor: "500000",
        installments: [
          { postingDate: "2026-12-30", accountingPeriodId: "period_2026", amountMinor: "500000" },
        ],
      }),
    }),
    422,
    "UnsupportedProfile",
  );
  await writeFile(
    join(environment().artifacts, "asset-valuation-consumed-correction.json"),
    JSON.stringify({ retired, changed, occurrence }, null, 2),
  );
});

test("a retained linked preparation without basis evidence is replaced before ordinary posting", async () => {
  const { book, input } = await assetFixture();
  const changed = await apply(book, input);
  const occurrence = changed.review.proposedRevision.occurrences[0];

  if (!occurrence) throw new Error("The recovered asset must have an ordinary occurrence");

  const legacy = await post(
    book,
    "/change-sets",
    {
      ...journal(input.evidenceId, "650000"),
      eventKey: occurrence.eventKey,
      postingDate: occurrence.postingDate,
      lines: [
        {
          accountId: "asset_expense",
          debitMinor: "650000",
          creditMinor: "0",
          description: "Ordinary expense",
        },
        {
          accountId: "asset_ordinary",
          debitMinor: "0",
          creditMinor: "650000",
          description: "Ordinary accumulation",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.subledger_preparations(book_id,schedule_id,revision,ordinal,attempt,change_set_id,basis_dependency) VALUES($1,$2,$3,1,1,$4,NULL)",
      [book.bookId, input.scheduleId, changed.review.proposedRevision.revision, legacy.id],
    );
  } finally {
    await admin.end();
  }

  const preparation = await post(
    book,
    `/schedules/${input.scheduleId}/prepare`,
    { expectedDigest: changed.review.proposedRevision.digest, ordinal: 1 },
    Subledgers.SchedulePreparation,
  );

  expect(preparation.changeSetId).not.toBe(legacy.id);

  const plan = await decoded(
    await request(book, `/change-sets/${preparation.changeSetId}`),
    Accounting.ChangeSet,
  );

  const receipt = await execute(book, plan);

  const view = await decoded(
    await request(book, `/schedules/${input.scheduleId}`),
    Subledgers.ScheduleView,
  );

  expect(view.recognizedMinor).toBe("650000");
  expect(view.carryingMinor).toBe("0");
  expect(view.occurrences[0]?.state).toBe("posted");
  await writeFile(
    join(environment().artifacts, "asset-valuation-preparation-recovery.json"),
    JSON.stringify({ legacy: legacy.id, preparation, receipt, view }, null, 2),
  );
});

test("late persistence failure rolls back journal, revision, valuation and retired authority", async () => {
  const { book, input } = await assetFixture();

  const review = await post(
    book,
    "/subledger-controls/valuations/prepare",
    input,
    Controls.AssetValuationReview,
  );

  const approval = await post(
    book,
    `/subledger-controls/valuations/${review.id}/approve`,
    { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true },
    Controls.AssetValuationApproval,
  );

  const command = {
    version: 1,
    digest: review.digest,
    acknowledgeSyntheticOnly: true,
    approvalId: approval.id,
  };

  const executionKey = key();
  const before = await persisted(book);
  const admin = await database();

  try {
    await admin.query(
      `ALTER TABLE openerp.subledger_retired_occurrences ADD CONSTRAINT synthetic_valuation_failure CHECK (book_id <> '${book.bookId}')`,
    );

    const response = await request(book, `/subledger-controls/valuations/${review.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": executionKey },
      body: JSON.stringify(command),
    });

    await failure(response, 500, "InternalError");
    expect(await persisted(book)).toEqual(before);

    const rows = (
      await admin.query(
        "SELECT (SELECT count(*)::int FROM openerp.subledger_valuations WHERE book_id=$1) AS events, (SELECT max(revision)::int FROM openerp.subledger_schedule_revisions WHERE book_id=$1) AS revision, (SELECT count(*)::int FROM openerp.subledger_retired_occurrences WHERE book_id=$1) AS retired",
        [book.bookId],
      )
    ).rows[0];

    expect(rows).toEqual({ events: 0, revision: 2, retired: 0 });
  } finally {
    await admin.query(
      "ALTER TABLE openerp.subledger_retired_occurrences DROP CONSTRAINT IF EXISTS synthetic_valuation_failure",
    );
    await admin.end();
  }

  const event = await decoded(
    await request(book, `/subledger-controls/valuations/${review.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": executionKey },
      body: JSON.stringify(command),
    }),
    Subledgers.AssetValuationEvent,
  );

  expect(event.magnitudeMinor).toBe("150000");
  await writeFile(
    join(environment().artifacts, "asset-valuation-rollback.json"),
    JSON.stringify({ before, event }, null, 2),
  );
});

test("a locked proposed installment period refuses approval and execution without financial effects", async () => {
  const { book, input } = await assetFixture();
  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.fiscal_years(book_id,id,starts_on,ends_on) VALUES($1,'fy_2027','2027-01-01','2027-12-31')",
      [book.bookId],
    );
    await admin.query(
      "INSERT INTO openerp.periods(book_id,id,fiscal_year_id,starts_on,ends_on) VALUES($1,'future_period','fy_2027','2027-01-01','2027-12-31')",
      [book.bookId],
    );
  } finally {
    await admin.end();
  }

  const review = await post(
    book,
    "/subledger-controls/valuations/prepare",
    {
      ...input,
      installments: [
        { postingDate: "2027-01-31", accountingPeriodId: "future_period", amountMinor: "650000" },
      ],
    },
    Controls.AssetValuationReview,
  );

  const approval = await post(
    book,
    `/subledger-controls/valuations/${review.id}/approve`,
    { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true },
    Controls.AssetValuationApproval,
  );

  const before = await persisted(book);
  const lock = await database();

  try {
    await lock.query(
      "UPDATE openerp.periods SET locked=true WHERE book_id=$1 AND id='future_period'",
      [book.bookId],
    );
  } finally {
    await lock.end();
  }

  await failure(
    await request(book, `/subledger-controls/valuations/${review.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: review.digest, acknowledgeSyntheticOnly: true }),
    }),
    409,
    "PeriodLocked",
  );
  await failure(
    await request(book, `/subledger-controls/valuations/${review.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        digest: review.digest,
        acknowledgeSyntheticOnly: true,
        approvalId: approval.id,
      }),
    }),
    409,
    "PeriodLocked",
  );
  expect(await persisted(book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "asset-valuation-future-period-refusal.json"),
    JSON.stringify({ review, approval, before }, null, 2),
  );
});
