import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function seedValuation(config, clients) {
  const { book, author, reviewer, post } = clients;

  const period = config.fixture.periods[0].id;

  const opening = await post(book, "/change-sets", {
    kind: "manual_journal",
    evidenceId: clients.source.id,
    eventKey: randomUUID(),
    rationale: "Synthetic Q35 gross and ordinary opening",
    taxAssessment: "not_applicable",
    postingDate: "2026-09-22",
    accountingPeriodId: period,
    series: "A",
    description: "Maskin, verkstad",
    lines: [
      {
        accountId: "asset_gross",
        debitMinor: "1000000",
        creditMinor: "0",
        description: "Maskin, verkstad",
      },
      {
        accountId: "asset_ordinary",
        debitMinor: "0",
        creditMinor: "200000",
        description: "Maskin, verkstad",
      },
      {
        accountId: "account_clearing",
        debitMinor: "0",
        creditMinor: "800000",
        description: "Maskin, verkstad",
      },
    ],
  });

  const openingApproval = await post(author, `/change-sets/${opening.id}/approvals`, {
    planDigest: opening.planDigest,
    version: opening.version,
  });

  const receipt = await post(author, `/change-sets/${opening.id}/execute`, {
    planDigest: opening.planDigest,
    version: opening.version,
    approvalId: openingApproval.id,
  });

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

  const schedule = await post(book, "/schedules", {
    sourceKey: randomUUID(),
    terms: {
      kind: "asset",
      name: "Maskin, verkstad",
      evidenceId: clients.source.id,
      rationale: "Retained original without impairment",
      costMinor: "800000",
      residualMinor: "0",
      usefulPeriods: 8,
      allocationPolicy: "equal_minor_final_remainder_v1",
      debitAccountId: "asset_expense",
      creditAccountId: "asset_ordinary",
      series: "A",
      taxAssessment: "not_applicable",
      periods: dates.map((postingDate) => ({ postingDate, accountingPeriodId: period })),
    },
  });

  const basis = await post(book, "/subledger-controls/bases", {
    scheduleId: schedule.scheduleId,
    expectedDigest: schedule.digest,
    kind: "imported_opening",
    effectiveOn: "2026-09-22",
    evidenceId: clients.source.id,
    sourceLocator: "Synthetic Q35 opening",
    reviewEvidenceId: clients.reviewSource.id,
    rationale: "Gross and ordinary opening are independently retained",
    originalCostMinor: "1000000",
    accumulatedMinor: "200000",
    carryingMinor: "800000",
    voucherId: receipt.voucherId,
    lineIds: opening.groups[0].actions[0].lines.slice(0, 2).map((line) => line.lineId),
  });

  const impaired = await post(book, "/subledger-controls/impairments/prepare", {
    profile: "synthetic_asset_impairment_v1",
    scheduleId: schedule.scheduleId,
    decisionKey: randomUUID(),
    expectedDigest: schedule.digest,
    expectedBasisDigest: basis.digest,
    postingDate: "2026-10-03",
    accountingPeriodId: period,
    series: "A",
    lossAccountId: "asset_loss",
    accumulatedImpairmentAccountId: "asset_impairment",
    impairmentMinor: "300000",
    futureMinor: "500000",
    residualMinor: "0",
    installments: [
      { postingDate: "2026-11-20", accountingPeriodId: period, amountMinor: "250000" },
      { postingDate: "2026-12-20", accountingPeriodId: period, amountMinor: "250000" },
    ],
    evidenceId: clients.source.id,
    reviewEvidenceId: clients.reviewSource.id,
    rationale: "Synthetic initial impairment",
    taxAssessment: "not_applicable",
    acknowledgeSyntheticOnly: true,
  });

  const impairedApproval = await post(
    author,
    `/subledger-controls/impairments/${impaired.id}/approve`,
    { version: 1, digest: impaired.digest, acknowledgeSyntheticOnly: true },
  );

  await post(author, `/subledger-controls/impairments/${impaired.id}/execute`, {
    version: 1,
    digest: impaired.digest,
    approvalId: impairedApproval.id,
    acknowledgeSyntheticOnly: true,
  });

  const review = await post(reviewer, "/subledger-controls/valuations/prepare", {
    profile: "synthetic_asset_valuation_v1",
    policyRelease: "synthetic_without_impairment_v1",
    scheduleId: schedule.scheduleId,
    decisionKey: randomUUID(),
    kind: "economic_reversal",
    correctionOf: null,
    expectedDigest: impaired.proposedRevision.digest,
    expectedBasisDigest: basis.digest,
    postingDate: "2026-10-03",
    accountingPeriodId: period,
    series: "A",
    targetCarryingMinor: "650000",
    residualMinor: "0",
    installments: [
      { postingDate: "2026-12-20", accountingPeriodId: period, amountMinor: "650000" },
    ],
    accumulatedImpairmentAccountId: "asset_impairment",
    incomeOrLossAccountId: "asset_reversal",
    evidenceId: clients.source.id,
    reviewEvidenceId: clients.reviewSource.id,
    rationale: "Synthetic retained reversal",
    taxAssessment: "not_applicable",
    acknowledgeSyntheticOnly: true,
  });

  const approval = await post(author, `/subledger-controls/valuations/${review.id}/approve`, {
    version: 1,
    digest: review.digest,
    acknowledgeSyntheticOnly: true,
  });

  const event = await post(author, `/subledger-controls/valuations/${review.id}/execute`, {
    version: 1,
    digest: review.digest,
    approvalId: approval.id,
    acknowledgeSyntheticOnly: true,
  });

  const result = {
    frame: "Q35",
    scheduleId: schedule.scheduleId,
    reviewId: review.id,
    eventId: event.id,
    voucherId: event.postingReceipt.voucherId,
  };

  await writeFile(
    join(config.artifacts, "asset-valuation-fixture.json"),
    JSON.stringify(result, null, 2),
  );

  return result;
}
