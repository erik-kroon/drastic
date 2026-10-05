import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assetClients, issueAssetInvoice } from "./asset-fixture-clients.mjs";

export { assetAccounts } from "./asset-fixture-clients.mjs";

export async function seedAssets(config) {
  const clients = await assetClients(config);

  const { book, author, source, post } = clients;

  const { reviewSource, today } = clients;

  const invoice = await issueAssetInvoice(clients, config.fixture);

  const period = config.fixture.periods[0].id;

  async function asset(name, gross, accumulation) {
    const carrying = (BigInt(gross) - BigInt(accumulation)).toString();

    const opening = await post(book, "/change-sets", {
      kind: "manual_journal",
      evidenceId: source.id,
      eventKey: randomUUID(),
      rationale: "Synthetic retained opening",
      taxAssessment: "not_applicable",
      postingDate: "2026-09-30",
      accountingPeriodId: period,
      series: "A",
      description: `Synthetic opening ${name}`,
      lines: [
        { accountId: "asset_gross", debitMinor: gross, creditMinor: "0", description: name },
        {
          accountId: "asset_ordinary",
          debitMinor: "0",
          creditMinor: accumulation,
          description: name,
        },
        {
          accountId: "account_clearing",
          debitMinor: "0",
          creditMinor: carrying,
          description: name,
        },
      ],
    });

    const approval = await post(author, `/change-sets/${opening.id}/approvals`, {
      planDigest: opening.planDigest,
      version: opening.version,
    });

    const receipt = await post(author, `/change-sets/${opening.id}/execute`, {
      planDigest: opening.planDigest,
      version: opening.version,
      approvalId: approval.id,
    });

    const schedule = await post(book, "/schedules", {
      sourceKey: randomUUID(),
      terms: {
        kind: "asset",
        name,
        evidenceId: source.id,
        rationale: "Synthetic retained opening",
        costMinor: carrying,
        residualMinor: "0",
        usefulPeriods: 2,
        allocationPolicy: "equal_minor_final_remainder_v1",
        debitAccountId: "asset_expense",
        creditAccountId: "asset_ordinary",
        series: "A",
        taxAssessment: "not_applicable",
        periods: ["2026-11-30", "2026-12-31"].map((postingDate) => ({
          postingDate,
          accountingPeriodId: period,
        })),
      },
    });

    const basis = await post(book, "/subledger-controls/bases", {
      scheduleId: schedule.scheduleId,
      expectedDigest: schedule.digest,
      kind: "imported_opening",
      effectiveOn: "2026-09-30",
      evidenceId: source.id,
      sourceLocator: `Q34 ${name}`,
      reviewEvidenceId: reviewSource.id,
      rationale: "Synthetic opening voucher owns exact gross and accumulation",
      originalCostMinor: gross,
      accumulatedMinor: accumulation,
      carryingMinor: carrying,
      voucherId: receipt.voucherId,
      lineIds: opening.groups[0].actions[0].lines.slice(0, 2).map((line) => line.lineId),
    });

    const review = await post(book, "/asset-disposals/prepare", {
      kind: "disposal",
      profile: "synthetic_asset_proceeds_v1",
      scheduleId: schedule.scheduleId,
      expectedDigest: schedule.digest,
      expectedBasisDigest: basis.digest,
      postingDate: today,
      accountingPeriodId: period,
      series: "A",
      gainAccountId: "asset_income",
      lossAccountId: "asset_loss",
      evidenceId: source.id,
      reviewEvidenceId: reviewSource.id,
      rationale: "Synthetic invoice source selection",
      acknowledgeSyntheticOnly: true,
      proceeds: {
        kind: "existing_legal_invoice",
        issueId: invoice.id,
        lineId: "paper_laptop_line",
        acknowledgeRevenueReclassification: true,
      },
    });

    return { schedule, review };
  }

  const monitor = await asset("Bildskärm 27 tum", "300000", "150000");

  const laptop = await asset("Laptop Pro 14", "800000", "150000");

  const approval = await post(author, `/asset-disposals/${laptop.review.id}/approve`, {
    version: 1,
    digest: laptop.review.digest,
    acknowledgeSyntheticOnly: true,
  });

  const effect = await post(author, `/asset-disposals/${laptop.review.id}/execute`, {
    version: 1,
    digest: laptop.review.digest,
    approvalId: approval.id,
    acknowledgeSyntheticOnly: true,
  });

  const result = {
    frame: "Q34",
    scheduleId: monitor.schedule.scheduleId,
    reviewId: monitor.review.id,
    issueId: invoice.id,
    occupiedEffectId: effect.id,
    occupiedVoucherId: effect.postingReceipt.voucherId,
  };

  await writeFile(
    join(config.artifacts, "asset-source-fixture.json"),
    JSON.stringify(result, null, 2),
  );

  return result;
}
