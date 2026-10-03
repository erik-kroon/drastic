import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import { legalFixture } from "./support/legal-commerce";
import { apiDirectory, createSession, database, decoded, environment, failure, fixture, journal, key, post, request } from "./support/fixtures";

const Reference = Schema.Struct({ partyId: Schema.String, revision: Schema.String, digest: Accounting.Digest });
const Recipient = Schema.Struct({ ...Reference.fields, destination: Schema.String });
const Message = Schema.Struct({
  id: Schema.String, scope: Accounting.Scope, issueId: Schema.String, invoiceId: Schema.String,
  outstandingMinor: Schema.String, preparedAt: Schema.String, recipient: Recipient,
  subject: Schema.String, plainText: Schema.String, html: Schema.String, digest: Accounting.Digest,
});
const Observation = Schema.Struct({ kind: Schema.String, observationId: Schema.String, externalIdentity: Schema.String });
const View = Schema.Struct({
  message: Message, status: Schema.String, delivered: Schema.Boolean,
  currentOutstandingMinor: Schema.NullOr(Schema.String),
  attempt: Schema.NullOr(Schema.Struct({ id: Schema.String, externalIdentity: Schema.String, messageDigest: Accounting.Digest })),
  observations: Schema.Array(Observation),
});

const base = "/commerce/collections/reminders";
type Context = Awaited<ReturnType<typeof legalFixture>>;
type Wire = { externalIdentity: string; messageDigest: string; destination: string; subject: string; plainText: string; html: string };

async function reviewed(context: Context) {
  return post(context.author, `/commerce/directory/${context.customer.id}/recipient`, {
    expectedRevision: "0", expectedDigest: null, channel: "email", destination: "billing@example.invalid",
    purposes: ["payment_reminder"], status: "reviewed", reviewEvidence: context.original.draftSnapshot.sellerEvidence,
    reason: "Synthetic reminder recipient", acknowledgeReviewedRecipient: true,
  }, Recipient);
}

async function prepare(context: Context, recipient: typeof Recipient.Type, idempotencyKey = key()) {
  return decoded(await request(context.author, base, { method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify({
    issueId: context.original.id, recipient: { partyId: recipient.partyId, revision: recipient.revision, digest: recipient.digest },
  }) }), Message);
}

async function approve(context: Context, message: typeof Message.Type) {
  return post(context.author, `${base}/${message.id}/approvals`, { messageDigest: message.digest, acknowledgeExactMessage: true }, View);
}

async function read(context: Context, message: typeof Message.Type) {
  return decoded(await request(context.author, `${base}/${message.id}`), View);
}

async function waitStatus(context: Context, message: typeof Message.Type, expected: string) {
  const deadline = Date.now() + 25000;
  let view = await read(context, message);

  while (view.status !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    view = await read(context, message);
  }

  expect(view.status).toBe(expected);

  return view;
}

