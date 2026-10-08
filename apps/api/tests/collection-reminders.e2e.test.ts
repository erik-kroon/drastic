import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, totalmem } from "node:os";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Match from "effect/Match";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Collections from "@open-erp/contracts/collections";
import * as LegalPdf from "@open-erp/contracts/legal-invoice-pdf";
import { withWorkspaceBrowser } from "./support/workspace-browser";
import { withPinnedReminderApi } from "./support/pinned-reminder-api";
import { legalFixture } from "./support/legal-commerce";
import { captureWorkInventory } from "../scripts/operations/durable-work";
import { tableFingerprints } from "../scripts/operations/snapshot";
import {
  apiDirectory,
  createSession,
  database,
  decoded,
  environment,
  failure,
  fixture,
  journal,
  key,
  post,
  request,
} from "./support/fixtures";

const Reference = Schema.Struct({
  partyId: Schema.String,
  revision: Schema.String,
  digest: Accounting.Digest,
});

const Recipient = Schema.Struct({ ...Reference.fields, destination: Schema.String });

const Message = Schema.Struct({
  id: Schema.String,
  scope: Accounting.Scope,
  issueId: Schema.String,
  invoiceId: Schema.String,
  outstandingMinor: Schema.String,
  preparedAt: Schema.String,
  recipient: Recipient,
  subject: Schema.String,
  plainText: Schema.String,
  html: Schema.String,
  attachments: Schema.Array(Collections.ReminderAttachment),
  digest: Accounting.Digest,
});

const Observation = Schema.Struct({
  kind: Schema.String,
  observationId: Schema.String,
  externalIdentity: Schema.String,
});

const View = Schema.Struct({
  message: Message,
  approval: Schema.NullOr(Schema.JsonObject),
  status: Schema.String,
  delivered: Schema.Boolean,
  currentOutstandingMinor: Schema.NullOr(Schema.String),
  attempt: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      externalIdentity: Schema.String,
      messageDigest: Accounting.Digest,
    }),
  ),
  observations: Schema.Array(Observation),
});

const base = "/commerce/collections/reminders";

test("the original invoice PDF is sealed into approval and transported without regeneration", async () => {
  const context = await legalFixture();

  const message = await prepare(context, await reviewed(context));

  const full = await decoded(
    await request(context.author, `${base}/${message.id}`),
    Collections.ReminderView,
  );

  expect(full.message.attachments).toHaveLength(1);

  const attachment = full.message.attachments[0];

  if (!attachment) throw new Error("Invoice attachment missing");

  const pdf = await decoded(
    await request(context.author, `/commerce/legal-invoice-pdfs/${attachment.captureId}`),
    LegalPdf.LegalInvoicePdfView,
  );

  expect(pdf.capture.issueId).toBe(context.original.id);

  expect(pdf.artifact?.sha256).toBe(attachment.sha256);

  const transport = await fixtureTransport();

  await approve(context, message);

  await send(context, message);

  const worker = runner(context, transport);

  try {
    const accepted = await waitStatus(context, message, "provider_accepted");

    expect(transport.wires).toHaveLength(1);

    expect(transport.wires[0]?.attachments).toEqual([
      { ...attachment, contentBase64: pdf.artifact?.contentBase64 },
    ]);

    expect(
      createHash("sha256")
        .update(Buffer.from(pdf.artifact?.contentBase64 ?? "", "base64"))
        .digest("hex"),
    ).toBe(attachment.sha256);

    await writeFile(
      join(environment().artifacts, "reminder-pdf-attachment.json"),
      JSON.stringify({ attachment, accepted, wire: transport.wires[0] }, null, 2),
    );
  } finally {
    await stop(worker);
    await transport.close();
  }
}, 60000);

test("a missing retained PDF refuses admission durably without contacting the transport", async () => {
  const context = await legalFixture();
  const message = await prepare(context, await reviewed(context));
  await approve(context, message);
  await send(context, message);
  const attachment = message.attachments[0];

  if (!attachment) throw new Error("Retained PDF missing");
  const admin = await database();

  try {
    await admin.query("begin");
    await admin.query("set local session_replication_role=replica");
    await admin.query(
      "delete from openerp.ar_legal_pdf_artifacts where book_id=$1 and capture_id=$2",
      [context.book.bookId, attachment.captureId],
    );
    await admin.query("commit");
  } finally {
    await admin.end();
  }

  const transport = await fixtureTransport();
  const worker = runner(context, transport);

  try {
    await waitStatus(context, message, "refused");

    const retained = await decoded(
      await request(context.author, `${base}/${message.id}`),
      Collections.ReminderView,
    );

    expect(retained.refusal?.reasons).toContain("source_changed");
    expect(retained.attempt).toBeNull();
    expect(transport.wires).toHaveLength(0);
    await writeFile(
      join(environment().artifacts, "reminder-missing-pdf-refusal.json"),
      JSON.stringify(retained, null, 2),
    );
  } finally {
    await stop(worker);
    await transport.close();
  }
}, 60000);

test("only definitive non-acceptance permits a separately unapproved replacement and preserves the original attempt", async () => {
  for (const mode of ["rejected", "unknown", "accepted"] as const) {
    const context = await legalFixture();

    const recipient = await reviewed(context);

    const message = await prepare(context, recipient);

    await approve(context, message);

    await send(context, message);

    const transport = await fixtureTransport(mode);

    const worker = runner(context, transport);

    try {
      const original = await waitStatus(
        context,
        message,
        Match.value(mode).pipe(
          Match.when("rejected", () => "failed"),
          Match.when("unknown", () => "outcome_unknown"),
          Match.orElse(() => "provider_accepted"),
        ),
      );

      const response = await request(context.author, `${base}/${message.id}/replacement`, {
        method: "POST",
        headers: { "idempotency-key": key() },
        body: JSON.stringify({
          messageDigest: message.digest,
          recipient: {
            partyId: recipient.partyId,
            revision: recipient.revision,
            digest: recipient.digest,
          },
        }),
      });

      if (mode !== "rejected") {
        await failure(response, 409, "StaleDependency");
      } else {
        const replacement = await decoded(response, Collections.ReminderReplacement);

        const child = await decoded(
          await request(context.author, `${base}/${replacement.message.id}`),
          Collections.ReminderView,
        );

        expect(child.approval).toBeNull();

        expect(child.attempt).toBeNull();

        const frozen = await post(
          context.author,
          `${base}/${message.id}/reconcile`,
          { messageDigest: message.digest },
          Collections.ReminderView,
        );

        expect(frozen.status).toBe("failed");

        if (!original.attempt) throw new Error("Original attempt missing");

        expect(frozen.attempt).toMatchObject(original.attempt);
        expect(transport.reads).toHaveLength(0);

        expect(child.status).toBe("prepared");

        const retained = await read(context, message);

        expect(retained.attempt).toEqual(original.attempt);

        expect(retained.observations).toEqual(original.observations);

        expect(retained.status).toBe("failed");

        await writeFile(
          join(environment().artifacts, "reminder-definitive-rejection-replacement.json"),
          JSON.stringify({ original, replacement, child, retained }, null, 2),
        );
      }

      expect(transport.wires).toHaveLength(1);
    } finally {
      await stop(worker);
      await transport.close();
    }
  }
}, 90000);

