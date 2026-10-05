import * as Peppol from "@open-erp/contracts/peppol-exchange";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Inbox from "@open-erp/contracts/supplier-inbox";
import * as SupplierDrafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as Source from "@open-erp/contracts/source-intake";
import * as Credits from "@open-erp/contracts/customer-credit-notes";
import * as Schema from "effect/Schema";
import { afterEach, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { peppolLegalFixture } from "./support/peppol-legal";
import {
  database,
  createSession,
  decoded,
  environment,
  evidence,
  failure,
  fixture,
  key,
  post,
  request,
  saveEvidence,
} from "./support/fixtures";

const { Binding, Artifact, Approval, Attempt } = Peppol;

type Context = Awaited<ReturnType<typeof peppolLegalFixture>>;

const controlledDocuments = new Set<string>();

async function accessPointFixture(path: string, input?: Schema.JsonObject) {
  const settings = environment();

  const response = await fetch(`${settings.peppolFixtureUrl}${path}`, {
    method: input === undefined ? "GET" : "PUT",
    headers: {
      authorization: `Bearer ${settings.peppolFixtureSecret}`,
      "content-type": "application/json",
    },
    body: input === undefined ? undefined : JSON.stringify(input),
  });

  expect(response.status).toBe(200);

  return response;
}

async function control(documentId: string, controls: Schema.JsonObject) {
  controlledDocuments.add(documentId);
  await accessPointFixture(`/fixtures/${encodeURIComponent(documentId)}`, { controls });
}

afterEach(async () => {
  for (const documentId of controlledDocuments) await control(documentId, {});
  controlledDocuments.clear();
});

async function exchangeFacts(context: Context) {
  const admin = await database();

  try {
    const facts = await admin.query<{
      artifacts: string;
      approvals: string;
      attempts: string;
      outcomes: string;
      inbound: string;
      incidents: string;
    }>(
      "select (select count(*)::text from openerp.peppol_artifacts where book_id=$1) artifacts,(select count(*)::text from openerp.peppol_approvals where book_id=$1) approvals,(select count(*)::text from openerp.peppol_attempts where book_id=$1) attempts,(select count(*)::text from openerp.peppol_outcomes where book_id=$1) outcomes,(select count(*)::text from openerp.peppol_inbound where book_id=$1) inbound,(select count(*)::text from openerp.peppol_integrity_incidents where book_id=$1) incidents",
      [context.book.bookId],
    );

    const row = facts.rows[0];

    if (!row) throw new Error("Exchange proof needs retained owner counters.");

    return row;
  } finally {
    await admin.end();
  }
}

async function bindings(context: Context) {
  const { author, original } = context;
  const document = { kind: "invoice", id: original.id };

  const sender = await post(
    author,
    "/commerce/peppol/bindings",
    {
      document,
      role: "sender",
      participantId: "5560000001",
      schemeId: "0007",
      providerAccount: "synthetic-ap-v1",
      active: true,
      evidenceId: original.sourceEvidence.evidenceId,
      buyerReference: null,
      paymentAccountReference: "1234567",
      acknowledgeSyntheticAccessPoint: true,
    },
    Binding,
  );

  const recipient = await post(
    author,
    "/commerce/peppol/bindings",
    {
      document,
      role: "recipient",
      participantId: "5560000019",
      schemeId: "0007",
      providerAccount: "synthetic-ap-v1",
      active: true,
      evidenceId: original.sourceEvidence.evidenceId,
      buyerReference: "SYNTHETIC-BUYER",
      paymentAccountReference: null,
      acknowledgeSyntheticAccessPoint: true,
    },
    Binding,
  );

  return { sender, recipient };
}

async function prepare(context: Context, reference = { kind: "invoice", id: context.original.id }) {
  const selected = await bindings(context);

  const artifact = await post(
    context.author,
    "/commerce/peppol/artifacts",
    {
      document: reference,
      senderBindingId: selected.sender.id,
      recipientBindingId: selected.recipient.id,
    },
    Artifact,
  );

  return { ...selected, artifact };
}

async function assertTransportDidNotPost(context: Context, expectedCredits = "0") {
  const admin = await database();

  try {
    const facts = await admin.query<{ issues: string; credits: string; vouchers: string }>(
      "select (select count(*)::text from openerp.ar_legal_issues where book_id=$1) issues,(select count(*)::text from openerp.customer_credit_notes where book_id=$1) credits,(select count(*)::text from openerp.vouchers where book_id=$1) vouchers",
      [context.book.bookId],
    );

    expect(facts.rows).toEqual([
      { issues: "1", credits: expectedCredits, vouchers: expectedCredits === "0" ? "1" : "2" },
    ]);
  } finally {
    await admin.end();
  }
}

test("Peppol retained invoice10000 tax2500 dispatches only after separate human approval without financial writes", async () => {
  const context = await peppolLegalFixture();
  const { artifact } = await prepare(context);
  expect([
    artifact.expected.exclusiveMinor,
    artifact.expected.taxMinor,
    artifact.expected.payableMinor,
  ]).toEqual(["10000", "2500", "12500"]);
  expect(artifact.xml).toContain(
    '<cbc:TaxExclusiveAmount currencyID="SEK">100.00</cbc:TaxExclusiveAmount>',
  );
  expect(artifact.xml).toContain('<cbc:TaxAmount currencyID="SEK">25.00</cbc:TaxAmount>');
  expect(artifact.xml).toContain('<cbc:PayableAmount currencyID="SEK">125.00</cbc:PayableAmount>');

  const denied = await request(context.book, `/commerce/peppol/artifacts/${artifact.id}/dispatch`, {
    method: "POST",
    body: JSON.stringify({ digest: artifact.digest, approvalId: "missing_peppol_approval" }),
  });

  expect(denied.status).toBe(403);
  expect((await denied.json()).code).toBe("ApprovalRequired");

  const approval = await post(
    context.reviewer,
    `/commerce/peppol/artifacts/${artifact.id}/approvals`,
    { digest: artifact.digest },
    Approval,
  );

  const sent = await post(
    context.book,
    `/commerce/peppol/artifacts/${artifact.id}/dispatch`,
    { digest: artifact.digest, approvalId: approval.id },
    Attempt,
  );

  expect(sent.outcome).toBe("transport_accepted");
  expect([sent.paid, sent.posted]).toEqual([false, false]);
  await assertTransportDidNotPost(context);
  await writeFile(join(environment().artifacts, "peppol-issued-invoice.xml"), artifact.xml);
  await writeFile(
    join(environment().artifacts, "peppol-invoice-validation.json"),
    JSON.stringify(artifact.validation, null, 2),
  );
  await saveEvidence("peppol-invoice-source-authority", context.book);
});

test("Peppol legal credit4000 tax1000 preserves original invoice reference and no second credit issue", async () => {
  const context = await peppolLegalFixture();
  const decision = await evidence(context.author);

  const review = await post(
    context.author,
    "/commerce/customer-credit-reviews",
    {
      profile: "se-domestic-b2b-sek-25-accrual-credit-v1",
      originalLegalIssueId: context.original.id,
      originalIssueDigest: context.original.digest,
      accountingProfileId: context.profile.id,
      accountingProfileDigest: context.profile.digest,
      accountingPeriodId: "period_2026",
      voucherSeries: "A",
      creditEvidenceId: decision.id,
      creditDate: context.today,
      reason: "Synthetic linked credit",
      selectedLines: [
        { originalLineId: "line_1", creditedNetMinor: "4000", creditedTaxMinor: "1000" },
      ],
      acknowledgeNoRefundOrCreditBalance: true,
      acknowledgeVatReturnConsequenceUnobserved: true,
    },
    Credits.CustomerCreditReview,
  );

  const approvalInput = { version: 1, digest: review.digest, acknowledgeLimitedProfile: true };

  const approved = await post(
    context.reviewer,
    `/commerce/customer-credit-reviews/${review.id}/approvals`,
    approvalInput,
    Credits.CustomerCreditApproval,
  );

  const credit = await post(
    context.reviewer,
    `/commerce/customer-credit-reviews/${review.id}/execute`,
    { ...approvalInput, approvalId: approved.id },
    Credits.CustomerCreditReceipt,
  );

  const { artifact } = await prepare(context, { kind: "credit", id: credit.id });
  expect([
    artifact.expected.exclusiveMinor,
    artifact.expected.taxMinor,
    artifact.expected.payableMinor,
    artifact.expected.originalInvoiceRef,
  ]).toEqual(["4000", "1000", "5000", context.original.legalDocumentNumber]);
  expect(artifact.xml).toContain(
    '<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"',
  );
  expect(artifact.xml).toContain(
    `<cac:InvoiceDocumentReference><cbc:ID>${context.original.legalDocumentNumber}</cbc:ID>`,
  );
  await assertTransportDidNotPost(context, "1");
  await writeFile(join(environment().artifacts, "peppol-issued-credit.xml"), artifact.xml);
  await saveEvidence("peppol-credit-original-reference", context.book);
});

test("Peppol legal half-up line3 tax1 renders the exact issued amount", async () => {
  const context = await peppolLegalFixture([], {
    sourceTotalMinor: "4",
    lines: [
      {
        id: "line_1",
        description: "Synthetic rounding boundary",
        quantity: "1",
        unitPriceMinor: "3",
        baseMinor: "3",
        discountMinor: "0",
        chargeMinor: "0",
        taxMinor: "1",
        taxDescription: "se-domestic-standard-25-v1",
        sourceGrossMinor: "4",
      },
    ],
  });

  const { artifact } = await prepare(context);
  expect([
    artifact.expected.exclusiveMinor,
    artifact.expected.taxMinor,
    artifact.expected.payableMinor,
  ]).toEqual(["3", "1", "4"]);
  expect(artifact.xml).toContain('<cbc:PayableAmount currencyID="SEK">0.04</cbc:PayableAmount>');
  await assertTransportDidNotPost(context);
  await saveEvidence("peppol-issued-rounding", context.book);
});

async function approvedArtifact(context: Context) {
  const selected = await prepare(context);

  const approval = await post(
    context.reviewer,
    `/commerce/peppol/artifacts/${selected.artifact.id}/approvals`,
    { digest: selected.artifact.digest },
    Approval,
  );

  return { ...selected, approval };
}

const Inventory = Schema.Struct({
  messages: Schema.Array(
    Schema.Struct({ message: Peppol.ProviderMessage, outcome: Peppol.ProviderOutcome }),
  ),
});

async function providerMessageCount(providerKey: string) {
  const inventory = Schema.decodeUnknownSync(Inventory)(
    await (await accessPointFixture("/inventory")).json(),
  );

  return inventory.messages.filter((item) => item.message.providerKey === providerKey).length;
}

test("Peppol lost submit response recovers one sealed correlation and delivery remains unpaid", async () => {
  const context = await peppolLegalFixture();
  const { artifact, approval } = await approvedArtifact(context);
  await control(artifact.expected.documentId, { loseSubmit: true });
  const commandKey = key();
  const input = { digest: artifact.digest, approvalId: approval.id };
  const agent = { ...context.book, token: context.book.agentToken };
  await failure(
    await request(agent, `/commerce/peppol/artifacts/${artifact.id}/dispatch`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(input),
    }),
    503,
    "Unavailable",
  );
  expect([
    (await exchangeFacts(context)).attempts,
    (await exchangeFacts(context)).outcomes,
  ]).toEqual(["1", "0"]);

  const recovered = await decoded(
    await request(agent, `/commerce/peppol/artifacts/${artifact.id}/dispatch`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(input),
    }),
    Attempt,
  );

  expect(recovered.outcome).toBe("transport_accepted");
  await control(artifact.expected.documentId, { status: "recipient_delivered" });

  const delivered = await post(
    agent,
    `/commerce/peppol/attempts/${recovered.id}/collect`,
    {},
    Attempt,
  );

  expect([
    delivered.id,
    delivered.providerKey,
    delivered.outcome,
    delivered.paid,
    delivered.posted,
  ]).toEqual([recovered.id, recovered.providerKey, "recipient_delivered", false, false]);
  expect(await providerMessageCount(recovered.providerKey)).toBe(1);
  await assertTransportDidNotPost(context);
  await saveEvidence("peppol-lost-response-one-correlation", context.book);
  await writeFile(
    join(environment().artifacts, "peppol-lost-response.json"),
    JSON.stringify({ recovered, delivered, facts: await exchangeFacts(context) }, null, 2),
  );
});

