import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Collections from "@open-erp/contracts/collections";
import { legalFixture } from "./support/legal-commerce";
import { proveReminderRecovery } from "./support/reminder-recovery";
import { environment, post } from "./support/fixtures";

test("a fresh representable API runtime produces an authentic absent-0091 V4 bundle consumed by current fenced restore", async () => {
  const context = await legalFixture();

  const recipient = await post(
    context.author,
    `/commerce/directory/${context.customer.id}/recipient`,
    {
      expectedRevision: "0",
      expectedDigest: null,
      channel: "email",
      destination: "historical-recovery@example.invalid",
      purposes: ["payment_reminder"],
      status: "reviewed",
      reviewEvidence: context.original.draftSnapshot.sellerEvidence,
      reason: "Synthetic representable historical recipient",
      acknowledgeReviewedRecipient: true,
    },
    Collections.ReminderRecipientReference,
  );

  const message = await post(
    context.author,
    "/commerce/collections/reminders",
    {
      issueId: context.original.id,
      recipient,
    },
    Collections.ReminderMessage,
  );

  const approved = await post(
    context.author,
    `/commerce/collections/reminders/${message.id}/approvals`,
    {
      messageDigest: message.digest,
      acknowledgeExactMessage: true,
    },
    Collections.ReminderView,
  );

  const recoveries = await proveReminderRecovery(context.book.bookId, [7, 4]);

  expect(recoveries.map((recovery) => recovery.version)).toEqual([7, 4]);
  expect(approved.refusal).toBeNull();
  expect(approved.cancellation).toBeNull();

  for (const recovery of recoveries) {
    const inventory = recovery.inventory;

    if (inventory.version !== 7 && inventory.version !== 4)
      throw new Error("Historical reminder inventory missing");

    expect(recovery.restoredInventory).toEqual(inventory);
    expect(recovery.inspection.status).toBe("complete");
    expect(recovery.inspection.durableWork).toBe("matched");
    expect(recovery.receipt.durableWork?.inventoryVerification).toBe("matched");
    expect(recovery.suspension.resumeAllowed).toBe(false);
    expect(recovery.fence).toEqual({ allowConnections: false, connectionLimit: 0 });
    expect(
      inventory.reminderMessages
        .filter((row) => row.bookId === context.book.bookId)
        .map((row) => row.id),
    ).toEqual([message.id]);
    expect(
      inventory.reminderApprovals
        .filter((row) => row.bookId === context.book.bookId)
        .map((row) => row.messageId),
    ).toEqual([message.id]);

    if (inventory.version === 7) {
      expect(inventory.reminderRefusals).toEqual([]);
      expect(inventory.reminderResolutions).toEqual([]);
    } else {
      const transfer = recovery.historicalTransfer;

      if (!transfer) throw new Error("Historical transfer proof missing");
      expect(recovery.historicalRevision).not.toBeNull();
      expect(recovery.sourceMigrationNames).not.toContain("0091-reminder-terminal-review.sql");
      expect(recovery.sourceTables.map((row) => row.table)).not.toContain("reminder_refusals");
      expect(recovery.sourceTables.map((row) => row.table)).not.toContain("reminder_resolutions");
      expect(transfer.donorProjectedTables).toEqual(transfer.historicalDataTables);
      expect(transfer.donorOnlyEmptyTables).toEqual(
        expect.arrayContaining([
          { table: "openerp.reminder_refusals", rows: "0" },
          { table: "openerp.reminder_resolutions", rows: "0" },
        ]),
      );
      expect(recovery.bodyHashes).toEqual([
        ...inventory.reminderMessages
          .filter((row) => row.bookId === context.book.bookId)
          .map((row) => ({
            table: "reminder_messages",
            identity: row.id,
            bodySha256: row.bodySha256,
          })),
        ...inventory.reminderApprovals
          .filter((row) => row.bookId === context.book.bookId)
          .map((row) => ({
            table: "reminder_approvals",
            identity: row.messageId,
            bodySha256: row.bodySha256,
          })),
      ]);
    }
  }

  await writeFile(
    join(environment().artifacts, "reminder-pre0091-v4-fenced-recovery.json"),
    JSON.stringify(
      {
        command: "bun run test:e2e apps/api/tests/reminder-historical-v4.e2e.test.ts",
        scope: message.scope,
        message,
        approved,
        recoveries,
      },
      null,
      2,
    ),
  );
}, 300000);