test("approval alone never dispatches and explicit send converges on one attempt", async () => {
  const context = await legalFixture();
  const recipient = await reviewed(context);
  const message = await prepare(context, recipient);
  const transport = await fixtureTransport();
  const worker = runner(context, transport);

  try {
    const approved = await approve(context, message);
    expect(approved.status).toBe("approved");
    expect(approved.attempt).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(transport.wires).toMatchObject([]);
    expect((await read(context, message)).attempt).toBeNull();

    const outcomes = await Promise.all([send(context, message), send(context, message)]);
    expect(outcomes.every((outcome) => outcome.message.digest === message.digest)).toBe(true);
    const accepted = await waitStatus(context, message, "provider_accepted");
    expect(transport.wires).toHaveLength(1);
    expect(accepted.attempt?.messageDigest).toBe(message.digest);
    expect((await send(context, message)).attempt).toEqual(accepted.attempt);
    expect(transport.wires).toHaveLength(1);
    await writeFile(
      join(environment().artifacts, "reminder-explicit-send.json"),
      JSON.stringify({ approved, accepted, wires: transport.wires }, null, 2),
    );
  } finally {
    await stop(worker);
    await transport.close();
  }
}, 60000);

test("M60 retains changed-payment refusal, cancellation and a separate current-balance proposal", async () => {
  const context = await legalFixture();
  const recipient = await reviewed(context);
  const original = await prepare(context, recipient);
  const approved = await approve(context, original);
  const initialCheckKey = key();
  const initialCheckInput = { messageDigest: original.digest };

  const initialCheck = await decoded(
    await request(context.author, `${base}/${original.id}/checks`, {
      method: "POST",
      headers: { "idempotency-key": initialCheckKey },
      body: JSON.stringify(initialCheckInput),
    }),
    Collections.ReminderView,
  );

  expect(initialCheck.approvalUsable).toBe(true);
  await settle(context, "4000");

  const before = await decoded(
    await request(context.author, `${base}/${original.id}`),
    Collections.ReminderView,
  );

  expect(before.approval).toEqual(approved.approval);
  expect(before.approvalUsable).toBe(false);
  expect(before.current.outstandingMinor).toBe(
    (BigInt(original.outstandingMinor) - 4000n).toString(),
  );

  const replayedCheck = await decoded(
    await request(context.author, `${base}/${original.id}/checks`, {
      method: "POST",
      headers: { "idempotency-key": initialCheckKey },
      body: JSON.stringify(initialCheckInput),
    }),
    Collections.ReminderView,
  );

  expect(replayedCheck.approvalUsable).toBe(false);
  expect(replayedCheck.refusal).toBe(null);
  await failure(
    await request(context.author, `${base}/${original.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ messageDigest: original.digest, acknowledgeExactMessage: true }),
    }),
    409,
    "StaleDependency",
  );

  const checked = await post(
    context.author,
    `${base}/${original.id}/checks`,
    { messageDigest: original.digest },
    Collections.ReminderView,
  );

  expect(checked.refusal?.current.outstandingMinor).toBe(before.current.outstandingMinor);
  expect(checked.attempt).toBe(null);

  const checkedAgain = await post(
    context.author,
    `${base}/${original.id}/checks`,
    { messageDigest: original.digest },
    Collections.ReminderView,
  );

  expect(checkedAgain.refusal).toEqual(checked.refusal);
  const replacementKey = key();

  const replacementInput = {
    messageDigest: original.digest,
    recipient: {
      partyId: recipient.partyId,
      revision: recipient.revision,
      digest: recipient.digest,
    },
  };

  const replacement = await decoded(
    await request(context.author, `${base}/${original.id}/replacement`, {
      method: "POST",
      headers: { "idempotency-key": replacementKey },
      body: JSON.stringify(replacementInput),
    }),
    Collections.ReminderReplacement,
  );

  const fresh = replacement.message;
  expect(fresh.id).not.toBe(original.id);
  expect(fresh.outstandingMinor).toBe(before.current.outstandingMinor);

  const old = await decoded(
    await request(context.author, `${base}/${original.id}`),
    Collections.ReminderView,
  );

  expect(old.resolution).toEqual(replacement.resolution);
  expect(old.refusal).toEqual(checked.refusal);

  const repeated = await decoded(
    await request(context.author, `${base}/${original.id}/replacement`, {
      method: "POST",
      headers: { "idempotency-key": replacementKey },
      body: JSON.stringify(replacementInput),
    }),
    Collections.ReminderReplacement,
  );

  expect(repeated).toEqual(replacement);

  const cancelled = await post(
    context.author,
    `${base}/${fresh.id}/cancel`,
    { messageDigest: fresh.digest },
    Collections.ReminderView,
  );

  expect(cancelled.cancellation?.messageDigest).toBe(fresh.digest);
  expect(cancelled.message.digest).toBe(fresh.digest);
  expect(cancelled.approval).toBe(null);
  expect(cancelled.attempt).toBe(null);

  const replay = await post(
    context.author,
    `${base}/${fresh.id}/cancel`,
    { messageDigest: fresh.digest },
    Collections.ReminderView,
  );

  expect(replay.cancellation).toEqual(cancelled.cancellation);

  const history = await decoded(
    await request(context.author, `${base}?invoiceId=${encodeURIComponent(original.invoiceId)}`),
    Collections.ReminderHistoryPage,
  );

  expect(history.items.map((item) => item.id)).toContain(original.id);
  expect(history.items.map((item) => item.id)).toContain(fresh.id);
  await writeFile(
    join(environment().artifacts, "reminder-m60-refusal-cancellation.json"),
    JSON.stringify({ before, checked, cancelled, fresh, history }, null, 2),
  );
});

type Context = Awaited<ReturnType<typeof legalFixture>>;

const WireSchema = Schema.Struct({
  externalIdentity: Schema.String,
  messageDigest: Accounting.Digest,
  destination: Schema.String,
  subject: Schema.String,
  plainText: Schema.String,
  html: Schema.String,
  attachments: Schema.Array(
    Schema.Struct({ ...Collections.ReminderAttachment.fields, contentBase64: Schema.String }),
  ),
});

type Wire = typeof WireSchema.Type;

async function reviewed(context: Context) {
  return post(
    context.author,
    `/commerce/directory/${context.customer.id}/recipient`,
    {
      expectedRevision: "0",
      expectedDigest: null,
      channel: "email",
      destination: "billing@example.invalid",
      purposes: ["payment_reminder"],
      status: "reviewed",
      reviewEvidence: context.original.draftSnapshot.sellerEvidence,
      reason: "Synthetic reminder recipient",
      acknowledgeReviewedRecipient: true,
    },
    Recipient,
  );
}

async function prepare(context: Context, recipient: typeof Recipient.Type, idempotencyKey = key()) {
  return decoded(
    await request(context.author, base, {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify({
        issueId: context.original.id,
        recipient: {
          partyId: recipient.partyId,
          revision: recipient.revision,
          digest: recipient.digest,
        },
      }),
    }),
    Message,
  );
}

async function approve(context: Context, message: typeof Message.Type) {
  return post(
    context.author,
    `${base}/${message.id}/approvals`,
    { messageDigest: message.digest, acknowledgeExactMessage: true },
    View,
  );
}

async function send(context: Context, message: typeof Message.Type) {
  return post(
    context.author,
    `${base}/${message.id}/dispatch`,
    { messageDigest: message.digest },
    View,
  );
}

async function read(context: Context, message: typeof Message.Type) {
  return decoded(await request(context.author, `${base}/${message.id}`), View);
}

async function waitStatus(
  context: Context,
  message: typeof Message.Type,
  expected: string,
  timeoutMs = 25000,
) {
  const deadline = Date.now() + timeoutMs;
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

        const wire = Schema.decodeSync(Schema.fromJsonString(WireSchema))(
          Buffer.concat(chunks).toString("utf8"),
        );

        wires.push(wire);
        accepted.set(wire.externalIdentity, wire);

        if (mode === "crash" && !crashed) {
          crashed = true;
          onAccepted?.();
          outgoing.destroy();

          return;
        }

        outgoing.setHeader("content-type", "application/json");
        outgoing.end(
          JSON.stringify({
            kind: Match.value(mode).pipe(
              Match.when("rejected", () => "rejected"),
              Match.when("unknown", () => "unknown"),
              Match.orElse(() => "accepted"),
            ),
            observationId: `${wire.externalIdentity}/accepted`,
            externalIdentity: wire.externalIdentity,
          }),
        );

        return;
      }

      const identity = decodeURIComponent((incoming.url ?? "").replace("/messages/", ""));
      reads.push(identity);
      outgoing.setHeader("content-type", "application/json");
      outgoing.end(
        JSON.stringify({
          kind:
            mode === "rejected"
              ? "rejected"
              : mode === "unknown" || !accepted.has(identity)
                ? "unknown"
                : delivered
                  ? "delivered"
                  : "accepted",
          observationId: `${identity}/${delivered ? "delivered" : "accepted"}`,
          externalIdentity: identity,
        }),
      );
    })().catch(() => outgoing.destroy());
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (address === null || typeof address === "string")
    throw new Error("Loopback fixture port missing");

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    secret,
    wires,
    reads,
    deliver: () => {
      delivered = true;
    },
    onAccepted: (callback: () => void) => {
      onAccepted = callback;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

type Runner = {
  readonly child: ChildProcess;
  readonly closed: Promise<void>;
  readonly logPath: string;
  output: string;
};

function runner(
  context: Context,
  transport: Awaited<ReturnType<typeof fixtureTransport>>,
  configureTransport = true,
) {
  const child = spawn("bun", ["scripts/preparation-runner.ts"], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      DATABASE_URL: environment().runtimeUrl,
      OPENERP_PREPARATION_TOKEN: context.book.token,
      OPENERP_DOCUMENT_READER: "disabled",
      OPENERP_OBJECT_DIRECTORY: "",
      EVIDENCE_STORE_ROOT: "",
      OPENERP_REMINDER_DELIVERY: configureTransport ? "local-fixture" : undefined,
      OPENERP_REMINDER_ENDPOINT: transport.endpoint,
      OPENERP_REMINDER_SECRET: transport.secret,
    },
    stdio: "pipe",
  });

  const handle: Runner = {
    child,
    closed: new Promise<void>((resolve) => child.once("close", () => resolve())),
    logPath: join(environment().artifacts, `reminder-runner-${context.book.bookId}-${key()}.log`),
    output: "",
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    handle.output += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    handle.output += chunk.toString("utf8");
  });

  return handle;
}

async function stop(handle: Runner) {
  if (handle.child.exitCode === null && handle.child.signalCode === null)
    handle.child.kill("SIGTERM");
  await handle.closed;
  await writeFile(handle.logPath, handle.output);
}

async function settle(context: Context, amountMinor: string) {
  const retained = await post(
    context.book,
    "/evidence",
    {
      title: "Synthetic reminder payment",
      content: JSON.stringify({
        kind: "synthetic_reminder_payment",
        issueId: context.original.id,
        amountMinor,
        on: context.today,
        identity: key(),
      }),
      mediaType: "application/json",
      origin: "Disposable reminder payment fixture",
    },
    Accounting.Evidence,
  );

  const source = retained.id;
  expect(source).not.toBe(context.original.sourceEvidence.evidenceId);

  const plan = await post(
    context.book,
    "/change-sets",
    {
      ...journal(source, amountMinor),
      postingDate: context.today,
      description: "Synthetic reminder settlement",
      lines: [
        {
          accountId: "account_bank",
          debitMinor: amountMinor,
          creditMinor: "0",
          description: "Synthetic payment",
        },
        {
          accountId: "account_ar",
          debitMinor: "0",
          creditMinor: amountMinor,
          description: "Synthetic receipt control",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const approval = await post(
    context.book,
    `/change-sets/${plan.id}/approvals`,
    { version: plan.version, planDigest: plan.planDigest },
    Accounting.Approval,
  );

  const receipt = await post(
    context.book,
    `/change-sets/${plan.id}/execute`,
    { version: plan.version, planDigest: plan.planDigest, approvalId: approval.id },
    Accounting.ExecutionReceipt,
  );

  const line = plan.groups[0]?.actions[0]?.lines.find((item) => item.accountId === "account_ar");

  if (!line) throw new Error("Retained payment line missing");

  const allocation = await post(
    context.book,
    "/commerce/allocation-plans",
    {
      voucherId: receipt.voucherId,
      lineId: line.lineId,
      evidenceId: source,
      rationale: "Synthetic reminder partial payment",
      allocations: [{ invoiceId: context.original.registerInvoiceId, amountMinor }],
    },
    Commerce.AllocationPlan,
  );

  const input = { version: 1, planDigest: allocation.digest };

  const allocationApproval = await post(
    context.book,
    `/commerce/allocation-plans/${allocation.id}/approvals`,
    input,
    Commerce.AllocationApproval,
  );

  await post(
    context.book,
    `/commerce/allocation-plans/${allocation.id}/apply`,
    { ...input, approvalId: allocationApproval.id },
    Commerce.AllocationReceipt,
  );
}

test("reminders bind exact debt and reviewed bytes, retain acceptance separately from delivered evidence and preserve admitted history", async () => {
  const context = await legalFixture();
  const recipient = await reviewed(context);

  const historical = await post(
    context.book,
    "/commerce/collections/actions",
    {
      invoiceId: context.original.registerInvoiceId,
      kind: "reminder_prepared",
      note: "Historical synthetic preparation without send authority",
      ownerId: context.book.actorId,
      disputeId: null,
    },
    Schema.Struct({ id: Schema.String, sendAuthorized: Schema.Boolean }),
  );

  expect(historical.sendAuthorized).toBe(false);
  const prepareKey = key();
  const message = await prepare(context, recipient, prepareKey);
  await failure(
    await request(context.author, base, {
      method: "POST",
      body: JSON.stringify({
        issueId: context.original.id,
        recipient: {
          partyId: recipient.partyId,
          revision: recipient.revision,
          digest: recipient.digest,
        },
        outstandingMinor: "1",
      }),
    }),
    400,
    "InvalidRequest",
  );
  await failure(
    await request(context.author, base, {
      method: "POST",
      body: JSON.stringify({
        issueId: context.original.id,
        recipient: {
          partyId: "foreign_customer",
          revision: recipient.revision,
          digest: recipient.digest,
        },
      }),
    }),
    409,
    "StaleDependency",
  );
  expect(message.outstandingMinor).toBe("12500");

  const due = new Intl.DateTimeFormat("sv", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Stockholm",
  }).format(new Date(`${context.original.draftSnapshot.content.dueDate}T12:00:00Z`));

  expect(message.subject).toBe(
    `Påminnelse: faktura ${context.original.legalDocumentNumber}, förföll ${due}`,
  );
  expect(message.plainText).toBe(
    `Hej,\n\nfaktura ${context.original.legalDocumentNumber} på 125,00 kr förföll den ${due}. Vi ser att den ännu inte är betald. Betala gärna snarast, uppgifterna finns på den bifogade fakturan.\n\nHör av dig om fakturan redan är betald eller om något är oklart.\n\nVänliga hälsningar\n${context.original.policySnapshot.candidate.input.sellerIdentity.legalName}`,
  );
  expect(message.html).toContain("125,00 kr");
  expect(await prepare(context, recipient, prepareKey)).toEqual(message);

  for (const action of ["approvals", "cancel", "reconcile"] as const) {
    const input =
      action === "approvals"
        ? {
            messageDigest: message.digest,
            acknowledgeExactMessage: true,
            externalIdentity: "request_must_not_choose_identity",
          }
        : { messageDigest: message.digest, externalIdentity: "request_must_not_choose_identity" };

    await failure(
      await request(context.author, `${base}/${message.id}/${action}`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
      400,
      "InvalidRequest",
    );
  }

  const unchanged = await read(context, message);

  expect(unchanged.status).toBe("prepared");
  expect(unchanged.approval).toBeNull();
  expect(unchanged.attempt).toBeNull();

  for (const token of [context.book.agentToken, context.book.token])
    await failure(
      await request({ ...context.author, token }, `${base}/${message.id}/approvals`, {
        method: "POST",
        body: JSON.stringify({ messageDigest: message.digest, acknowledgeExactMessage: true }),
      }),
      403,
      "Forbidden",
    );

  const catalogResponse = await fetch(`${environment().baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${context.book.agentToken}`,
      "content-type": "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

  const catalog = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
    }),
  )(await catalogResponse.json());

  const names = catalog.result.tools.map((tool) => tool.name);
  expect(names).toContain("collections_prepare_reminder");
  expect(names).toContain("collections_read_reminder");
  expect(names).not.toContain("collections_approve_reminder");

  const rpcRead = await fetch(`${environment().baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${context.book.agentToken}`,
      "content-type": "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "collections_read_reminder",
        arguments: { scope: message.scope, reminderId: message.id },
      },
    }),
  });

  const readResult = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({ structuredContent: Schema.Struct({ result: View }) }),
    }),
  )(await rpcRead.json());

  expect(readResult.result.structuredContent.result.message).toEqual(message);

  const rpcPrepare = await fetch(`${environment().baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${context.book.agentToken}`,
      "content-type": "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "collections_prepare_reminder",
        arguments: {
          scope: message.scope,
          idempotencyKey: key(),
          issueId: context.original.id,
          recipient: {
            partyId: recipient.partyId,
            revision: recipient.revision,
            digest: recipient.digest,
          },
        },
      },
    }),
  });

  const prepareResult = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({ structuredContent: Schema.Struct({ result: Message }) }),
    }),
  )(await rpcPrepare.json());

  expect(prepareResult.result.structuredContent.result.outstandingMinor).toBe("12500");
  expect(prepareResult.result.structuredContent.result.recipient.destination).toBe(
    "billing@example.invalid",
  );

  const other = await fixture();
  await failure(await request(other, `${base}/${message.id}`), 404, "NotFound");
  const approvals = await Promise.all([approve(context, message), approve(context, message)]);
  expect(approvals.map((view) => view.status)).toEqual(["approved", "approved"]);
  await send(context, message);
  const transport = await fixtureTransport();
  const worker = runner(context, transport);

  try {
    const accepted = await waitStatus(context, message, "provider_accepted");
    expect(accepted.delivered).toBe(false);
    expect(accepted.attempt?.messageDigest).toBe(message.digest);
    expect(transport.wires).toMatchObject([
      {
        externalIdentity: accepted.attempt?.externalIdentity,
        messageDigest: message.digest,
        destination: "billing@example.invalid",
        subject: message.subject,
        plainText: message.plainText,
        html: message.html,
      },
    ]);
    await settle(context, "4000");
    const paid = await read(context, message);
    expect(paid.message.outstandingMinor).toBe("12500");
    expect(paid.currentOutstandingMinor).toBe("8500");
    const adminSession = await database();

    try {
      await adminSession.query("DELETE FROM openerp_auth.session WHERE token = $1", [
        context.author.token,
      ]);
    } finally {
      await adminSession.end();
    }

    context.author.token = (await createSession(context.book)).token;
    transport.deliver();
    await post(
      context.author,
      `${base}/${message.id}/reconcile`,
      { messageDigest: message.digest },
      View,
    );
    const delivered = await waitStatus(context, message, "delivered");
    expect(delivered.delivered).toBe(true);
    expect(delivered.observations.map((observation) => observation.kind)).toEqual([
      "accepted",
      "delivered",
    ]);
    const admin = await database();

    try {
      await admin.query("SET session_replication_role = replica");
      await admin.query("DELETE FROM openerp.command_receipts WHERE book_id = $1", [
        context.book.bookId,
      ]);
      await admin.query("SET session_replication_role = origin");
    } finally {
      await admin.end();
    }

    await failure(
      await request(context.author, `${base}/${message.id}/approvals`, {
        method: "POST",
        body: JSON.stringify({ messageDigest: message.digest, acknowledgeExactMessage: true }),
      }),
      403,
      "ApprovalRequired",
    );
    expect((await read(context, message)).attempt?.id).toBe(delivered.attempt?.id);
    expect(transport.wires.length).toBe(1);
    await writeFile(
      join(environment().artifacts, "reminder-journey.json"),
      JSON.stringify(
        {
          historical,
          excessPayloadFieldsRefused: [
            "prepare.outstandingMinor",
            "approve.externalIdentity",
            "cancel.externalIdentity",
            "reconcile.externalIdentity",
          ],
          message,
          accepted,
          paid,
          delivered,
          wire: transport.wires,
          providerReads: transport.reads,
        },
        null,
        2,
      ),
    );
  } finally {
    await stop(worker);
    await transport.close();
  }
});

test("payment, holds, recipient withdrawal, cancellation and approval expiry refuse before admission", async () => {
  for (const blocker of [
    "payment",
    "hold",
    "resolved_hold",
    "recipient",
    "cancel",
    "session",
    "expiry",
    "approval_expiry",
    "membership",
  ] as const) {
    const context = await legalFixture();

    if (blocker === "membership") context.author = context.reviewer;
    const recipient = await reviewed(context);
    const message = await prepare(context, recipient);
    await approve(context, message);
    await send(context, message);

    if (blocker === "payment") await settle(context, "4000");

    if (blocker === "hold" || blocker === "resolved_hold") {
      const dispute = await post(
        context.book,
        "/commerce/collections/disputes",
        {
          invoiceId: message.invoiceId,
          reason: "Synthetic payment dispute",
          evidenceId: context.original.sourceEvidence.evidenceId,
          ownerId: context.book.actorId,
          holdReminders: true,
        },
        Schema.Struct({ id: Schema.String }),
      );

      if (blocker === "resolved_hold")
        await post(
          context.book,
          "/commerce/collections/actions",
          {
            invoiceId: message.invoiceId,
            kind: "dispute_resolved",
            note: "Synthetic dispute resolved after reminder approval",
            ownerId: context.book.actorId,
            disputeId: dispute.id,
          },
          Schema.Unknown,
        );
    }

    if (blocker === "recipient")
      await post(
        context.author,
        `/commerce/directory/${context.customer.id}/recipient`,
        {
          expectedRevision: recipient.revision,
          expectedDigest: recipient.digest,
          channel: "email",
          destination: "withdrawn@example.invalid",
          purposes: ["payment_reminder"],
          status: "withdrawn",
          reviewEvidence: context.original.draftSnapshot.sellerEvidence,
          reason: "Synthetic withdrawal",
          acknowledgeReviewedRecipient: true,
        },
        Schema.Unknown,
      );

    if (blocker === "cancel")
      await post(
        context.author,
        `${base}/${message.id}/cancel`,
        { messageDigest: message.digest },
        View,
      );

    if (blocker === "session") {
      const admin = await database();

      try {
        await admin.query("DELETE FROM openerp_auth.session WHERE token = $1", [
          context.author.token,
        ]);
      } finally {
        await admin.end();
      }

      context.author.token = (await createSession(context.book)).token;
    }

    if (blocker === "approval_expiry") {
      const admin = await database();

      try {
        await admin.query("SET session_replication_role = replica");
        await admin.query(
          "UPDATE openerp.reminder_approvals SET body = basis.body || jsonb_build_object('digest', openerp.digest(basis.body)) FROM (SELECT book_id, message_id, (body - 'digest') || jsonb_build_object('expiresAt', '2000-01-01T00:00:00.000Z') AS body FROM openerp.reminder_approvals WHERE book_id = $1 AND message_id = $2) basis WHERE reminder_approvals.book_id = basis.book_id AND reminder_approvals.message_id = basis.message_id",
          [context.book.bookId, message.id],
        );
        await admin.query("SET session_replication_role = origin");
      } finally {
        await admin.end();
      }
    }

    if (blocker === "expiry" || blocker === "membership") {
      const admin = await database();

      try {
        if (blocker === "expiry")
          await admin.query(
            "UPDATE openerp_auth.session SET expires_at = now() - interval '1 minute' WHERE token = $1",
            [context.author.token],
          );
        else
          await admin.query(
            "DELETE FROM openerp.memberships WHERE book_id = $1 AND actor_id = $2",
            [context.book.bookId, context.author.actorId],
          );
      } finally {
        await admin.end();
      }

      context.author =
        blocker === "membership"
          ? { ...context.book, token: (await createSession(context.book)).token }
          : context.reviewer;
    }

    const transport = await fixtureTransport();
    const worker = runner(context, transport);

    try {
      const refused = await waitStatus(
        context,
        message,
        blocker === "cancel" ? "cancelled" : "refused",
      );

      expect(refused.attempt).toBe(null);
      expect(refused.currentOutstandingMinor).toBe(blocker === "payment" ? "8500" : "12500");
      expect(transport.wires).toMatchObject([]);
    } finally {
      await stop(worker);
      await transport.close();
    }
  }
}, 90000);

test("a lost post-acceptance response survives persistent runner restart using the same identity without a second message", async () => {
  const context = await legalFixture();
  const message = await prepare(context, await reviewed(context));
  await approve(context, message);
  await send(context, message);
  const transport = await fixtureTransport("crash");
  let worker = runner(context, transport);
  transport.onAccepted(() => worker.child.kill("SIGKILL"));

  try {
    const deadline = Date.now() + 25000;

    while (transport.wires.length === 0 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    expect(transport.wires.length).toBe(1);
    await stop(worker);
    worker = runner(context, transport);
    const accepted = await waitStatus(context, message, "provider_accepted", 75000);
    expect(transport.wires.length).toBe(1);
    expect(transport.reads).toContain(accepted.attempt?.externalIdentity);
    expect(accepted.delivered).toBe(false);
    await writeFile(
      join(environment().artifacts, "reminder-restart.json"),
      JSON.stringify({ accepted, wire: transport.wires, reads: transport.reads }, null, 2),
    );
  } finally {
    await stop(worker);
    await transport.close();
  }
}, 90000);

test("unknown outcomes and terminal rejections remain explicit and never trigger blind resend", async () => {
  for (const mode of ["unknown", "rejected"] as const) {
    const context = await legalFixture();
    const message = await prepare(context, await reviewed(context));
    await approve(context, message);
    await send(context, message);
    const transport = await fixtureTransport(mode);
    let worker = runner(context, transport);

    try {
      const first = await waitStatus(
        context,
        message,
        mode === "unknown" ? "outcome_unknown" : "failed",
      );

      expect(first.delivered).toBe(false);
      expect(transport.wires.length).toBe(1);
      await stop(worker);
      const admin = await database();
      let removedQueueRows = 0;

      try {
        const removed = await admin.query(
          "DELETE FROM public.effect_mq_jobs WHERE name='payment-reminder' AND metadata->>'bookId'=$1",
          [context.book.bookId],
        );

        removedQueueRows = removed.rowCount ?? 0;
        expect(removedQueueRows).toBeGreaterThan(0);
      } finally {
        await admin.end();
      }

      await post(
        context.author,
        `${base}/${message.id}/reconcile`,
        { messageDigest: message.digest },
        View,
      );

      worker = runner(context, transport);

      const again = await waitStatus(
        context,
        message,
        mode === "unknown" ? "outcome_unknown" : "failed",
      );

      expect(again.attempt?.id).toBe(first.attempt?.id);
      expect(transport.wires.length).toBe(1);
      expect(transport.reads).toContain(first.attempt?.externalIdentity);
      await writeFile(
        join(environment().artifacts, `reminder-pruned-${mode}-queue.json`),
        JSON.stringify(
          { removedQueueRows, first, again, wire: transport.wires, providerReads: transport.reads },
          null,
          2,
        ),
      );
    } finally {
      await stop(worker);
      await transport.close();
    }
  }
});

test("the collections caller reviews recipient and exact bytes before a browser approval and shows retained local acceptance", async () => {
  const context = await legalFixture();
  await reviewed(context);
  const transport = await fixtureTransport();
  const worker = runner(context, transport);

  try {
    const browserActor = await fixture();
    const admin = await database();

    try {
      await admin.query(
        "INSERT INTO openerp.memberships(book_id,actor_id,role) VALUES($1,$2,'operator')",
        [context.book.bookId, browserActor.actorId],
      );
    } finally {
      await admin.end();
    }

    await withWorkspaceBrowser(
      { ...context.book, actorId: browserActor.actorId },
      "reminder-review",
      async (page, workspace) => {
        await page.goto(`${workspace}/sales?view=collections`);
        await page.getByLabel("Issued invoice ID", { exact: true }).fill(context.original.id);
        await page.getByLabel("Issued invoice ID", { exact: true }).press("Tab");
        await page.keyboard.press("Enter");
        await page.getByRole("button", { name: "Prepare exact reminder", exact: true }).click();
        await page.getByRole("button", { name: "Godkänn utskick", exact: true }).waitFor();
        expect(await page.getByText("billing@example.invalid", { exact: true }).count()).toBe(1);
        expect(
          await page.locator("pre:visible").filter({ hasText: "125,00 kr" }).first().innerText(),
        ).toContain("125,00 kr");
        expect(transport.wires).toMatchObject([]);
        await page.screenshot({
          path: join(environment().artifacts, "reminder-exact-review.png"),
          fullPage: true,
        });

        const approval = page.getByRole("button", {
          name: "Godkänn utskick",
          exact: true,
        });

        await approval.focus();
        await page.keyboard.press("Enter");
        await page.getByRole("button", { name: "Skicka påminnelsen", exact: true }).click();
        await page
          .getByRole("heading", { name: "E-posttjänsten har accepterat påminnelsen", exact: true })
          .waitFor();
        expect(transport.wires.length).toBe(1);
        expect(transport.wires[0]?.destination).toBe("billing@example.invalid");
        await page.screenshot({
          path: join(environment().artifacts, "reminder-local-accepted.png"),
          fullPage: true,
        });
        await writeFile(
          join(environment().artifacts, "reminder-browser.json"),
          JSON.stringify(
            {
              wire: transport.wires,
              path: page.url(),
              keyboardApproval: true,
              browserZoomVerified: false,
            },
            null,
            2,
          ),
        );
      },
    );
  } finally {
    await stop(worker);
    await transport.close();
  }
}, 120000);

test("fixed reminder fixtures retain five warmups and thirty public-boundary timing samples", async () => {
  const context = await legalFixture();
  const recipient = await reviewed(context);
  const readSamples: number[] = [];

  const baseline = process.env.OPENERP_REMINDER_BASELINE === "1";
  let baselineRevision: string | null = null;

  async function sampleWorklist(fetch: () => Promise<Response>) {
    for (let index = 0; index < 35; index += 1) {
      const started = performance.now();

      const worklist = await decoded(
        await fetch(),
        Schema.Struct({
          items: Schema.Array(Schema.Struct({ residualMinor: Schema.NullOr(Schema.String) })),
        }),
      );

      const durationMs = performance.now() - started;
      expect(worklist.items[0]?.residualMinor).toBe("12500");

      if (index >= 5) readSamples.push(durationMs);
    }
  }

  if (baseline) {
    await withPinnedReminderApi("3776363e^", async (api) => {
      baselineRevision = api.revision;
      await sampleWorklist(() => api.fetch(context.book, "/commerce/collections/worklist"));
      await failure(
        await api.fetch(context.author, base, {
          method: "POST",
          body: JSON.stringify({
            issueId: context.original.id,
            recipient: {
              partyId: recipient.partyId,
              revision: recipient.revision,
              digest: recipient.digest,
            },
          }),
        }),
        404,
        "NotFound",
      );
    });
  } else {
    await sampleWorklist(() => request(context.book, "/commerce/collections/worklist"));
  }

  const previewSamples: number[] = [];
  const dispatchSamples: number[] = [];
  const queueWaitSamples: number[] = [];

  if (!baseline) {
    const transport = await fixtureTransport();
    const worker = runner(context, transport);

    try {
      for (let index = 0; index < 35; index += 1) {
        const started = performance.now();
        const message = await prepare(context, recipient);
        const previewMs = performance.now() - started;
        const approved = await approve(context, message);
        await send(context, message);
        const accepted = await waitStatus(context, message, "provider_accepted");
        expect(message.outstandingMinor).toBe("12500");
        const admin = await database();
        let admittedAt: string;
        let recordedAt: string;
        let approvedAt: string;

        try {
          const times = await admin.query<{
            admittedAt: string;
            recordedAt: string;
            approvedAt: string;
          }>(
            `SELECT a.body->>'admittedAt' AS "admittedAt", o.body->>'recordedAt' AS "recordedAt", p.body->>'approvedAt' AS "approvedAt" FROM openerp.reminder_attempts a JOIN openerp.reminder_observations o ON o.book_id = a.book_id AND o.attempt_id = a.id JOIN openerp.reminder_approvals p ON p.book_id = a.book_id AND p.message_id = a.message_id WHERE a.book_id = $1 AND a.message_id = $2 AND o.body->>'kind' = 'accepted'`,
            [context.book.bookId, message.id],
          );

          const time = times.rows[0];

          if (!time) throw new Error("Retained dispatch timestamps missing");
          ({ admittedAt, recordedAt, approvedAt } = time);
        } finally {
          await admin.end();
        }

        expect(approved.status).toBe("approved");
        expect(accepted.delivered).toBe(false);

        if (index >= 5) {
          previewSamples.push(previewMs);
          dispatchSamples.push(Date.parse(recordedAt) - Date.parse(admittedAt));
          queueWaitSamples.push(Date.parse(admittedAt) - Date.parse(approvedAt));
        }
      }

      expect(transport.wires.length).toBe(35);
    } finally {
      await stop(worker);
      await transport.close();
    }
  }

  function summary(samples: number[]) {
    const sorted = [...samples].sort((left, right) => left - right);

    return { samples, p50Ms: sorted[14] ?? null, p95Ms: sorted[28] ?? null };
  }

  let existingBudgetMs: number | null = null;
  const receiptPath = process.env.OPENERP_REMINDER_BASELINE_RECEIPT;

  if (!baseline && receiptPath) {
    const receipt = Schema.decodeSync(
      Schema.fromJsonString(
        Schema.Struct({
          warmups: Schema.Literal(5),
          measuredSamples: Schema.Literal(30),
          feature: Schema.Literal("absent"),
          existingWorklist: Schema.Struct({ p95Ms: Schema.Finite }),
        }),
      ),
    )(await readFile(receiptPath, "utf8"));

    existingBudgetMs = Math.max(
      receipt.existingWorklist.p95Ms * 1.2,
      receipt.existingWorklist.p95Ms + 50,
    );
  }

  const results = {
    machine: {
      platform: platform(),
      architecture: arch(),
      cpuModel: cpus()[0]?.model ?? "unknown",
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
      node: process.version,
    },
    comparison: existingBudgetMs === null ? "not_checked" : "baseline_budget_enforced",
    existingBudgetMs,
    warmups: 5,
    measuredSamples: 30,
    fixture: {
      issuedInvoices: 1,
      currency: "SEK",
      residualMinor: "12500",
      attachmentBytes: baseline
        ? 0
        : (await prepare(context, recipient)).attachments[0]?.byteLength,
    },
    feature: baseline ? "absent" : "present",
    baselineRevision,
    existingWorklist: summary(readSamples),
    exactPreview: summary(previewSamples),
    admittedToObservation: summary(dispatchSamples),
    queueWait: summary(queueWaitSamples),
  };

  await writeFile(
    join(environment().artifacts, "performance.json"),
    JSON.stringify(results, null, 2),
  );
  expect(readSamples.length).toBe(30);

  if (!baseline) {
    if (existingBudgetMs !== null)
      expect(results.existingWorklist.p95Ms).toBeLessThanOrEqual(existingBudgetMs);
    expect(previewSamples.length).toBe(30);
    expect(dispatchSamples.length).toBe(30);
    expect(results.exactPreview.p95Ms).toBeLessThanOrEqual(2000);
    expect(results.admittedToObservation.p95Ms).toBeLessThanOrEqual(2000);
  }
}, 120000);

test("a 10000-minor reminder refuses a pre-admission 4000 payment and a newly approved 6000 message sends exact current bytes", async () => {
  const context = await legalFixture([], {
    sourceTotalMinor: "10000",
    lines: [
      {
        id: "reminder_line",
        description: "Synthetic reminder obligation",
        quantity: "1",
        unitPriceMinor: "8000",
        baseMinor: "8000",
        discountMinor: "0",
        chargeMinor: "0",
        taxMinor: "2000",
        taxDescription: "se-domestic-standard-25-v1",
        sourceGrossMinor: "10000",
      },
    ],
  });

  const recipient = await reviewed(context);
  const stale = await prepare(context, recipient);
  expect(stale.outstandingMinor).toBe("10000");
  await approve(context, stale);
  await send(context, stale);
  await settle(context, "4000");
  const transport = await fixtureTransport();
  const worker = runner(context, transport);

  try {
    const refused = await waitStatus(context, stale, "refused");
    expect(refused.attempt).toBe(null);
    expect(refused.currentOutstandingMinor).toBe("6000");
    expect(transport.wires).toMatchObject([]);
    const fresh = await prepare(context, recipient);
    expect(fresh.outstandingMinor).toBe("6000");
    expect(fresh.plainText).toContain("60,00 kr");
    await approve(context, fresh);
    await send(context, fresh);
    const accepted = await waitStatus(context, fresh, "provider_accepted");
    expect(accepted.delivered).toBe(false);
    expect(transport.wires.length).toBe(1);
    expect(transport.wires[0]?.plainText).toBe(fresh.plainText);
    await writeFile(
      join(environment().artifacts, "reminder-10000-4000-6000.json"),
      JSON.stringify({ stale, refused, fresh, accepted, wire: transport.wires }, null, 2),
    );
  } finally {
    await stop(worker);
    await transport.close();
  }
});

test("two persistent runners racing cancellation retain either a cancelled intent or one admitted message", async () => {
  const context = await legalFixture();
  const message = await prepare(context, await reviewed(context));
  const approvals = await Promise.all([approve(context, message), approve(context, message)]);
  expect(approvals[0].approval).toEqual(approvals[1].approval);
  await send(context, message);
  const transport = await fixtureTransport();
  const first = runner(context, transport);
  const second = runner(context, transport);

  try {
    const cancellation = await request(context.author, `${base}/${message.id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ messageDigest: message.digest }),
    });

    expect([200, 409]).toContain(cancellation.status);
    const expected = cancellation.status === 200 ? "cancelled" : "provider_accepted";
    const retained = await waitStatus(context, message, expected);

    if (expected === "cancelled") {
      expect(retained.attempt).toBe(null);
      expect(transport.wires).toMatchObject([]);
    } else {
      expect(retained.attempt?.messageDigest).toBe(message.digest);
      expect(transport.wires).toHaveLength(1);
      expect(transport.wires[0]?.externalIdentity).toBe(retained.attempt?.externalIdentity);
      await failure(
        await request(context.author, `${base}/${message.id}/cancel`, {
          method: "POST",
          body: JSON.stringify({ messageDigest: message.digest }),
        }),
        409,
        "StaleDependency",
      );
    }

    await writeFile(
      join(environment().artifacts, "reminder-cancel-admit-race.json"),
      JSON.stringify(
        { cancellationStatus: cancellation.status, retained, wires: transport.wires },
        null,
        2,
      ),
    );
  } finally {
    await stop(first);
    await stop(second);
    await transport.close();
  }
}, 45000);

test("an unauthenticated fixture outcome cannot establish acceptance or delivery", async () => {
  const context = await legalFixture();
  const message = await prepare(context, await reviewed(context));
  await approve(context, message);
  await send(context, message);
  const transport = await fixtureTransport();
  transport.deliver();
  const worker = runner(context, { ...transport, secret: randomBytes(32).toString("hex") });

  try {
    const retained = await waitStatus(context, message, "outcome_unknown");
    expect(retained.attempt).not.toBe(null);
    expect(retained.observations).toEqual([]);
    expect(retained.delivered).toBe(false);
    expect(transport.wires).toMatchObject([]);
    expect(transport.reads).toEqual([]);
    await writeFile(
      join(environment().artifacts, "reminder-unauthenticated-outcome.json"),
      JSON.stringify({ retained, authenticatedWires: transport.wires }, null, 2),
    );
  } finally {
    await stop(worker);
    await transport.close();
  }
}, 45000);

test("an actual persistent runner without a delivery profile leaves an approval unadmitted and makes no contact", async () => {
  const context = await legalFixture();
  const message = await prepare(context, await reviewed(context));
  await approve(context, message);
  await send(context, message);
  const transport = await fixtureTransport();
  const worker = runner(context, transport, false);
  const admin = await database();

  try {
    await expect
      .poll(
        async () => {
          expect(worker.child.exitCode).toBe(null);

          const connections = await admin.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = 'open-erp-preparation-runner'",
          );

          return Number(connections.rows[0]?.count ?? "0");
        },
        { timeout: 15000 },
      )
      .toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const retained = await read(context, message);
    expect(retained.status).toBe("approved");
    expect(retained.attempt).toBe(null);
    expect(retained.observations).toEqual([]);
    expect(transport.wires).toMatchObject([]);
    expect(transport.reads).toEqual([]);
    await writeFile(
      join(environment().artifacts, "reminder-disabled-by-default.json"),
      JSON.stringify({ runnerConnected: true, retained, wires: transport.wires }, null, 2),
    );
  } finally {
    await admin.end();
    await stop(worker);
    await transport.close();
  }
}, 45000);