test("Peppol admission with an actual refused AP submit recovers the same key under current approval", async () => {
  const context = await peppolLegalFixture();
  const { artifact, approval } = await approvedArtifact(context);
  const providerKey = `peppol_${artifact.id}`;
  await control(artifact.expected.documentId, { rejectSubmit: true });
  const agent = { ...context.book, token: context.book.agentToken };
  const input = { digest: artifact.digest, approvalId: approval.id };
  await failure(
    await request(agent, `/commerce/peppol/artifacts/${artifact.id}/dispatch`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
    503,
    "Unavailable",
  );
  expect(await providerMessageCount(providerKey)).toBe(0);
  const admin = await database();
  let retained: typeof Attempt.Type;

  try {
    const rows = await admin.query<{ body: Schema.JsonObject }>(
      "select body from openerp.peppol_attempts where book_id=$1",
      [context.book.bookId],
    );

    expect(rows.rows).toHaveLength(1);
    retained = Schema.decodeUnknownSync(Attempt)(rows.rows[0]?.body);
  } finally {
    await admin.end();
  }

  await control(artifact.expected.documentId, {});

  const recovered = await post(
    agent,
    `/commerce/peppol/artifacts/${artifact.id}/dispatch`,
    input,
    Attempt,
  );

  expect([recovered.id, recovered.providerKey, recovered.outcome]).toEqual([
    retained.id,
    providerKey,
    "transport_accepted",
  ]);
  expect(await providerMessageCount(providerKey)).toBe(1);
  expect((await exchangeFacts(context)).attempts).toBe("1");

  const observed = await decoded(
    await request(agent, `/commerce/peppol/attempts/${retained.id}`),
    Peppol.GetAttempt,
  );

  expect(
    observed.submissions.map((item) => [
      item.kind,
      item.approval.id,
      item.approval.actorId,
      item.executorId,
    ]),
  ).toEqual([
    ["first_submission", approval.id, context.reviewer.actorId, context.book.agentId],
    ["confirmed_absence_retry", approval.id, context.reviewer.actorId, context.book.agentId],
  ]);
  expect(observed.submissions[1]?.absence).toMatchObject({
    kind: "not_submitted",
    providerAccount: "synthetic-ap-v1",
    providerKey,
  });
  await assertTransportDidNotPost(context);
  await writeFile(
    join(environment().artifacts, "peppol-admitted-not-submitted.json"),
    JSON.stringify({ retained, recovered, observed }, null, 2),
  );
  await saveEvidence("peppol-admitted-not-submitted-recovery", context.book);
});

test("Peppol concurrent dispatch keys converge on one approved attempt without another issue", async () => {
  const context = await peppolLegalFixture();
  const { artifact, approval } = await approvedArtifact(context);
  const agent = { ...context.book, token: context.book.agentToken };

  const commandKeys = [key(), key()];
  const input = { digest: artifact.digest, approvalId: approval.id };

  const calls = await Promise.all(
    commandKeys.map((commandKey) =>
      request(agent, `/commerce/peppol/artifacts/${artifact.id}/dispatch`, {
        method: "POST",
        headers: { "idempotency-key": commandKey },
        body: JSON.stringify(input),
      }),
    ),
  );

  const retained: Array<typeof Attempt.Type> = [];

  for (const [ordinal, response] of calls.entries()) {
    if (response.status === 200) retained.push(await decoded(response, Attempt));
    else {
      await failure(response, 503, "TransactionRetry");
      const commandKey = commandKeys[ordinal];

      if (!commandKey) throw new Error("Conflict recovery needs its original command key.");
      retained.push(
        await decoded(
          await request(agent, `/commerce/peppol/artifacts/${artifact.id}/dispatch`, {
            method: "POST",
            headers: { "idempotency-key": commandKey },
            body: JSON.stringify(input),
          }),
          Attempt,
        ),
      );
    }
  }

  expect(retained.length).toBe(2);
  expect(new Set(retained.map((item) => item.id)).size).toBe(1);
  expect((await exchangeFacts(context)).attempts).toBe("1");
  const attempt = retained[0];

  if (!attempt) throw new Error("Concurrent proof needs an admitted attempt.");

  const collected = await post(
    agent,
    `/commerce/peppol/attempts/${attempt.id}/collect`,
    {},
    Attempt,
  );

  expect([collected.id, collected.outcome, collected.paid]).toEqual([
    attempt.id,
    "transport_accepted",
    false,
  ]);
  expect(await providerMessageCount(attempt.providerKey)).toBe(1);
  await assertTransportDidNotPost(context);
  await saveEvidence("peppol-concurrent-correlation", context.book);
});

for (const corruptOutcome of ["buyer", "hash", "document"]) {
  test(`Peppol actual access-point changed ${corruptOutcome} outcome cannot attach to the approved artifact`, async () => {
    const context = await peppolLegalFixture();
    const { artifact, approval } = await approvedArtifact(context);
    await control(artifact.expected.documentId, { corruptOutcome });
    await failure(
      await request(context.book, `/commerce/peppol/artifacts/${artifact.id}/dispatch`, {
        method: "POST",
        body: JSON.stringify({ digest: artifact.digest, approvalId: approval.id }),
      }),
      422,
      "InvalidJournal",
    );
    expect([
      (await exchangeFacts(context)).attempts,
      (await exchangeFacts(context)).outcomes,
    ]).toEqual(["1", "0"]);
    await assertTransportDidNotPost(context);
    await saveEvidence(`peppol-provider-${corruptOutcome}-refused`, context.book);
  });
}

for (const validatorFault of ["absent_engine", "changed_rule", "changed_release"]) {
  test(`Peppol actual ${validatorFault} is unavailable with retained diagnostics and no dispatch`, async () => {
    const context = await peppolLegalFixture();
    const selected = await bindings(context);
    await control(context.original.legalDocumentNumber, { validatorFault });
    await failure(
      await request(context.author, "/commerce/peppol/artifacts", {
        method: "POST",
        body: JSON.stringify({
          document: { kind: "invoice", id: context.original.id },
          senderBindingId: selected.sender.id,
          recipientBindingId: selected.recipient.id,
        }),
      }),
      503,
      "Unavailable",
    );
    expect([
      (await exchangeFacts(context)).artifacts,
      (await exchangeFacts(context)).attempts,
    ]).toEqual(["0", "0"]);
    const admin = await database();

    try {
      const reports = await admin.query<{ outcome: string }>(
        "select body->'validation'->>'outcome' outcome from openerp.peppol_validation_runs where book_id=$1",
        [context.book.bookId],
      );

      expect(reports.rows).toEqual([{ outcome: "ValidationUnavailable" }]);
    } finally {
      await admin.end();
    }

    await assertTransportDidNotPost(context);
    await saveEvidence(`peppol-${validatorFault}-unavailable`, context.book);
  });
}

for (const validationCorruption of ["buyer", "tax", "original_reference"]) {
  test(`Peppol actual validator rejects corrupted ${validationCorruption} against the retained financial source`, async () => {
    const context = await peppolLegalFixture();
    const selected = await bindings(context);
    await control(context.original.legalDocumentNumber, { validationCorruption });
    await failure(
      await request(context.author, "/commerce/peppol/artifacts", {
        method: "POST",
        body: JSON.stringify({
          document: { kind: "invoice", id: context.original.id },
          senderBindingId: selected.sender.id,
          recipientBindingId: selected.recipient.id,
        }),
      }),
      422,
      "InvalidJournal",
    );
    expect([
      (await exchangeFacts(context)).artifacts,
      (await exchangeFacts(context)).attempts,
    ]).toEqual(["0", "0"]);
    const admin = await database();

    try {
      const reports = await admin.query<{ outcome: string; diagnostics: Schema.Json }>(
        "select body->'validation'->>'outcome' outcome,body->'validation'->'diagnostics' diagnostics from openerp.peppol_validation_runs where book_id=$1",
        [context.book.bookId],
      );

      expect(reports.rows).toHaveLength(1);
      expect(["SemanticMismatch", "ValidationFailed"]).toContain(reports.rows[0]?.outcome);
      await writeFile(
        join(environment().artifacts, `peppol-corrupt-${validationCorruption}-diagnostics.json`),
        JSON.stringify(reports.rows, null, 2),
      );
    } finally {
      await admin.end();
    }

    await assertTransportDidNotPost(context);
    await saveEvidence(`peppol-corrupt-${validationCorruption}`, context.book);
  });
}

test("Peppol stale participant revision and changed artifact digest refuse before dispatch", async () => {
  const context = await peppolLegalFixture();
  const { artifact, approval, recipient } = await approvedArtifact(context);
  await post(
    context.author,
    "/commerce/peppol/bindings",
    {
      document: recipient.document,
      role: recipient.role,
      participantId: recipient.participantId,
      schemeId: recipient.schemeId,
      providerAccount: recipient.providerAccount,
      active: true,
      evidenceId: recipient.evidenceId,
      buyerReference: "REVIEWED-REPLACEMENT",
      paymentAccountReference: null,
      acknowledgeSyntheticAccessPoint: true,
    },
    Binding,
  );
  await failure(
    await request(context.book, `/commerce/peppol/artifacts/${artifact.id}/dispatch`, {
      method: "POST",
      body: JSON.stringify({ digest: artifact.digest, approvalId: approval.id }),
    }),
    409,
    "StaleDependency",
  );
  await failure(
    await request(context.book, `/commerce/peppol/artifacts/${artifact.id}/dispatch`, {
      method: "POST",
      body: JSON.stringify({ digest: `sha256:${"0".repeat(64)}`, approvalId: approval.id }),
    }),
    409,
    "StaleDependency",
  );
  expect((await exchangeFacts(context)).attempts).toBe("0");
  await assertTransportDidNotPost(context);
  await saveEvidence("peppol-stale-binding-and-hash", context.book);
});

test("Peppol current separate human approval excludes agent, author and revoked approver", async () => {
  const context = await peppolLegalFixture();
  const { artifact } = await prepare(context);
  const agent = { ...context.book, token: context.book.agentToken };
  await failure(
    await request(agent, `/commerce/peppol/artifacts/${artifact.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ digest: artifact.digest }),
    }),
    403,
    "Forbidden",
  );
  await failure(
    await request(context.author, `/commerce/peppol/artifacts/${artifact.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ digest: artifact.digest }),
    }),
    403,
    "ApprovalRequired",
  );

  const approval = await post(
    context.reviewer,
    `/commerce/peppol/artifacts/${artifact.id}/approvals`,
    { digest: artifact.digest },
    Approval,
  );

  const admin = await database();

  try {
    await admin.query("delete from openerp.memberships where book_id=$1 and actor_id=$2", [
      context.book.bookId,
      context.reviewer.actorId,
    ]);
  } finally {
    await admin.end();
  }

  await failure(
    await request(agent, `/commerce/peppol/artifacts/${artifact.id}/dispatch`, {
      method: "POST",
      body: JSON.stringify({ digest: artifact.digest, approvalId: approval.id }),
    }),
    403,
    "ApprovalRequired",
  );
  const other = await fixture();
  await failure(await request(other, `/commerce/peppol/artifacts/${artifact.id}`), 404, "NotFound");
  expect((await exchangeFacts(context)).attempts).toBe("0");
  await assertTransportDidNotPost(context);
  await saveEvidence("peppol-human-current-admission", context.book);
});