async function fixtureTransport(mode: "accepted" | "unknown" | "rejected" | "crash" = "accepted") {
  const secret = randomBytes(32).toString("hex");
  const wires: Wire[] = [];
  const accepted = new Map<string, Wire>();
  const reads: string[] = [];
  let delivered = false;
  let crashed = false;
  let onAccepted: (() => void) | undefined;
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      if (incoming.headers.authorization !== `Bearer ${secret}`) {
        outgoing.writeHead(401).end();

        return;
      }

      if (incoming.method === "POST" && incoming.url === "/messages") {
        const chunks: Buffer[] = [];

        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const wire: Wire = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        wires.push(wire);
        accepted.set(wire.externalIdentity, wire);

        if (mode === "crash" && !crashed) {
          crashed = true;
          onAccepted?.();
          outgoing.destroy();

          return;
        }

        outgoing.setHeader("content-type", "application/json");
        outgoing.end(JSON.stringify({ kind: mode === "rejected" ? "rejected" : mode === "unknown" ? "unknown" : "accepted", observationId: `${wire.externalIdentity}/accepted`, externalIdentity: wire.externalIdentity }));

        return;
      }

      const identity = decodeURIComponent((incoming.url ?? "").replace("/messages/", ""));
      reads.push(identity);
      outgoing.setHeader("content-type", "application/json");
      outgoing.end(JSON.stringify({ kind: mode === "unknown" || !accepted.has(identity) ? "unknown" : delivered ? "delivered" : "accepted", observationId: `${identity}/${delivered ? "delivered" : "accepted"}`, externalIdentity: identity }));
    })().catch(() => outgoing.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (address === null || typeof address === "string") throw new Error("Loopback fixture port missing");

  return {
    endpoint: `http://127.0.0.1:${address.port}`, secret, wires, reads,
    deliver: () => { delivered = true; },
    onAccepted: (callback: () => void) => { onAccepted = callback; },
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

function runner(context: Context, transport: Awaited<ReturnType<typeof fixtureTransport>>) {
  const child = spawn("bun", ["scripts/preparation-runner.ts"], { cwd: apiDirectory, env: {
    ...process.env, DATABASE_URL: environment().runtimeUrl, OPENERP_PREPARATION_TOKEN: context.book.token,
    OPENERP_REMINDER_DELIVERY: "local-fixture", OPENERP_REMINDER_ENDPOINT: transport.endpoint, OPENERP_REMINDER_SECRET: transport.secret,
  }, stdio: "pipe" });

  return child;
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

async function settle(context: Context, amountMinor: string) {
  const source = context.original.sourceEvidence.evidenceId;
  const plan = await post(context.book, "/change-sets", {
    ...journal(source, amountMinor), postingDate: context.today, description: "Synthetic reminder settlement", lines: [
      { accountId: "account_bank", debitMinor: amountMinor, creditMinor: "0", description: "Synthetic payment" },
      { accountId: "account_ar", debitMinor: "0", creditMinor: amountMinor, description: "Synthetic receipt control" },
    ],
  }, Accounting.ChangeSet);
  const approval = await post(context.book, `/change-sets/${plan.id}/approvals`, { version: plan.version, planDigest: plan.planDigest }, Accounting.Approval);
  const receipt = await post(context.book, `/change-sets/${plan.id}/execute`, { version: plan.version, planDigest: plan.planDigest, approvalId: approval.id }, Accounting.ExecutionReceipt);
  const line = plan.groups[0]?.actions[0]?.lines.find((item) => item.accountId === "account_ar");

  if (!line) throw new Error("Retained payment line missing");
  const allocation = await post(context.book, "/commerce/allocation-plans", {
    voucherId: receipt.voucherId, lineId: line.lineId, evidenceId: source, rationale: "Synthetic reminder partial payment",
    allocations: [{ invoiceId: context.original.registerInvoiceId, amountMinor }],
  }, Commerce.AllocationPlan);
  const input = { version: 1, planDigest: allocation.digest };
  const allocationApproval = await post(context.book, `/commerce/allocation-plans/${allocation.id}/approvals`, input, Commerce.AllocationApproval);
  await post(context.book, `/commerce/allocation-plans/${allocation.id}/apply`, { ...input, approvalId: allocationApproval.id }, Commerce.AllocationReceipt);
}

test("reminders bind exact debt and reviewed bytes, retain acceptance separately from delivered evidence and preserve admitted history", async () => {
  const context = await legalFixture();
  const recipient = await reviewed(context);
  const prepareKey = key();
  const message = await prepare(context, recipient, prepareKey);
  expect(message.outstandingMinor).toBe("12500");
  expect(message.subject).toBe(`Payment reminder for invoice ${context.original.legalDocumentNumber}`);
  expect(message.plainText).toBe(`Payment reminder\nInvoice: ${context.original.legalDocumentNumber}\nDue date: ${context.original.draftSnapshot.content.dueDate}\nOutstanding as of ${message.preparedAt}: 125.00 SEK\nNo reminder fee or interest is included.\nIf you have already paid, please contact us so we can review the payment.`);
  expect(message.html).toContain("125.00 SEK");
  expect(await prepare(context, recipient, prepareKey)).toEqual(message);
  await failure(await request({ ...context.author, token: context.book.agentToken }, `${base}/${message.id}/approvals`, { method: "POST", body: JSON.stringify({ messageDigest: message.digest, acknowledgeExactMessage: true }) }), 403, "Forbidden");
  const other = await fixture();
  await failure(await request(other, `${base}/${message.id}`), 404, "NotFound");
  const approvals = await Promise.all([approve(context, message), approve(context, message)]);
  expect(approvals.map((view) => view.status)).toEqual(["approved", "approved"]);
  const transport = await fixtureTransport();
  const worker = runner(context, transport);

  try {
    const accepted = await waitStatus(context, message, "provider_accepted");
    expect(accepted.delivered).toBe(false);
    expect(accepted.attempt?.messageDigest).toBe(message.digest);
    expect(transport.wires).toEqual([{ externalIdentity: accepted.attempt?.externalIdentity, messageDigest: message.digest, destination: "billing@example.invalid", subject: message.subject, plainText: message.plainText, html: message.html }]);
    await settle(context, "4000");
    const paid = await read(context, message);
    expect(paid.message.outstandingMinor).toBe("12500");
    expect(paid.currentOutstandingMinor).toBe("8500");
    transport.deliver();
    await post(context.author, `${base}/${message.id}/reconcile`, { messageDigest: message.digest }, View);
    const delivered = await waitStatus(context, message, "delivered");
    expect(delivered.delivered).toBe(true);
    expect(delivered.observations.map((observation) => observation.kind)).toEqual(["accepted", "delivered"]);
    const admin = await database();

    try { await admin.query("DELETE FROM openerp.command_receipts WHERE book_id = $1", [context.book.bookId]); } finally { await admin.end(); }
    expect((await approve(context, message)).attempt?.id).toBe(delivered.attempt?.id);
    expect(transport.wires.length).toBe(1);
    await writeFile(join(environment().artifacts, "reminder-journey.json"), JSON.stringify({ message, accepted, paid, delivered, wire: transport.wires, providerReads: transport.reads }, null, 2));
  } finally { await stop(worker); await transport.close(); }
});

test("payment, holds, recipient withdrawal, cancellation and approval expiry refuse before admission", async () => {
  for (const blocker of ["payment", "hold", "recipient", "cancel", "session", "expiry", "membership"] as const) {
    const context = await legalFixture();
    const recipient = await reviewed(context);
    const message = await prepare(context, recipient);
    await approve(context, message);

    if (blocker === "payment") await settle(context, "4000");
    if (blocker === "hold") await post(context.book, "/commerce/collections/disputes", { invoiceId: message.invoiceId, reason: "Synthetic payment dispute", evidenceId: context.original.sourceEvidence.evidenceId, ownerId: context.book.actorId, holdReminders: true }, Schema.Unknown);
    if (blocker === "recipient") await post(context.author, `/commerce/directory/${context.customer.id}/recipient`, { expectedRevision: recipient.revision, expectedDigest: recipient.digest, channel: "email", destination: "withdrawn@example.invalid", purposes: ["payment_reminder"], status: "withdrawn", reviewEvidence: context.original.draftSnapshot.sellerEvidence, reason: "Synthetic withdrawal", acknowledgeReviewedRecipient: true }, Schema.Unknown);
    if (blocker === "cancel") await post(context.author, `${base}/${message.id}/cancel`, { messageDigest: message.digest }, View);
    if (blocker === "session") {
      const admin = await database();
      try { await admin.query('DELETE FROM openerp_auth.session WHERE token = $1', [context.author.token]); } finally { await admin.end(); }
      context.author.token = (await createSession(context.book)).token;
    }
    if (blocker === "expiry" || blocker === "membership") {
      const admin = await database();
      try {
        if (blocker === "expiry") await admin.query('UPDATE openerp_auth.session SET expires_at = now() - interval \'1 minute\' WHERE token = $1', [context.author.token]);
        else await admin.query("DELETE FROM openerp.memberships WHERE book_id = $1 AND actor_id = $2", [context.book.bookId, context.book.actorId]);
      } finally { await admin.end(); }
      context.author = context.reviewer;
    }
    const transport = await fixtureTransport();
    const worker = runner(context, transport);

    try {
      const refused = await waitStatus(context, message, blocker === "cancel" ? "cancelled" : "refused");
      expect(refused.attempt).toBe(null);
      expect(refused.currentOutstandingMinor).toBe(blocker === "payment" ? "8500" : "12500");
      expect(transport.wires).toEqual([]);
    } finally { await stop(worker); await transport.close(); }
  }
});

test("a lost post-acceptance response survives persistent runner restart using the same identity without a second message", async () => {
  const context = await legalFixture();
  const message = await prepare(context, await reviewed(context));
  await approve(context, message);
  const transport = await fixtureTransport("crash");
  let worker = runner(context, transport);
  transport.onAccepted(() => worker.kill("SIGKILL"));

  try {
    const deadline = Date.now() + 25000;
    while (transport.wires.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(transport.wires.length).toBe(1);
    await stop(worker);
    worker = runner(context, transport);
    const accepted = await waitStatus(context, message, "provider_accepted");
    expect(transport.wires.length).toBe(1);
    expect(transport.reads).toContain(accepted.attempt?.externalIdentity);
    expect(accepted.delivered).toBe(false);
    await writeFile(join(environment().artifacts, "reminder-restart.json"), JSON.stringify({ accepted, wire: transport.wires, reads: transport.reads }, null, 2));
  } finally { await stop(worker); await transport.close(); }
});

test("unknown outcomes and terminal rejections remain explicit and never trigger blind resend", async () => {
  for (const mode of ["unknown", "rejected"] as const) {
    const context = await legalFixture();
    const message = await prepare(context, await reviewed(context));
    await approve(context, message);
    const transport = await fixtureTransport(mode);
    const worker = runner(context, transport);

    try {
      const first = await waitStatus(context, message, mode === "unknown" ? "outcome_unknown" : "failed");
      expect(first.delivered).toBe(false);
      expect(transport.wires.length).toBe(1);
      await post(context.author, `${base}/${message.id}/reconcile`, { messageDigest: message.digest }, View);
      const again = await waitStatus(context, message, mode === "unknown" ? "outcome_unknown" : "failed");
      expect(again.attempt?.id).toBe(first.attempt?.id);
      expect(transport.wires.length).toBe(1);
      expect(transport.reads).toContain(first.attempt?.externalIdentity);
    } finally { await stop(worker); await transport.close(); }
  }
});