test("recovery v4 binds all five reminder families and preserves complete older work with no resumption authority", async () => {
  const context = await legalFixture();
  const message = await prepare(context, await reviewed(context));
  await approve(context, message);
  await send(context, message);
  const transport = await fixtureTransport();
  const worker = runner(context, transport);
  const admin = await database();

  try {
    const retained = await waitStatus(context, message, "provider_accepted");
    await stop(worker);
    await admin.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

    const exported = await admin.query<{ snapshot: string }>(
      "SELECT pg_export_snapshot() AS snapshot",
    );

    const snapshot = exported.rows[0]?.snapshot;

    if (!snapshot) throw new Error("Recovery snapshot missing");
    const tables = await tableFingerprints(admin);
    const captured = await captureWorkInventory(admin, tables, snapshot, 4);
    await writeFile(
      join(environment().artifacts, "reminder-recovery-capture.json"),
      JSON.stringify(captured, null, 2),
    );

    const body = Schema.decodeUnknownSync(
      Schema.Struct({
        version: Schema.Literal(4),
        resumptionAuthority: Schema.Literal("not-granted"),
        providerAttemptHistory: Schema.Literal("payment-reminder-attempts-retained"),
        recurringSchedules: Schema.Array(Schema.Unknown),
        recurringEvents: Schema.Array(Schema.Unknown),
        recurringJobs: Schema.Array(Schema.Unknown),
        reminderMessages: Schema.Array(
          Schema.Struct({ bookId: Schema.String, id: Schema.String, bodySha256: Schema.String }),
        ),
        reminderApprovals: Schema.Array(
          Schema.Struct({
            bookId: Schema.String,
            messageId: Schema.String,
            bodySha256: Schema.String,
          }),
        ),
        reminderAttempts: Schema.Array(
          Schema.Struct({
            bookId: Schema.String,
            id: Schema.String,
            messageId: Schema.String,
            externalIdentity: Schema.String,
            bodySha256: Schema.String,
          }),
        ),
        reminderOutbox: Schema.Array(
          Schema.Struct({
            bookId: Schema.String,
            messageId: Schema.String,
            state: Schema.String,
            checkpoint: Schema.Int,
            cancelVersion: Schema.Int,
          }),
        ),
        reminderObservations: Schema.Array(
          Schema.Struct({
            bookId: Schema.String,
            attemptId: Schema.String,
            observationId: Schema.String,
            bodySha256: Schema.String,
          }),
        ),
      }),
    )(captured);

    const selectedMessage = body.reminderMessages.find(
      (row) => row.bookId === context.book.bookId && row.id === message.id,
    );

    const selectedApproval = body.reminderApprovals.find(
      (row) => row.bookId === context.book.bookId && row.messageId === message.id,
    );

    const selectedAttempt = body.reminderAttempts.find(
      (row) => row.bookId === context.book.bookId && row.messageId === message.id,
    );

    const selectedOutbox = body.reminderOutbox.find(
      (row) => row.bookId === context.book.bookId && row.messageId === message.id,
    );

    const selectedObservation = body.reminderObservations.find(
      (row) => row.bookId === context.book.bookId && row.attemptId === retained.attempt?.id,
    );

    expect(selectedAttempt?.externalIdentity).toBe(retained.attempt?.externalIdentity);
    expect(selectedOutbox).toEqual({
      bookId: context.book.bookId,
      messageId: message.id,
      state: "provider_accepted",
      checkpoint: 0,
      cancelVersion: 0,
    });
    expect(selectedObservation?.observationId).toBe(
      `${retained.attempt?.externalIdentity}/accepted`,
    );

    const messages = await admin.query<{ body: string }>(
      "SELECT body::text AS body FROM openerp.reminder_messages WHERE book_id=$1 AND id=$2",
      [context.book.bookId, message.id],
    );

    const approvals = await admin.query<{ body: string }>(
      "SELECT body::text AS body FROM openerp.reminder_approvals WHERE book_id=$1 AND message_id=$2",
      [context.book.bookId, message.id],
    );

    const attempts = await admin.query<{ body: string }>(
      "SELECT body::text AS body FROM openerp.reminder_attempts WHERE book_id=$1 AND message_id=$2",
      [context.book.bookId, message.id],
    );

    const observations = await admin.query<{ body: string }>(
      "SELECT body::text AS body FROM openerp.reminder_observations WHERE book_id=$1 AND attempt_id=$2 ORDER BY observation_id",
      [context.book.bookId, retained.attempt?.id],
    );

    for (const pair of [
      { inventoryHash: selectedMessage?.bodySha256, retainedBody: messages.rows[0]?.body },
      { inventoryHash: selectedApproval?.bodySha256, retainedBody: approvals.rows[0]?.body },
      { inventoryHash: selectedAttempt?.bodySha256, retainedBody: attempts.rows[0]?.body },
      { inventoryHash: selectedObservation?.bodySha256, retainedBody: observations.rows[0]?.body },
    ]) {
      if (!pair.retainedBody) throw new Error("Recovery retained body missing");
      expect(pair.inventoryHash).toBe(
        createHash("sha256").update(pair.retainedBody, "utf8").digest("hex"),
      );
    }

    await writeFile(
      join(environment().artifacts, "reminder-recovery-v4.json"),
      JSON.stringify({ inventory: captured, retained, wire: transport.wires }, null, 2),
    );
    await admin.query("ROLLBACK");
  } finally {
    await admin.query("ROLLBACK");
    await admin.end();
    await stop(worker);
    await transport.close();
  }
}, 45000);