test("Peppol strict public preparation accepts only retained source references", async () => {
  const context = await peppolLegalFixture();
  const selected = await bindings(context);

  const input = {
    document: { kind: "invoice", id: context.original.id },
    senderBindingId: selected.sender.id,
    recipientBindingId: selected.recipient.id,
  };

  for (const extra of [
    { payableMinor: "1" },
    { xml: "<Invoice/>" },
    { documentHash: "0".repeat(64) },
  ]) {
    await failure(
      await request(context.author, "/commerce/peppol/artifacts", {
        method: "POST",
        body: JSON.stringify({ ...input, ...extra }),
      }),
      400,
      "InvalidRequest",
    );
  }

  expect((await exchangeFacts(context)).artifacts).toBe("0");
  await assertTransportDidNotPost(context);
  await saveEvidence("peppol-retained-financial-authority", context.book);
});

async function incoming(context: Context) {
  const { sender, artifact } = await prepare(context);

  const xml = artifact.xml
    .replaceAll("5560000001", "PLACEHOLDER-SE-PARTY")
    .replaceAll("5560000019", "5560000001")
    .replaceAll("PLACEHOLDER-SE-PARTY", "5560000019");

  const xmlSha256 = createHash("sha256").update(xml).digest("hex");

  const envelope = {
    providerAccount: "synthetic-ap-v1" as const,
    transportMessageId: `synthetic_inbound_${key()}`,
    recipientParticipant: sender.participantId,
    senderParticipant: artifact.recipient.participantId,
    xml,
    xmlSha256,
    expected: {
      ...artifact.expected,
      sellerParticipant: artifact.expected.buyerParticipant,
      buyerParticipant: artifact.expected.sellerParticipant,
    },
  };

  return { sender, artifact, envelope };
}

