import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as Batches from "@open-erp/contracts/supplier-payment-batches";
import * as Resolutions from "@open-erp/contracts/payment-resolutions";
import { createHash, randomBytes } from "node:crypto";
import { database, decoded, environment, key, post, request } from "./support/fixtures";
import { acceptDraft, createDraft, supplierFixture } from "./support/supplier-review";
import type { BookFixture } from "./support/fixtures";

// NEXT-08 payment instruction resolution and replacement, proven over real
// HTTP against the restricted runtime role and a real PostgreSQL.
//
// The central fact this suite establishes is a refusal to upgrade evidence:
// a retained operator rejection is recorded in the outcome inventory, and the
// leaf refuses that branch outright, so the instruction stays reserved and the
// report says unknown. An XML file is not a paid invoice, and neither is its
// resolution, and neither is an operator's report that it was never sent.
//
// The expectations below are derived by hand from the amounts this test posts
// and the retained outcome chain it records. The resolution owner is never
// asked to be its own oracle, and an instruction is never identified by
// assertion: every identity the test depends on is read back from a retained
// export, outcome or receipt.

const batchPath = "/commerce/supplier-payment-batches";

// Payee verification requires a different actor than the proposer, so the
// test provisions a second operator by the same admin pattern the fixture
// itself uses for the agent token.
async function secondOperatorToken(book: BookFixture): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const actorId = `operator2_${randomBytes(4).toString("hex")}`;
  const admin = await database();

  try {
    await admin.query("INSERT INTO openerp.actors(id, name) VALUES ($1, 'E2E second operator')", [
      actorId,
    ]);
    await admin.query(
      "INSERT INTO openerp.memberships(book_id, actor_id, role) VALUES ($1, $2, 'operator')",
      [book.bookId, actorId],
    );
    await admin.query(
      "INSERT INTO openerp.credentials(token_hash, actor_id, expires_at) VALUES ($1, $2, now() + interval '1 day')",
      [createHash("sha256").update(token).digest("hex"), actorId],
    );
  } finally {
    await admin.end();
  }

  return token;
}