test("the persistent runner refuses a fixture origin without an explicit port before admitting a message", async () => {
  const context = await legalFixture();
  const message = await prepare(context, await reviewed(context));
  await approve(context, message);
  await send(context, message);
  const transport = await fixtureTransport();
  const worker = runner(context, { ...transport, endpoint: "http://127.0.0.1" });

  try {
    await expect.poll(() => worker.child.exitCode, { timeout: 15000 }).not.toBe(null);
    expect(worker.child.exitCode).not.toBe(0);
    const retained = await read(context, message);
    expect(retained.status).toBe("approved");
    expect(retained.attempt).toBe(null);
    expect(transport.wires).toMatchObject([]);
    expect(transport.reads).toEqual([]);
    await writeFile(
      join(environment().artifacts, "reminder-explicit-fixture-port.json"),
      JSON.stringify(
        { exitCode: worker.child.exitCode, retained, wires: transport.wires },
        null,
        2,
      ),
    );
  } finally {
    await stop(worker);
    await transport.close();
  }
}, 30000);

test("the retained reminder route reloads an unknown worker outcome and reconciles the same attempt", async () => {
  const context = await legalFixture();
  const message = await prepare(context, await reviewed(context));
  const transport = await fixtureTransport("unknown");
  const worker = runner(context, transport);

  try {
    const browserActor = await fixture();
    const admin = await database();

    try {
      await admin.query(
        "INSERT INTO openerp.memberships(book_id,actor_id,role) VALUES($1,$2,'operator')",
        [context.book.bookId, browserActor.actorId],
      );
    } finally {
      await admin.end();
    }

    await withWorkspaceBrowser(
      { ...context.book, actorId: browserActor.actorId },
      "reminder-retained-reload",
      async (page, workspace) => {
        await page.goto(
          `${workspace}/sales?view=collections&reminder=${encodeURIComponent(message.id)}`,
        );
        await page.getByRole("button", { name: "Godkänn utskick", exact: true }).click();
        await page.getByRole("button", { name: "Skicka påminnelsen", exact: true }).click();
        await page.getByText("Påminnelsens utfall är okänt", { exact: true }).waitFor();
        expect(transport.wires).toHaveLength(1);
        const externalIdentity = transport.wires[0]?.externalIdentity;
        await page.reload();
        await page.getByText("Påminnelsens utfall är okänt", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Visa godkänt meddelande", exact: true }).click();
        expect(await page.locator("pre").first().innerText()).toBe(message.plainText);
        expect(
          await page
            .getByRole("button", { name: "Kontrollera samma utskick", exact: true })
            .count(),
        ).toBe(1);
        await page.screenshot({
          path: join(environment().artifacts, "reminder-unknown-reloaded.png"),
          fullPage: true,
        });
        await page.getByRole("button", { name: "Kontrollera samma utskick", exact: true }).click();
        await expect.poll(() => transport.reads.length, { timeout: 25000 }).toBeGreaterThan(0);
        await page.getByRole("heading", { name: "? Utredningen pågår", exact: true }).waitFor();
        expect(transport.reads).toContain(externalIdentity);
        expect(transport.wires).toHaveLength(1);
        const retainedPath = page.url();

        const wrongOwnerResponse = page.waitForResponse(
          (response) =>
            response.url().endsWith(`${base}/${context.original.id}`) &&
            response.request().method() === "GET",
        );

        await page.goto(
          `${workspace}/sales?view=collections&reminder=${encodeURIComponent(context.original.id)}`,
        );
        expect((await wrongOwnerResponse).status()).toBe(404);
        await page
          .getByRole("status")
          .filter({ has: page.getByText("NotFound", { exact: true }) })
          .first()
          .waitFor();
        expect(
          await page.getByRole("button", { name: "Godkänn utskick", exact: true }).count(),
        ).toBe(0);
        expect(transport.wires).toHaveLength(1);
        await writeFile(
          join(environment().artifacts, "reminder-retained-reload.json"),
          JSON.stringify(
            {
              path: retainedPath,
              wrongOwnerRefused: true,
              messageId: message.id,
              externalIdentity,
              wires: transport.wires,
              reads: transport.reads,
              liveProviderEnabled: false,
            },
            null,
            2,
          ),
        );
      },
    );
  } finally {
    await stop(worker);
    await transport.close();
  }
}, 120000);
