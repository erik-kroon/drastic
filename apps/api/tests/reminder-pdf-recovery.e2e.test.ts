import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Collections from "@open-erp/contracts/collections";
import * as LegalPdf from "@open-erp/contracts/legal-invoice-pdf";
import { legalFixture } from "./support/legal-commerce";
import { proveReminderRecovery } from "./support/reminder-recovery";
import { decoded, environment, post, request } from "./support/fixtures";

test("current fenced recovery preserves a PDF-bearing approval without dispatch authority", async () => {
  const context = await legalFixture();

  const recipient = await post(
    context.author,
    `/commerce/directory/${context.customer.id}/recipient`,
    {
      expectedRevision: "0",
      expectedDigest: null,
      channel: "email",
      destination: "pdf-recovery@example.invalid",
      purposes: ["payment_reminder"],
      status: "reviewed",
      reviewEvidence: context.original.draftSnapshot.sellerEvidence,
      reason: "Synthetic PDF recovery recipient",
      acknowledgeReviewedRecipient: true,
    },
    Collections.ReminderRecipientReference,
  );

  const message = await post(
    context.author,
    "/commerce/collections/reminders",
    { issueId: context.original.id, recipient },
    Collections.ReminderMessage,
  );

  const approved = await post(
    context.author,
    `/commerce/collections/reminders/${message.id}/approvals`,
    { messageDigest: message.digest, acknowledgeExactMessage: true },
    Collections.ReminderView,
  );

  expect(message.attachments).toHaveLength(1);
  expect(approved.attempt).toBeNull();

  const attachment = message.attachments[0];

  if (!attachment) throw new Error("Retained PDF reference missing");

  const pdf = await decoded(
    await request(context.author, `/commerce/legal-invoice-pdfs/${attachment.captureId}`),
    LegalPdf.LegalInvoicePdfView,
  );

  expect(pdf.artifact?.sha256).toBe(attachment.sha256);

  const recoveries = await proveReminderRecovery(context.book.bookId, [7]);

  const recovery = recoveries[0];

  if (!recovery || recovery.inventory.version !== 7)
    throw new Error("Current recovery proof missing");

  expect(recovery.restoredInventory).toEqual(recovery.inventory);
  expect(
    recovery.inventory.reminderOutbox
      .filter((row) => row.bookId === context.book.bookId)
      .map((row) => row.state),
  ).toEqual(["awaiting_dispatch"]);
  expect(recovery.inspection.durableWork).toBe("matched");
  expect(recovery.receipt.durableWork?.inventoryVerification).toBe("matched");
  expect(recovery.suspension.resumeAllowed).toBe(false);
  expect(recovery.fence).toEqual({ allowConnections: false, connectionLimit: 0 });

  await writeFile(
    join(environment().artifacts, "reminder-pdf-v7-fenced-recovery.json"),
    JSON.stringify({ scope: message.scope, message, approved, attachment, recoveries }, null, 2),
  );
}, 450000);
