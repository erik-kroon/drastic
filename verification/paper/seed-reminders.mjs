import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { assetClients } from "./asset-fixture-clients.mjs";
import { issuePeppolInvoice, peppolAccounts } from "./seed-peppol.mjs";

export const reminderAccounts = peppolAccounts;

export async function seedReminders(config) {
  const clients = await assetClients(config);
  const { post, author, reviewer, book } = clients;
  const today = clients.today;
  const source = clients.source;

  const issue = await issuePeppolInvoice(clients, config.fixture, {
    customerName: "Björkdalen Skogsförvaltning AB",
    grossMinor: "1875000",
    baseMinor: "1500000",
    taxMinor: "375000",
  });

  const partyId = issue.draftSnapshot.content.counterpartyId;

  const recipient = await post(author, `/commerce/directory/${partyId}/recipient`, {
    expectedRevision: "0",
    expectedDigest: null,
    channel: "email",
    destination: "ekonomi@bjorkdalen.example.test",
    purposes: ["payment_reminder"],
    status: "reviewed",
    reviewEvidence: { evidenceId: source.id, sha256: source.sha256 },
    reason: "Synthetic reminder recipient",
    acknowledgeReviewedRecipient: true,
  });

  const message = await post(author, "/commerce/collections/reminders", {
    issueId: issue.id,
    recipient: {
      partyId: recipient.partyId,
      revision: recipient.revision,
      digest: recipient.digest,
    },
  });

  await post(reviewer, `/commerce/collections/reminders/${message.id}/approvals`, {
    messageDigest: message.digest,
    acknowledgeExactMessage: true,
  });

  const paymentSource = await post(book, "/evidence", {
    title: "Synthetic reminder payment",
    mediaType: "text/plain",
    content: "Synthetic payment of 5000 SEK, no real bank or company",
    origin: "M60 disposable browser fixture",
  });

  const plan = await post(book, "/change-sets", {
    kind: "manual_journal",
    evidenceId: paymentSource.id,
    eventKey: randomUUID(),
    accountingPeriodId: config.fixture.periods[0].id,
    series: "A",
    postingDate: today,
    description: "Synthetic reminder settlement",
    rationale: "Exercise the complete posting boundary",
    taxAssessment: "not_applicable",
    lines: [
      {
        accountId: "account_bank",
        debitMinor: "500000",
        creditMinor: "0",
        description: "Synthetic payment",
      },
      {
        accountId: "account_ar",
        debitMinor: "0",
        creditMinor: "500000",
        description: "Synthetic receipt control",
      },
    ],
  });

  const approved = await post(book, `/change-sets/${plan.id}/approvals`, {
    version: plan.version,
    planDigest: plan.planDigest,
  });

  const posted = await post(book, `/change-sets/${plan.id}/execute`, {
    version: plan.version,
    planDigest: plan.planDigest,
    approvalId: approved.id,
  });

  const line = plan.groups[0].actions[0].lines.find((row) => row.accountId === "account_ar");

  if (!line) throw new Error("Synthetic payment AR line missing");

  const allocation = await post(book, "/commerce/allocation-plans", {
    voucherId: posted.voucherId,
    lineId: line.lineId,
    evidenceId: paymentSource.id,
    rationale: "Synthetic reminder payment",
    allocations: [{ invoiceId: issue.registerInvoiceId, amountMinor: "500000" }],
  });

  const allocationInput = { version: 1, planDigest: allocation.digest };

  const allocationApproval = await post(
    book,
    `/commerce/allocation-plans/${allocation.id}/approvals`,
    allocationInput,
  );

  await post(book, `/commerce/allocation-plans/${allocation.id}/apply`, {
    ...allocationInput,
    approvalId: allocationApproval.id,
  });

  const refused = await post(author, `/commerce/collections/reminders/${message.id}/checks`, {
    messageDigest: message.digest,
  });

  if (!refused.refusal || refused.attempt || refused.current.outstandingMinor !== "1375000")
    throw new Error("M60 requires actual changed-payment refusal");

  const result = {
    reminderId: message.id,
    invoiceId: issue.registerInvoiceId,
    legalNumber: issue.legalDocumentNumber,
    path: `/entities/${config.fixture.entity.id}/books/${config.fixture.book.id}/sales?view=collections&reminder=${message.id}`,
  };

  await writeFile(join(config.artifacts, "reminder-fixture.json"), JSON.stringify(result, null, 2));

  return result;
}
