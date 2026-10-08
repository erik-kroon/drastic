import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Collections from "@open-erp/contracts/collections";
import { legalFixture } from "./support/legal-commerce";
import { withPinnedReminderApi } from "./support/pinned-reminder-api";
import { proveReminderRecovery } from "./support/reminder-recovery";
import { environment, journal, post } from "./support/fixtures";

test("M60 V7 and authentic pre-0097 V6 preserve terminal work and refuse lossy V4 projection", async () => {
  const context = await legalFixture();

  const recipient = await post(
    context.author,
    `/commerce/directory/${context.customer.id}/recipient`,
    {
      expectedRevision: "0",
      expectedDigest: null,
      channel: "email",
      destination: "recovery@example.invalid",
      purposes: ["payment_reminder"],
      status: "reviewed",
      reviewEvidence: context.original.draftSnapshot.sellerEvidence,
      reason: "Synthetic recovery recipient",
      acknowledgeReviewedRecipient: true,
    },
    Collections.ReminderRecipientReference,
  );

  const { original, approved, checked, replacement, cancelled } = await withPinnedReminderApi(
    "3a3b2093",
    async (legacy) => {
      const original = await legacy.post(
        context.author,
        "/commerce/collections/reminders",
        {
          issueId: context.original.id,
          recipient,
        },
        Collections.ReminderMessage,
      );

      const approved = await legacy.post(
        context.author,
        `/commerce/collections/reminders/${original.id}/approvals`,
        {
          messageDigest: original.digest,
          acknowledgeExactMessage: true,
        },
        Collections.ReminderView,
      );

      const evidence = await post(
        context.book,
        "/evidence",
        {
          title: "Synthetic reminder recovery payment",
          mediaType: "text/plain",
          content: "Synthetic 4000-minor invoice settlement",
          origin: "M60 disposable recovery proof",
        },
        Accounting.Evidence,
      );

      const plan = await post(
        context.book,
        "/change-sets",
        {
          ...journal(evidence.id, "4000"),
          postingDate: context.today,
          lines: [
            {
              accountId: "account_bank",
              debitMinor: "4000",
              creditMinor: "0",
              description: "Synthetic payment",
            },
            {
              accountId: "account_ar",
              debitMinor: "0",
              creditMinor: "4000",
              description: "Synthetic settlement",
            },
          ],
        },
        Accounting.ChangeSet,
      );

      const paymentApproval = await post(
        context.book,
        `/change-sets/${plan.id}/approvals`,
        {
          version: plan.version,
          planDigest: plan.planDigest,
        },
        Accounting.Approval,
      );

      const payment = await post(
        context.book,
        `/change-sets/${plan.id}/execute`,
        {
          version: plan.version,
          planDigest: plan.planDigest,
          approvalId: paymentApproval.id,
        },
        Accounting.ExecutionReceipt,
      );

      const line = plan.groups[0]?.actions[0]?.lines.find(
        (item) => item.accountId === "account_ar",
      );

      if (!line) throw new Error("Synthetic settlement line missing");

      const allocation = await post(
        context.book,
        "/commerce/allocation-plans",
        {
          voucherId: payment.voucherId,
          lineId: line.lineId,
          evidenceId: evidence.id,
          rationale: "Synthetic reminder recovery settlement",
          allocations: [{ invoiceId: context.original.registerInvoiceId, amountMinor: "4000" }],
        },
        Commerce.AllocationPlan,
      );

      const allocationInput = { version: 1, planDigest: allocation.digest };

      const allocationApproval = await post(
        context.book,
        `/commerce/allocation-plans/${allocation.id}/approvals`,
        allocationInput,
        Commerce.AllocationApproval,
      );

      const allocationReceipt = await post(
        context.book,
        `/commerce/allocation-plans/${allocation.id}/apply`,
        {
          ...allocationInput,
          approvalId: allocationApproval.id,
        },
        Commerce.AllocationReceipt,
      );

      const checked = await legacy.post(
        context.author,
        `/commerce/collections/reminders/${original.id}/checks`,
        {
          messageDigest: original.digest,
        },
        Collections.ReminderView,
      );

      expect(original.outstandingMinor).toBe("12500");
      expect(checked.current.outstandingMinor).toBe("8500");
      expect(checked.refusal?.current.outstandingMinor).toBe("8500");
      expect(checked.refusal?.admission).toBe("not_admitted");
      expect(checked.refusal?.current.settlements.map((item) => item.receiptId)).toContain(
        allocationReceipt.id,
      );
      expect(checked.message).toEqual(original);
      expect(checked.approval).toEqual(approved.approval);
      expect(checked.attempt).toBe(null);

      const replacement = await legacy.post(
        context.author,
        `/commerce/collections/reminders/${original.id}/replacement`,
        {
          messageDigest: original.digest,
          recipient,
        },
        Collections.ReminderReplacement,
      );

      const cancelled = await legacy.post(
        context.author,
        `/commerce/collections/reminders/${replacement.message.id}/cancel`,
        {
          messageDigest: replacement.message.digest,
        },
        Collections.ReminderView,
      );

      expect(replacement.message.outstandingMinor).toBe("8500");
      expect(replacement.message.id).not.toBe(original.id);
      expect(replacement.resolution.kind).toBe("replaced");
      expect(cancelled.cancellation?.kind).toBe("cancelled");
      expect(cancelled.approval).toBe(null);
      expect(cancelled.attempt).toBe(null);

      return { original, approved, checked, replacement, cancelled };
    },
  );

  const recoveries = await proveReminderRecovery(context.book.bookId);
  expect(recoveries.map((recovery) => recovery.version)).toEqual([7, 6]);
  let v4Refusal: string | null = null;

  try {
    await proveReminderRecovery(context.book.bookId, [7, 4]);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    v4Refusal = error.message;
  }

  expect(v4Refusal).toMatch(
    /^Historical donor-only financial work cannot be discarded: openerp\.reminder_(refusals|resolutions)$/,
  );

  for (const recovery of recoveries) {
    expect(recovery.inventory.version).toBe(recovery.version);
    expect(recovery.restoredInventory).toEqual(recovery.inventory);
    expect(recovery.inspection.status).toBe("complete");
    expect(recovery.inspection.durableWork).toBe("matched");
    expect(recovery.receipt.durableWork?.inventoryVerification).toBe("matched");
    expect(recovery.suspension.inventoryVerification).toBe("matched");
    expect(recovery.suspension.resumeAllowed).toBe(false);
    expect(recovery.suspension.providerOutcomes).toBe("not-reconciled");
    expect(recovery.fence).toEqual({ allowConnections: false, connectionLimit: 0 });

    const inventory = recovery.inventory;

    if (inventory.version !== 4 && inventory.version !== 6 && inventory.version !== 7)
      throw new Error("Reminder recovery inventory version missing");

    const expectedBodies = [
      ...inventory.reminderMessages.map((row) => ({
        table: "reminder_messages",
        identity: row.id,
        ...row,
      })),
      ...inventory.reminderApprovals.map((row) => ({
        table: "reminder_approvals",
        identity: row.messageId,
        ...row,
      })),
      ...inventory.reminderAttempts.map((row) => ({
        table: "reminder_attempts",
        identity: row.id,
        ...row,
      })),
      ...inventory.reminderObservations.map((row) => ({
        table: "reminder_observations",
        identity: `${row.attemptId}/${row.observationId}`,
        ...row,
      })),
      ...(inventory.version === 6 || inventory.version === 7
        ? [
            ...inventory.reminderRefusals.map((row) => ({
              table: "reminder_refusals",
              identity: row.messageId,
              ...row,
            })),
            ...inventory.reminderResolutions.map((row) => ({
              table: "reminder_resolutions",
              identity: row.messageId,
              ...row,
            })),
          ]
        : []),
    ]
      .filter((row) => row.bookId === context.book.bookId)
      .map(({ table, identity, bodySha256 }) => ({ table, identity, bodySha256 }));

    expect(recovery.bodyHashes).toEqual(expectedBodies);

    if (recovery.version !== 7) {
      const transfer = recovery.historicalTransfer;

      if (!transfer) throw new Error("Historical transfer proof missing");
      expect(transfer.donorProjectedTables).toEqual(transfer.historicalDataTables);
      expect(
        transfer.projections.map((projection) => [projection.table, projection.column]),
      ).toEqual([
        ["openerp.payroll_adjustment_instructions", "net_claim_id"],
        ["openerp.payroll_recovery_allocations", "payroll_run_id"],
      ]);
      expect(
        transfer.projections.every(
          (projection) => projection.allValuesNull && projection.allBodyKeysAbsent,
        ),
      ).toBe(true);
      expect(transfer.donorRawTables).toHaveLength(transfer.historicalDataTables.length);
    }

    expect(
      inventory.reminderMessages
        .filter((row) => row.bookId === context.book.bookId)
        .map((row) => row.id)
        .sort(),
    ).toEqual([original.id, replacement.message.id].sort());

    if (inventory.version === 6 || inventory.version === 7) {
      expect(
        inventory.reminderRefusals
          .filter((row) => row.bookId === context.book.bookId)
          .map((row) => row.messageId),
      ).toEqual([original.id]);

      const resolutions = inventory.reminderResolutions
        .filter((row) => row.bookId === context.book.bookId)
        .map((row) => [row.messageId, row.replacementMessageId]);

      expect(resolutions).toHaveLength(2);
      expect(resolutions).toEqual(
        expect.arrayContaining([
          [original.id, replacement.message.id],
          [replacement.message.id, null],
        ]),
      );

      if (inventory.version === 6) {
        expect(recovery.historicalRevision).not.toBeNull();
        expect(recovery.sourceMigrationNames).not.toContain("0097-mileage-corrections.sql");
        expect(recovery.inventory).not.toHaveProperty("mileageCorrectionRecords");
      }
    } else {
      expect(recovery.sourceMigrationNames).not.toContain("0091-reminder-terminal-review.sql");
      expect(recovery.sourceTables.map((row) => row.table)).not.toContain("reminder_refusals");
      expect(recovery.sourceTables.map((row) => row.table)).not.toContain("reminder_resolutions");
    }
  }

  await writeFile(
    join(environment().artifacts, "reminder-m60-v7-v6-fenced-recovery.json"),
    JSON.stringify(
      {
        command: "bun run test:e2e apps/api/tests/reminder-recovery.e2e.test.ts",
        scope: original.scope,
        original,
        approved,
        checked,
        replacement,
        cancelled,
        recoveries,
        v4Refusal,
      },
      null,
      2,
    ),
  );
}, 450000);