async function seedIncoming(envelope: typeof Peppol.Envelope.Type) {
  await accessPointFixture(`/fixtures/${encodeURIComponent(envelope.transportMessageId)}`, {
    envelope,
  });
}

async function receive(context: Context, bindingId: string, transportMessageId: string) {
  return post(
    context.author,
    "/commerce/peppol/inbound",
    { bindingId, transportMessageId },
    Peppol.InboundReceipt,
  );
}

test("Peppol authenticated inbound replays one original, retains byte conflicts and uses ordinary duplicate human review", async () => {
  const context = await peppolLegalFixture();
  const { sender, envelope } = await incoming(context);
  await seedIncoming(envelope);
  const first = await receive(context, sender.id, envelope.transportMessageId);
  expect([first.duplicateCandidate, first.approved, first.posted, first.paid]).toEqual([
    false,
    false,
    false,
    false,
  ]);
  expect(first.assertions.find((item) => item.field === "grossMinor")).toEqual({
    field: "grossMinor",
    value: "12500",
    sourceLocation: "/cac:LegalMonetaryTotal/cbc:PayableAmount",
    sourceHash: `sha256:${envelope.xmlSha256}`,
    origin: "SOURCE",
  });
  const replayed = await receive(context, sender.id, envelope.transportMessageId);
  expect([replayed.id, replayed.occurrence.id]).toEqual([first.id, first.occurrence.id]);

  const original = await decoded(
    await request(context.author, `/source-occurrences/${first.occurrence.id}`),
    Source.SourceOccurrenceView,
  );

  expect(Buffer.from(original.contentBase64, "base64").toString("utf8")).toBe(envelope.xml);

  const changedXml = envelope.xml.replace(
    "Synthetic Peppol Seller",
    "Synthetic changed description",
  );

  await seedIncoming({
    ...envelope,
    xml: changedXml,
    xmlSha256: createHash("sha256").update(changedXml).digest("hex"),
  });
  await failure(
    await request(context.author, "/commerce/peppol/inbound", {
      method: "POST",
      body: JSON.stringify({
        bindingId: sender.id,
        transportMessageId: envelope.transportMessageId,
      }),
    }),
    409,
    "IdempotencyConflict",
  );
  const secondEnvelope = { ...envelope, transportMessageId: `synthetic_duplicate_${key()}` };
  await seedIncoming(secondEnvelope);
  const second = await receive(context, sender.id, secondEnvelope.transportMessageId);
  expect([second.duplicateCandidate, second.approved, second.posted, second.paid]).toEqual([
    true,
    false,
    false,
    false,
  ]);
  expect(second.occurrence.id).not.toBe(first.occurrence.id);
  const source = await evidence(context.author);

  const supplier = await post(
    context.author,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "supplier",
      displayName: "Authenticated synthetic Peppol supplier",
      evidenceId: source.id,
      reason: "Human reviewed incoming identity.",
    },
    Commerce.CounterpartyRevision,
  );

  const drafts: Array<typeof SupplierDrafts.SupplierInvoiceDraftRevision.Type> = [];

  for (const receipt of [first, second]) {
    const inbox = await decoded(
      await request(context.author, `/commerce/supplier-inbox/${receipt.occurrence.id}`),
      Inbox.SupplierInboxView,
    );

    expect(inbox.draftId).toBe(null);
    expect(inbox.attempts).toHaveLength(1);
    expect(inbox.attempts[0]?.status).toBe("suggested");

    const originalEvidence = await post(
      context.author,
      "/evidence",
      {
        title: "Human original Peppol source reference",
        content: JSON.stringify({
          source: { occurrenceId: receipt.occurrence.id, sha256: receipt.occurrence.sha256 },
        }),
        mediaType: "application/json",
        origin: "Synthetic human review",
      },
      Accounting.Evidence,
    );

    const party = {
      legalName: "Synthetic reviewed party",
      registrationId: null,
      taxId: null,
      address: null,
      countryCode: "SE",
      evidenceId: source.id,
    };

    const review = await post(
      context.author,
      `/commerce/supplier-inbox/${receipt.occurrence.id}/review`,
      {
        reviewAttemptId: inbox.attempts[0]?.id,
        reviewReason: "Human checked the exact authenticated XML and duplicate candidate.",
        draft: {
          draftKey: `peppol_review_${key()}`,
          content: {
            title: "Reviewed incoming Peppol source",
            counterpartyId: supplier.id,
            counterpartyRevision: supplier.revision,
            supplier: party,
            buyer: party,
            sourceEvidenceId: originalEvidence.id,
            supplierDocumentNumber: envelope.expected.documentId,
            currency: "SEK",
            currencyScale: 2,
            documentDate: context.today,
            supplyDate: context.today,
            dueDate: null,
            paymentTerms: "Human reviewed",
            sourceTotalMinor: "12500",
            lines: [
              {
                id: "incoming_line",
                description: "Human reviewed synthetic service",
                quantity: "1",
                unitPriceMinor: "10000",
                baseMinor: "10000",
                discountMinor: "0",
                chargeMinor: "0",
                taxMinor: "2500",
                taxDescription: "Human reviewed domestic tax",
                taxEvidenceId: source.id,
                sourceGrossMinor: "12500",
              },
            ],
          },
        },
      },
      Inbox.SupplierInboxReview,
    );

    drafts.push(review.draft);
  }

  const secondDraft = drafts[1];
  const firstDraft = drafts[0];

  if (!secondDraft || !firstDraft)
    throw new Error("Ordinary duplicate review needs two human drafts.");

  const duplicates = await decoded(
    await request(context.author, `/commerce/supplier-invoice-drafts/${secondDraft.id}/duplicates`),
    SupplierDrafts.SupplierInvoiceDraftDuplicates,
  );

  expect(
    duplicates.items.some((item) => item.kind === "draft" && item.draft.id === firstDraft.id),
  ).toBe(true);
  expect([
    (await exchangeFacts(context)).inbound,
    (await exchangeFacts(context)).incidents,
  ]).toEqual(["2", "1"]);
  await assertTransportDidNotPost(context);
  await writeFile(join(environment().artifacts, "peppol-inbound-original.xml"), envelope.xml);
  await writeFile(
    join(environment().artifacts, "peppol-inbound-human-review.json"),
    JSON.stringify({ first, replayed, second, drafts, duplicates }, null, 2),
  );
  await saveEvidence("peppol-inbound-original-duplicate-human-review", context.book);
});

