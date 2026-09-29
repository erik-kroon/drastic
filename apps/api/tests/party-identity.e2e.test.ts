import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as PartyIdentity from "@open-erp/contracts/party-identity";
import { environment, key, post, request } from "./support/fixtures";
import { acceptDraft, createDraft, supplierFixture } from "./support/supplier-review";
import type { BookFixture } from "./support/fixtures";

// NEXT-27 reviewed party identity resolution, proven over real HTTP against
// the restricted runtime role and a real PostgreSQL.
//
// A resolution records what a human reviewed; it never discovers identity
// from similar names, never merges a balance and never rewrites a payee
// fact. The expectations below are derived by hand from the retained
// counterparties, invoices and evidence this test creates. The owner is never
// asked to be its own oracle, and an identifier is never asserted: every
// identity the test depends on is read back from a retained counterparty
// revision, invoice or receipt.

const path = "/commerce/party-identity";

async function counterparty(
  book: BookFixture,
  externalKey: string,
  displayName: string,
  evidenceId: string,
) {
  return post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey,
      role: "supplier",
      displayName,
      evidenceId,
      reason: "Synthetic identity fixture",
    },
    Schema.Struct({ id: Schema.String, revision: Schema.String }),
  );
}

async function prepare(
  book: BookFixture,
  partyIds: ReadonlyArray<string>,
  canonicalPartyId: string,
  kind: "same_legal_entity" | "related_but_distinct" | "not_duplicate",
  evidenceId: string | null,
  commandKey?: string,
) {
  const response = await request(book, path, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": commandKey ?? key() },
    body: JSON.stringify({ partyIds: [...partyIds], canonicalPartyId, kind, evidenceId }),
  });

  return { response, body: await response.text() };
}

async function balances(
  book: BookFixture,
  partyIds: ReadonlyArray<string>,
  resolutionKey: string | null,
  commandKey?: string,
) {
  const response = await request(book, `${path}/balances`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": commandKey ?? key() },
    body: JSON.stringify({ partyIds: [...partyIds], resolutionKey }),
  });

  return { response, body: await response.text() };
}

function reportOf(body: string) {
  return Schema.decodeSync(Schema.fromJsonString(PartyIdentity.PartyResolutionReport))(body);
}

function viewOf(body: string) {
  return Schema.decodeSync(Schema.fromJsonString(PartyIdentity.DirectoryBalanceView))(body);
}

test("two records resolve as the same entity on reviewed evidence, and balances group without netting", async () => {
  const { book, source } = await supplierFixture();

  const first = await counterparty(book, "ext_alpha", "Alpha Supplier AB", source.id);
  const second = await counterparty(book, "ext_beta", "Beta Supplier AB", source.id);

  // An invoice against the first record, so the balance view and the
  // invalidation list have a real obligation to work with.
  const { content } = await supplierFixture();
  void content;

  const invoiceContent = {
    title: "Identity review journey",
    counterpartyId: first.id,
    counterpartyRevision: first.revision,
    supplier: {
      legalName: "Alpha Supplier AB",
      registrationId: "5560000001",
      taxId: null,
      address: "Synthetic street 1",
      countryCode: "SE",
      evidenceId: source.id,
    },
    buyer: {
      legalName: "Alpha Supplier AB",
      registrationId: "5560000001",
      taxId: null,
      address: "Synthetic street 1",
      countryCode: "SE",
      evidenceId: source.id,
    },
    sourceEvidenceId: source.id,
    supplierDocumentNumber: "IDENT-001",
    currency: "SEK",
    currencyScale: 2,
    documentDate: "2026-09-22",
    supplyDate: "2026-09-22",
    dueDate: "2026-10-22",
    paymentTerms: "30 days",
    sourceTotalMinor: "10000",
    lines: [
      {
        id: "line_identity",
        description: "Synthetic service",
        quantity: "1",
        unitPriceMinor: "10000",
        baseMinor: "10000",
        discountMinor: "0",
        chargeMinor: "0",
        taxMinor: "0",
        taxDescription: "Synthetic zero tax",
        taxEvidenceId: source.id,
        sourceGrossMinor: "10000",
      },
    ],
  };

  const draft = await createDraft(book, invoiceContent);
  await acceptDraft(book, draft);

  // Without reviewed evidence a same-entity claim is refused, even though
  // both records exist and the request is well formed.
  const unreviewed = await prepare(
    book,
    [first.id, second.id],
    first.id,
    "same_legal_entity",
    null,
    key(),
  );

  expect(unreviewed.response.status).toBe(422);

  // With cited retained evidence the resolution records, carrying the
  // invoice as an invalidated obligation and no invented members.

  const commandKey = key();

  const prepared = await prepare(
    book,
    [first.id, second.id],
    first.id,
    "same_legal_entity",
    source.id,
    commandKey,
  );

  expect(prepared.response.status).toBe(200);

  const report = reportOf(prepared.body);

  expect(report.canonicalPartyId).toBe(first.id);
  expect(report.kind).toBe("same_legal_entity");
  expect(report.evidenceReviewed).toBe(true);
  expect(report.evidenceRef).toBe(source.id);
  expect(report.members.map((member) => member.partyId).sort()).toEqual(
    [first.id, second.id].sort(),
  );

  // Every derived identifier is unverified, because the retained record
  // marks legal identity unverified. The resolution rests on the reviewed
  // evidence, not on a verified number the system never checked.
  for (const member of report.members) {
    expect(member.identifiers.length).toBeGreaterThan(0);

    for (const identifier of member.identifiers) {
      expect(identifier.verified).toBe(false);
    }
  }

  expect(report.invalidatedObligationIds).toHaveLength(1);
  expect(report.memberDigest).toMatch(/^sha256:/);

  // Same key replays the saved report; the balance view then groups the one
  // retained obligation under the canonical identity.
  const replayed = await prepare(
    book,
    [first.id, second.id],
    first.id,
    "same_legal_entity",
    source.id,
    commandKey,
  );

  expect(replayed.response.status).toBe(200);
  expect(replayed.body).toBe(prepared.body);

  const view = await balances(book, [first.id, second.id], commandKey);
  expect(view.response.status).toBe(200);

  const grouped = viewOf(view.body);

  expect(grouped.complete).toBe(true);
  expect(grouped.resolutionId).toBe(report.resolutionId);
  expect(grouped.groups).toHaveLength(1);
  expect(grouped.groups[0]?.legalIdentity).toBe(first.id);
  expect(grouped.groups[0]?.totalOutstandingMinor).toBe("10000");
  expect(grouped.groups[0]?.obligationIds).toEqual(report.invalidatedObligationIds);
});