async function verifiedPayeeId(
  book: BookFixture,
  counterpartyId: string,
  counterpartyRevision: string,
  evidenceId: string,
) {
  const proposal = await post(
    book,
    `${batchPath}/payees`,
    {
      counterpartyId,
      expectedRevision: counterpartyRevision,
      creditorName: "Architecture review supplier",
      creditorIban: "SE4550000000058398257466",
      creditorBic: "ESSESESS",
      evidenceId,
      reason: "Synthetic resolution fixture",
    },
    Batches.PayeeProposal,
  );

  const verifier = await secondOperatorToken(book);

  const verificationResponse = await fetch(
    `${environment().baseUrl}${book.path}${batchPath}/payees/${proposal.id}/verify`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${verifier}`,
        "content-type": "application/json",
        "idempotency-key": key(),
      },
      body: JSON.stringify({
        digest: proposal.digest,
        evidenceId,
        reason: "Synthetic independent check",
        confirmIndependentCheck: true,
      }),
    },
  );

  return decoded(verificationResponse, Batches.PayeeVerification);
}

async function eligibleInvoice(book: BookFixture, content: Parameters<typeof createDraft>[1]) {
  const draft = await createDraft(book, content);
  await acceptDraft(book, draft);

  const eligibility = await decoded(
    await request(book, `${batchPath}/eligibility`),
    Batches.PaymentEligibility,
  );

  const item = eligibility.items.find(
    (candidate) => candidate.outstandingMinor !== null && BigInt(candidate.outstandingMinor) > 0n,
  );

  expect(item).toBeDefined();

  return item!;
}

async function prepareInvoice(book: BookFixture, content: Parameters<typeof createDraft>[1]) {
  const item = await eligibleInvoice(book, content);

  return { invoiceId: item.invoiceId, amount: item.outstandingMinor! };
}

async function exportForInvoice(
  book: BookFixture,
  source: { id: string },
  supplier: { id: string; revision: string },
  invoiceId: string,
) {
  const payeeVerificationId = (
    await verifiedPayeeId(book, supplier.id, supplier.revision, source.id)
  ).id;

  const evidenceId = source.id;

  // The live outstanding and allocation version are read back from the
  // retained invoice, never asserted, so a changed register is a refusal
  // rather than a stale export.
  const eligibility = await decoded(
    await request(book, `${batchPath}/eligibility`),
    Batches.PaymentEligibility,
  );

  const live = eligibility.items.find((candidate) => candidate.invoiceId === invoiceId);

  expect(live).toBeDefined();
  expect(live!.outstandingMinor).not.toBeNull();

  const preview = await post(
    book,
    batchPath,
    {
      profile: "synthetic-offline-pain001-v1",
      executionDate: "2026-10-01",
      debtorName: "Synthetic debtor AB",
      debtorIban: "SE4550000000058398257466",
      debtorBic: "ESSESESS",
      items: [
        {
          invoiceId,
          expectedOutstandingMinor: live!.outstandingMinor,
          expectedAllocationVersion: live!.allocationVersion,
          amountMinor: live!.outstandingMinor,
          creditorName: "Architecture review supplier",
          creditorIban: "SE4550000000058398257466",
          creditorBic: "ESSESESS",
          payeeEvidenceId: evidenceId,
          payeeVerificationId,
        },
      ],
      reason: "Synthetic resolution fixture",
      acknowledgeOfflineOnly: true,
    },
    Batches.SupplierPaymentPreview,
  );

  const exported = await post(
    book,
    `${batchPath}/${preview.id}/export`,
    { digest: preview.digest, acknowledgeOfflineOnly: true },
    Batches.SupplierPaymentExport,
  );

  return { preview, exported, invoiceId, amount: live!.outstandingMinor! };
}

async function prepareBatch(
  book: BookFixture,
  source: { id: string },
  supplier: { id: string; revision: string },
  content: Parameters<typeof createDraft>[1],
) {
  const { invoiceId } = await prepareInvoice(book, content);

  return exportForInvoice(book, source, supplier, invoiceId);
}

async function resolve(
  book: BookFixture,
  exportId: string,
  invoiceId: string,
  commandKey?: string,
) {
  const response = await request(book, "/commerce/supplier-payment-resolutions", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": commandKey ?? key() },
    body: JSON.stringify({ exportId, invoiceId }),
  });

  return { response, body: await response.text() };
}

async function replace(
  book: BookFixture,
  resolutionKey: string,
  newExportId: string,
  invoiceId: string,
  commandKey?: string,
) {
  const response = await request(book, "/commerce/supplier-payment-resolutions/replacements", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": commandKey ?? key() },
    body: JSON.stringify({ resolutionKey, newExportId, invoiceId }),
  });

  return { response, body: await response.text() };
}

async function recordOutcome(
  book: BookFixture,
  exportId: string,
  sha256: string,
  status: "reported_rejected" | "reported_settled",
  reason: string,
) {
  const admin = await database();

  try {
    const evidenceRows = await admin.query(
      "select id from openerp.evidence where book_id = $1 order by id limit 1",
      [book.bookId],
    );

    const evidenceId = evidenceRows.rows[0]?.id as string;

    expect(evidenceId).toBeDefined();

    return post(
      book,
      `/commerce/supplier-payment-batches/${exportId}/outcomes`,
      {
        exportSha256: sha256,
        status,
        evidenceId,
        externalReference: "Synthetic operator report",
        reason,
        acknowledgeNoAccountingEffect: true,
      },
      Batches.PaymentOutcome,
    );
  } finally {
    await admin.end();
  }
}

function reportOf(body: string) {
  return Schema.decodeSync(Schema.fromJsonString(Resolutions.PaymentResolution))(body);
}

test("an instruction with no proof stays reserved, and a recorded rejection does not become proof", async () => {
  const { book, source, supplier, content } = await supplierFixture();
  const { exported, invoiceId, amount } = await prepareBatch(book, source, supplier, content);

  // With no retained outcome at all the instruction stays reserved and the
  // report says unknown rather than permitting a resubmission it cannot
  // justify.
  const unknown = await resolve(book, exported.id, invoiceId, key());
  expect(unknown.response.status).toBe(200);

  const unknownReport = reportOf(unknown.body);

  expect(unknownReport.releasedAmountMinor).toBe("0");
  expect(unknownReport.proofKind).toBe("none");
  expect(unknownReport.resubmission).toBe("unknown");
  expect(unknownReport.reason).toContain("stays reserved");
  expect(unknownReport.originalAmountMinor).toBe(amount);

  // The operator rejection is recorded in the outcome inventory. The leaf
  // refuses that branch outright, so the second resolution must still report
  // unknown — and must say the rejection is retained but insufficient. This
  // is the honesty case the whole owner exists to prove.
  await recordOutcome(
    book,
    exported.id,
    exported.sha256,
    "reported_rejected",
    "The operator reports the file was never submitted",
  );

  const stillKey = key();
  const stillUnknown = await resolve(book, exported.id, invoiceId, stillKey);
  expect(stillUnknown.response.status).toBe(200);

  const stillUnknownReport = reportOf(stillUnknown.body);

  expect(stillUnknownReport.releasedAmountMinor).toBe("0");
  expect(stillUnknownReport.proofKind).toBe("none");
  expect(stillUnknownReport.resubmission).toBe("unknown");
  expect(stillUnknownReport.reason).toContain("not no-execution proof");

  // Same key replays the saved unknown; a different key over the same
  // inventory is a duplicate economic effect and must refuse.
  const replayed = await resolve(book, exported.id, invoiceId, stillKey);
  expect(replayed.response.status).toBe(200);
  expect(replayed.body).toBe(stillUnknown.body);

  const duplicate = await resolve(book, exported.id, invoiceId, key());
  expect(duplicate.response.status).toBe(409);
});

test("a settled instruction cannot be released", async () => {
  const { book, source, supplier, content } = await supplierFixture();
  const { exported, invoiceId } = await prepareBatch(book, source, supplier, content);

  await recordOutcome(
    book,
    exported.id,
    exported.sha256,
    "reported_settled",
    "The provider reports the instruction settled",
  );

  const resolved = await resolve(book, exported.id, invoiceId, key());

  // There is no capacity to release from a settled instruction, and calling
  // the result a resolution would be a settled payment renamed.
  expect(resolved.response.status).toBe(409);
});

test("a replacement without an effective release is not compiled", async () => {
  const { book, source, supplier, content } = await supplierFixture();
  const { exported, invoiceId } = await prepareBatch(book, source, supplier, content);

  const resolutionKey = key();
  const resolved = await resolve(book, exported.id, invoiceId, resolutionKey);
  expect(resolved.response.status).toBe(200);

  // The resolution released nothing — no proof branch is satisfiable — so
  // the replacement gate refuses even though the successor export is real,
  // covers the same invoice, and carries its own retained digest. The gate
  // fires before the leaf is consulted, which is why this refusal is
  // provable today while a successful replacement is not.
  const unreleased = await replace(book, resolutionKey, exported.id, invoiceId, key());
  expect(unreleased.response.status).toBe(409);

  // The successor points at a different obligation than the one the
  // resolution released, so the gate refuses on the invoice identity alone,
  // without reading any successor export.
  const mismatched = await replace(
    book,
    resolutionKey,
    exported.id,
    "invoice_does_not_exist",
    key(),
  );

  expect(mismatched.response.status).toBe(409);

  const invented = await replace(book, key(), exported.id, invoiceId, key());

  // A resolution key that names no retained resolution is refused, not
  // invented. The gate reads the receipt; it never trusts the caller's
  // description of a resolution.

  expect(invented.response.status).toBe(404);
});

test("a resolution endpoint that names no retained export is refused, not invented", async () => {
  const { book, source, supplier, content } = await supplierFixture();
  const { invoiceId } = await prepareBatch(book, source, supplier, content);

  const resolved = await resolve(book, "export_does_not_exist", invoiceId, key());
  expect(resolved.response.status).toBe(404);

  const misdirected = await resolve(book, "export_does_not_exist", "invoice_does_not_exist", key());
  expect(misdirected.response.status).toBe(404);
});

const Envelope = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Finite,
  result: Schema.Unknown,
});

const Catalog = Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) });

test("an agent reads the honest state and cannot assert what the owner did not establish", async () => {
  const { book, source, supplier, content } = await supplierFixture();
  const { exported, invoiceId } = await prepareBatch(book, source, supplier, content);

  await recordOutcome(
    book,
    exported.id,
    exported.sha256,
    "reported_rejected",
    "The operator reports the file was never submitted",
  );

  const url = `${environment().baseUrl}/api/mcp`;

  const headers = {
    authorization: `Bearer ${book.agentToken}`,
    "content-type": "application/json",
    accept: "application/json",
    "MCP-Protocol-Version": "2025-11-25",
  };

  const catalog = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

  expect(catalog.status).toBe(200);

  const names = Schema.decodeUnknownSync(Catalog)(
    Schema.decodeUnknownSync(Envelope)(await catalog.json()).result,
  ).tools.map((tool) => tool.name);

  // Resolution is a read tool. It is not an approval or activation tool, and
  // it carries no payment or filing authority.
  expect(names).toContain("payments_resolve_instruction");
  expect(names.filter((name) => /approv|activat/.test(name))).toEqual([]);

  const call = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "payments_resolve_instruction",
        arguments: {
          scope: { entityId: book.entityId, bookId: book.bookId },
          idempotencyKey: key(),
          input: { exportId: exported.id, invoiceId },
        },
      },
    }),
  });

  expect(call.status).toBe(200);

  const callBody = await call.json();

  const result = Schema.decodeUnknownSync(
    Schema.Struct({ structuredContent: Schema.Struct({ result: Resolutions.PaymentResolution }) }),
  )(Schema.decodeUnknownSync(Envelope)(callBody).result).structuredContent.result;

  // The agent receives the same honest state the operator does: the
  // rejection is retained, nothing is released, and resubmission is unknown.
  // An agent that summarised this instruction as free would be inventing a
  // proof the owner refused to establish.
  expect(result.releasedAmountMinor).toBe("0");
  expect(result.proofKind).toBe("none");
  expect(result.resubmission).toBe("unknown");
  expect(result.reason).toContain("not no-execution proof");
});