test("Peppol inbound wrong participant, source hash and agent admission create no original", async () => {
  const context = await peppolLegalFixture();
  const { sender, envelope } = await incoming(context);

  for (const hostile of [
    { ...envelope, recipientParticipant: "5560000027" },
    { ...envelope, xmlSha256: "0".repeat(64) },
  ]) {
    await seedIncoming(hostile);
    await failure(
      await request(context.author, "/commerce/peppol/inbound", {
        method: "POST",
        body: JSON.stringify({
          bindingId: sender.id,
          transportMessageId: envelope.transportMessageId,
        }),
      }),
      422,
      "InvalidJournal",
    );
  }

  const agent = { ...context.book, token: context.book.agentToken };
  await failure(
    await request(agent, "/commerce/peppol/inbound", {
      method: "POST",
      body: JSON.stringify({
        bindingId: sender.id,
        transportMessageId: envelope.transportMessageId,
      }),
    }),
    403,
    "Forbidden",
  );

  const unauthorized = await fetch(
    `${environment().peppolFixtureUrl}/inbound/${envelope.transportMessageId}`,
  );

  expect(unauthorized.status).toBe(401);
  expect((await exchangeFacts(context)).inbound).toBe("0");
  await assertTransportDidNotPost(context);
  await saveEvidence("peppol-inbound-admission-source-refusal", context.book);
});

