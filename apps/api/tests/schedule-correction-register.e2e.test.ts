import * as Accounting from "@open-erp/contracts/accounting";
import * as Corrections from "@open-erp/contracts/corrections";
import * as Schedules from "@open-erp/contracts/subledgers";
import * as Controls from "@open-erp/contracts/subledger-controls";
import { expect, test } from "vitest";
import {
  decoded,
  evidence,
  execute,
  failure,
  fixture,
  key,
  persisted,
  post,
  request,
} from "./support/fixtures";
import { injectScopedInsertFault, saveSanitizedJourney } from "./assurance/database-support";

async function setup() {
  const book = await fixture();

  const source = await evidence(book);

  const schedule = await post(
    book,
    "/schedules",
    {
      sourceKey: key(),
      terms: {
        kind: "deferral",
        name: "Synthetic three-month expense",
        evidenceId: source.id,
        rationale: "Independent 30000 allocation oracle",
        costMinor: "30000",
        residualMinor: "0",
        usefulPeriods: 3,
        allocationPolicy: "equal_minor_final_remainder_v1",
        debitAccountId: "account_bank",
        creditAccountId: "account_clearing",
        series: "A",
        taxAssessment: "not_applicable",
        periods: ["2026-09-30", "2026-10-31", "2026-11-30"].map((postingDate) => ({
          postingDate,
          accountingPeriodId: "period_2026",
        })),
      },
    },
    Schedules.ScheduleRevision,
  );

  const preparation = await post(
    book,
    `/schedules/${schedule.scheduleId}/prepare`,
    {
      expectedDigest: schedule.digest,
      ordinal: 1,
    },
    Schedules.SchedulePreparation,
  );

  const plan = await decoded(
    await request(book, `/change-sets/${preparation.changeSetId}`),
    Accounting.ChangeSet,
  );

  const original = await execute(book, plan);

  const before = await decoded(
    await request(book, `/schedules/${schedule.scheduleId}`),
    Schedules.ScheduleView,
  );

  const lines = plan.groups[0]?.actions[0]?.lines;

  if (!lines) throw new Error("Missing retained occurrence lines");

  const intent = {
    datePolicy: "explicit_open_period",
    accountingPeriodId: "period_2026",
    postingDate: "2026-10-04",
    rationale: "Restate exact occurrence in explicit open period",
    scheduleDecision: {
      kind: "preserve_remaining_plan",
      rationale: "Keep October and November 10000 each",
    },
    replacement: {
      description: "Retained occurrence replacement",
      lines: lines.map((line) => ({
        accountId: line.accountId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        description: line.description,
      })),
    },
  };

  return { book, source, schedule, preparation, original, before, intent };
}

async function prepare(context: Awaited<ReturnType<typeof setup>>) {
  const impact = await post(
    context.book,
    `/vouchers/${context.original.voucherId}/correction-impact-reviews`,
    context.intent,
    Corrections.CorrectionImpact,
  );

  expect(impact.basis.blockers).toEqual([]);

  const bundle = await post(
    context.book,
    `/vouchers/${context.original.voucherId}/correction-bundles`,
    {
      ...context.intent,
      impactReview: { id: impact.id, digest: impact.digest },
    },
    Corrections.CorrectionBundle,
  );

  const approval = await post(
    context.book,
    `/correction-bundles/${bundle.id}/approvals`,
    {
      version: 1,
      bundleDigest: bundle.bundleDigest,
    },
    Corrections.CorrectionBundleApproval,
  );

  return { bundle, approval };
}

test("ordinary occurrence compensation preserves ordinal, original and explicit remaining plan with exact replay", async () => {
  const context = await setup();

  const { bundle, approval } = await prepare(context);

  const input = { version: 1, bundleDigest: bundle.bundleDigest, approvalId: approval.id };

  const receipt = await post(
    context.book,
    `/correction-bundles/${bundle.id}/execute`,
    input,
    Corrections.CorrectionBundleReceipt,
  );

  const after = await decoded(
    await request(context.book, `/schedules/${context.schedule.scheduleId}`),
    Schedules.ScheduleView,
  );

  expect(after.current).toEqual(context.before.current);

  expect(after.recognizedMinor).toBe("10000");

  expect(after.remainingMinor).toBe("20000");

  expect(after.occurrences[0]).toMatchObject({
    ordinal: 1,
    eventKey: context.schedule.occurrences[0]?.eventKey,
    voucherId: context.original.voucherId,
    state: "posted",
  });

  expect(after.occurrences.slice(1)).toEqual(context.before.occurrences.slice(1));

  const control = await post(
    context.book,
    "/subledger-controls/snapshots",
    {
      asOfDate: "2026-10-04",
      accountIds: ["account_clearing"],
      inventoryEvidenceId: context.source.id,
      rationale: "Independent retained schedule control",
    },
    Controls.SubledgerControl,
  );

  await saveSanitizedJourney("schedule-occurrence-control-cutoff", { control });

  expect(control.schedules).toHaveLength(1);

  expect(control.schedules[0]?.revision.digest).toBe(context.schedule.digest);

  expect(control.controls.map((account) => account.differenceMinor)).toEqual(["0"]);

  const counts = await persisted(context.book);

  expect(
    await post(
      context.book,
      `/correction-bundles/${bundle.id}/execute`,
      input,
      Corrections.CorrectionBundleReceipt,
    ),
  ).toEqual(receipt);

  expect(await persisted(context.book)).toEqual(counts);

  await failure(
    await request(context.book, `/schedules/${context.schedule.scheduleId}/prepare`, {
      method: "POST",
      body: JSON.stringify({ expectedDigest: context.schedule.digest, ordinal: 1 }),
    }),
    409,
    "AlreadyPosted",
  );

  await saveSanitizedJourney("schedule-occurrence-correction", {
    bundle,
    receipt,
    before: context.before,
    after,
    counts,
    control,
  });
});

test("schedule owner refuses an implicit remaining plan and a late aggregate fault leaves original history intact", async () => {
  const context = await setup();

  const { scheduleDecision: _decision, ...implicit } = context.intent;

  const impact = await post(
    context.book,
    `/vouchers/${context.original.voucherId}/correction-impact-reviews`,
    implicit,
    Corrections.CorrectionImpact,
  );

  expect(impact.basis.blockers.length).toBeGreaterThan(0);

  const { bundle, approval } = await prepare(context);

  const before = await persisted(context.book);

  const remove = await injectScopedInsertFault(context.book, "correction_bundle_receipts");

  try {
    await failure(
      await request(context.book, `/correction-bundles/${bundle.id}/execute`, {
        method: "POST",
        body: JSON.stringify({
          version: 1,
          bundleDigest: bundle.bundleDigest,
          approvalId: approval.id,
        }),
      }),
      500,
      "InternalError",
    );

    expect(await persisted(context.book)).toEqual(before);

    expect(
      await decoded(
        await request(context.book, `/schedules/${context.schedule.scheduleId}`),
        Schedules.ScheduleView,
      ),
    ).toEqual(context.before);
  } finally {
    await remove();
  }

  await saveSanitizedJourney("schedule-occurrence-rollback", {
    bundle,
    before,
    after: await persisted(context.book),
  });
});