test("a related classification needs no evidence, and an unknown party is refused", async () => {
  const { book, source } = await supplierFixture();

  const first = await counterparty(book, "ext_gamma", "Gamma Supplier AB", source.id);
  const second = await counterparty(book, "ext_delta", "Delta Supplier AB", source.id);

  const related = await prepare(
    book,
    [first.id, second.id],
    first.id,
    "related_but_distinct",
    null,
    key(),
  );

  expect(related.response.status).toBe(200);

  const relatedReport = reportOf(related.body);

  expect(relatedReport.evidenceReviewed).toBe(false);
  expect(relatedReport.evidenceRef).toBeNull();

  const unknown = await prepare(
    book,
    [first.id, "party_does_not_exist"],
    first.id,
    "not_duplicate",
    null,
    key(),
  );

  expect(unknown.response.status).toBe(404);

  // A canonical party outside the member set is refused, not reinterpreted.
  const outside = await prepare(
    book,
    [first.id, second.id],
    "party_does_not_exist",
    "not_duplicate",
    null,
    key(),
  );

  expect(outside.response.status).toBe(422);
});

const Envelope = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Finite,
  result: Schema.Unknown,
});

const Catalog = Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) });

test("an agent reads grouped balances but cannot record an identity decision", async () => {
  const { book, source } = await supplierFixture();

  const first = await counterparty(book, "ext_epsilon", "Epsilon Supplier AB", source.id);
  const second = await counterparty(book, "ext_zeta", "Zeta Supplier AB", source.id);

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

  // The balance view is a read tool. Recording that two parties are the same
  // legal entity is a reviewed human decision, so no prepare tool is exposed.
  expect(names).toContain("directory_read_balances");
  expect(
    names.filter((name) => /prepare|approv|activat/.test(name) && /part|ident|resol/.test(name)),
  ).toEqual([]);

  const call = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "directory_read_balances",
        arguments: {
          scope: { entityId: book.entityId, bookId: book.bookId },
          idempotencyKey: key(),
          input: { partyIds: [first.id, second.id], resolutionKey: null },
        },
      },
    }),
  });

  expect(call.status).toBe(200);

  const result = Schema.decodeUnknownSync(
    Schema.Struct({
      structuredContent: Schema.Struct({ result: PartyIdentity.DirectoryBalanceView }),
    }),
  )(Schema.decodeUnknownSync(Envelope)(await call.json()).result).structuredContent.result;

  // With no obligations and no resolution, the view is honestly empty rather
  // than grouped by assertion.
  expect(result.complete).toBe(true);
  expect(result.groups).toEqual([]);
  expect(result.resolutionId).toBeNull();
});