const Rpc = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Finite,
  result: Schema.optional(Schema.JsonObject),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.Finite,
      message: Schema.String,
      data: Schema.Struct({ code: Accounting.FailureCode }),
    }),
  ),
});

async function peppolTool(context: Context, name: string, arguments_: Schema.JsonObject) {
  const response = await fetch(`${environment().baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${context.book.agentToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: arguments_ },
    }),
  });

  expect(response.status).toBe(200);

  return Schema.decodeUnknownSync(Rpc)(await response.json());
}

test("Peppol public MCP rejects client financial XML and human approval while admitting approved agent delivery", async () => {
  const context = await peppolLegalFixture();
  const { artifact } = await prepare(context);
  const scope = artifact.scope;

  const malformed = await peppolTool(context, "commerce_prepare_peppol_artifact", {
    scope,
    idempotencyKey: `peppol_${key()}`,
    input: { ...artifact.input, payableMinor: "1", xml: "<Invoice/>" },
  });

  expect(malformed.error).toEqual({
    code: -32602,
    message: "Invalid tool arguments.",
    data: { code: "InvalidRequest" },
  });

  const agentApproval = await peppolTool(context, "commerce_approve_peppol_exchange", {
    scope,
    idempotencyKey: `peppol_${key()}`,
    artifactId: artifact.id,
    input: { digest: artifact.digest },
  });

  expect(agentApproval.error).toEqual({
    code: -32602,
    message: "Unknown tool.",
    data: { code: "InvalidRequest" },
  });

  const approval = await post(
    context.reviewer,
    `/commerce/peppol/artifacts/${artifact.id}/approvals`,
    { digest: artifact.digest },
    Approval,
  );

  const sent = await peppolTool(context, "commerce_dispatch_peppol_exchange", {
    scope,
    idempotencyKey: `peppol_${key()}`,
    artifactId: artifact.id,
    input: { digest: artifact.digest, approvalId: approval.id },
  });

  expect(sent.result, JSON.stringify(sent)).toMatchObject({ isError: false });

  const result = Schema.decodeUnknownSync(
    Schema.Struct({
      isError: Schema.Literal(false),
      structuredContent: Schema.Struct({ result: Attempt }),
    }),
  )(sent.result);

  expect([
    result.structuredContent.result.outcome,
    result.structuredContent.result.admittedBy,
    result.structuredContent.result.paid,
    result.structuredContent.result.posted,
  ]).toEqual(["transport_accepted", context.book.agentId, false, false]);
  await assertTransportDidNotPost(context);
  await saveEvidence("peppol-mcp-human-approved-delivery", context.book);
});

for (const fault of ["revoked_approver", "stale_binding"]) {
  test(`Peppol confirmed absence cannot resubmit after ${fault}`, async () => {
    const context = await peppolLegalFixture();
    const { artifact, approval, recipient } = await approvedArtifact(context);
    const input = { digest: artifact.digest, approvalId: approval.id };
    const agent = { ...context.book, token: context.book.agentToken };
    await control(artifact.expected.documentId, { rejectSubmit: true });
    await failure(
      await request(agent, `/commerce/peppol/artifacts/${artifact.id}/dispatch`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
      503,
      "Unavailable",
    );

    if (fault === "revoked_approver") {
      const admin = await database();

      try {
        await admin.query("delete from openerp.memberships where book_id=$1 and actor_id=$2", [
          context.book.bookId,
          context.reviewer.actorId,
        ]);
      } finally {
        await admin.end();
      }
    } else {
      await post(
        context.author,
        "/commerce/peppol/bindings",
        {
          document: recipient.document,
          role: recipient.role,
          participantId: recipient.participantId,
          schemeId: recipient.schemeId,
          providerAccount: recipient.providerAccount,
          active: true,
          evidenceId: recipient.evidenceId,
          buyerReference: "REVIEWED-AFTER-ABSENCE",
          paymentAccountReference: null,
          acknowledgeSyntheticAccessPoint: true,
        },
        Binding,
      );
    }

    await control(artifact.expected.documentId, {});

    const response = await request(agent, `/commerce/peppol/artifacts/${artifact.id}/dispatch`, {
      method: "POST",
      body: JSON.stringify(input),
    });

    if (fault === "revoked_approver") await failure(response, 403, "ApprovalRequired");
    else await failure(response, 409, "StaleDependency");
    expect(await providerMessageCount(`peppol_${artifact.id}`)).toBe(0);
    expect((await exchangeFacts(context)).attempts).toBe("1");
    const admin = await database();

    try {
      const admissions = await admin.query<{ total: string }>(
        "select count(*)::text total from openerp.peppol_submission_admissions where book_id=$1",
        [context.book.bookId],
      );

      expect(admissions.rows).toEqual([{ total: "1" }]);
    } finally {
      await admin.end();
    }

    await assertTransportDidNotPost(context);
    await saveEvidence(`peppol-absence-${fault}-refused`, context.book);
  });
}

test("Peppol actual provider key binds every document hash and recipient before replay", async () => {
  const context = await peppolLegalFixture();
  const { artifact, approval } = await approvedArtifact(context);

  const sent = await post(
    context.book,
    `/commerce/peppol/artifacts/${artifact.id}/dispatch`,
    { digest: artifact.digest, approvalId: approval.id },
    Attempt,
  );

  for (const change of [
    { documentId: "SYNTHETIC-OTHER-DOCUMENT" },
    { documentHash: "0".repeat(64) },
    { recipientParticipant: "5560000027" },
  ]) {
    const response = await fetch(`${environment().peppolFixtureUrl}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${environment().peppolFixtureSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...sent.message, ...change }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "IntegrityIncident" });
  }

  expect(await providerMessageCount(sent.providerKey)).toBe(1);
  await assertTransportDidNotPost(context);
  await saveEvidence("peppol-provider-key-content-identity", context.book);
});

test("Peppol operator API credential cannot create or replay a human delivery approval", async () => {
  const context = await peppolLegalFixture();
  const { artifact } = await prepare(context);
  const operator = await fixture();
  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [context.book.bookId, operator.actorId],
    );
  } finally {
    await admin.end();
  }

  const credential = { ...context.book, actorId: operator.actorId, token: operator.token };
  const input = { digest: artifact.digest };
  await failure(
    await request(credential, `/commerce/peppol/artifacts/${artifact.id}/approvals`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
    403,
    "Forbidden",
  );
  expect((await exchangeFacts(context)).approvals).toBe("0");
  const human = { ...credential, token: (await createSession(operator)).token };
  const commandKey = key();

  const approval = await decoded(
    await request(human, `/commerce/peppol/artifacts/${artifact.id}/approvals`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(input),
    }),
    Approval,
  );

  expect(approval.actorId).toBe(operator.actorId);
  await failure(
    await request(credential, `/commerce/peppol/artifacts/${artifact.id}/approvals`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(input),
    }),
    403,
    "Forbidden",
  );
  expect([
    (await exchangeFacts(context)).approvals,
    (await exchangeFacts(context)).attempts,
  ]).toEqual(["1", "0"]);
  await assertTransportDidNotPost(context);
  await saveEvidence("peppol-human-session-before-replay", context.book);
});
