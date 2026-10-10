import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Firms from "@open-erp/contracts/firms";
import { Capabilities } from "@open-erp/contracts/capabilities";
import { capabilityAgentPolicy } from "../src/application/capabilities/agent-policy";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Deadlines from "@open-erp/contracts/deadlines";
import * as Delivery from "@open-erp/contracts/legal-delivery";
import * as Pdf from "@open-erp/contracts/legal-invoice-pdf";
import { legalFixture } from "./support/legal-commerce";
import * as Schema from "effect/Schema";
import {
  createSession,
  database,
  decoded,
  environment,
  evidence,
  execute,
  fixture,
  journal,
  key,
  post,
  prepare,
} from "./support/fixtures";

async function http(token: string, path: string, method = "GET", input?: unknown, now?: string) {
  return fetch(`${environment().baseUrl}/api/v1/firms${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": key(),
      ...(now ? { "x-openerp-test-now": now } : {}),
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
}

async function rpc(token: string, method: string, params: unknown, now?: string) {
  const response = await fetch(`${environment().baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
      "MCP-Protocol-Version": "2025-11-25",
      ...(now ? { "x-openerp-test-now": now } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  expect(response.status).toBe(200);

  return response.json();
}

test("portfolio admits a provisioned member credential across HTTP and MCP but not an unprovisioned agent", async () => {
  const book = await fixture(
    [{ id: "account_revenue", code: "4000", name: "Synthetic cost" }],
    [
      { id: "period_early", startsOn: "2026-01-01", endsOn: "2026-06-30" },
      { id: "period_2026", startsOn: "2026-07-01", endsOn: "2026-12-31" },
    ],
  );

  const session = await createSession(book);

  const created = await decoded(
    await http(session.token, "", "POST", { name: "Synthetic bureau" }),
    Firms.CommandResult,
  );

  const linked = await decoded(
    await http(session.token, `/${created.firmId}/clients`, "POST", {
      scope: { entityId: book.entityId, bookId: book.bookId },
      leadId: null,
      nextReviewOn: null,
      note: "Synthetic",
      expectedRevision: 0,
    }),
    Firms.CommandResult,
  );

  const empty = await decoded(
    await http(session.token, "", "POST", { name: "Empty bureau" }),
    Firms.CommandResult,
  );

  const emptyPortfolio = await decoded(
    await http(session.token, `/${empty.firmId}/portfolio`),
    Firms.Portfolio,
  );

  expect(emptyPortfolio.clients).toEqual([]);

  const other = await fixture();
  await createSession(other);

  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.memberships(book_id, actor_id, role) VALUES ($1, $2, 'operator')",
      [other.bookId, book.actorId],
    );
  } finally {
    await admin.end();
  }

  const addedMember = await decoded(
    await http(session.token, `/${created.firmId}/members`, "POST", {
      email: `${other.actorId}@e2e.invalid`,
      role: "accountant",
      active: true,
      expectedRevision: 0,
    }),
    Firms.CommandResult,
  );

  await decoded(
    await http(session.token, `/${created.firmId}/clients`, "POST", {
      scope: { entityId: other.entityId, bookId: other.bookId },
      leadId: null,
      nextReviewOn: null,
      note: "Second book",
      expectedRevision: 0,
    }),
    Firms.CommandResult,
  );

  const restricted = await decoded(
    await http(other.token, `/${created.firmId}/portfolio`),
    Firms.Portfolio,
  );

  expect(restricted.clients.map((client) => client.scope.bookId)).toEqual([other.bookId]);
  const source = await evidence(book);

  const party = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "supplier",
      displayName: "Synthetic creditor",
      evidenceId: source.id,
      reason: "Portfolio proof",
    },
    Commerce.CounterpartyRevision,
  );

  const payable = await post(
    book,
    "/change-sets",
    {
      ...journal(source.id, "12345"),
      accountingPeriodId: "period_early",
      postingDate: "2026-01-02",
      lines: [
        {
          accountId: "account_revenue",
          debitMinor: "12345",
          creditMinor: "0",
          description: "Expense",
        },
        {
          accountId: "account_clearing",
          debitMinor: "0",
          creditMinor: "12345",
          description: "Payable",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const posted = await execute(book, payable);

  const payableLine = payable.groups[0]?.actions[0]?.lines.find(
    (line) => line.accountId === "account_clearing",
  );

  if (!payableLine) throw new Error("Missing synthetic payable line");

  const invoice = await post(
    book,
    "/commerce/invoices",
    {
      kind: "synthetic_invoice_v1",
      direction: "supplier",
      counterpartyId: party.id,
      counterpartyRevision: party.revision,
      documentNumber: key(),
      issuedOn: "2026-01-02",
      dueOn: "2026-01-31",
      currency: "SEK",
      amountMinor: "12345",
      controlAccountId: "account_clearing",
      recognitionVoucherId: posted.voucherId,
      recognitionLineId: payableLine.lineId,
      evidenceId: source.id,
      description: "Synthetic obligation",
    },
    Commerce.Invoice,
  );

  const older = await post(
    book,
    "/change-sets",
    {
      ...journal(source.id, "321"),
      accountingPeriodId: "period_early",
      postingDate: "2026-03-01",
      eventKey: key(),
    },
    Accounting.ChangeSet,
  );

  for (let index = 0; index < 50; index++) {
    await post(
      book,
      "/change-sets",
      {
        ...journal(source.id, "100"),
        eventKey: key(),
        accountingPeriodId: "period_early",
        postingDate: "2026-02-01",
        description: `Older synthetic proposal ${index}`,
      },
      Accounting.ChangeSet,
    );
  }

  const plan = await prepare(book);
  await decoded(
    await http(session.token, `/${created.firmId}/clients`, "POST", {
      scope: { entityId: book.entityId, bookId: book.bookId },
      leadId: book.actorId,
      nextReviewOn: "2026-01-01",
      note: "Review due",
      expectedRevision: linked.revision,
    }),
    Firms.CommandResult,
  );

  const deadline = await post(
    book,
    "/deadlines/portfolio_due",
    {
      expectedRevision: null,
      input: {
        title: "Synthetic VAT obligation",
        periodId: "period_2026",
        responsibleActorId: book.actorId,
        dueAt: "2026-10-02T22:30:00.000Z",
        timeZone: "Europe/Stockholm",
        sourceReference: "Synthetic reviewed calendar",
        sourceRevision: "v1",
        jurisdiction: "SE",
        statutoryBasis: {
          jurisdiction: "SE",
          family: "vat",
          ruleReference: "synthetic-vat",
          ruleVersion: 1,
          calendarReference: "synthetic-calendar",
          periodId: "period_2026",
          basisDueAt: "2026-10-02T22:30:00.000Z",
        },
        requiredEnvironment: "sandbox",
        outcomeKind: "accepted",
      },
    },
    Deadlines.Deadline,
  );

  const path = `/${created.firmId}/portfolio`;
  const now = "2026-10-02T22:31:00.000Z";

  const beforeMidnight = await decoded(
    await http(book.token, path, "GET", undefined, "2026-10-02T21:59:00.000Z"),
    Firms.Portfolio,
  );

  expect(beforeMidnight.needsToday.some((item) => item.id === deadline.id)).toBe(false);

  const browser = await decoded(
    await http(session.token, path, "GET", undefined, now),
    Firms.Portfolio,
  );

  const credential = await decoded(
    await http(book.token, path, "GET", undefined, now),
    Firms.Portfolio,
  );

  expect(credential.workspace.actorId).toBe(browser.workspace.actorId);
  expect(credential.clients).toHaveLength(2);
  expect(
    credential.clients.find((client) => client.scope.bookId === book.bookId)?.openWork.byKind
      .journal,
  ).toBe("52");
  expect(
    credential.clients.find((client) => client.scope.bookId === book.bookId)?.lastActivityAt,
  ).not.toBeNull();
  expect(credential.needsToday).toContainEqual({
    scope: { entityId: book.entityId, bookId: book.bookId },
    source: "firm_review",
    id: book.bookId,
    dueOn: "2026-01-01",
  });
  expect(credential.clients[0]?.openWork.byKind.supplier).toBe("0");
  expect(
    credential.clients.find((client) => client.scope.bookId === book.bookId)?.assignedAccountantId,
  ).toBe(book.actorId);
  expect(
    credential.clients.find((client) => client.scope.bookId === other.bookId)?.assignedAccountantId,
  ).toBeNull();
  expect(
    credential.clients.find((client) => client.scope.bookId === book.bookId)?.supplierObligations
      .coverage,
  ).toBe("partial");
  expect(credential.needsToday).toContainEqual({
    scope: { entityId: book.entityId, bookId: book.bookId },
    source: "supplier_obligation",
    id: invoice.id,
    dueOn: "2026-01-31",
  });
  expect(
    credential.clients.find((client) => client.scope.bookId === book.bookId)?.nearestKnownDeadline,
  ).toEqual({
    source: "supplier_obligation",
    id: invoice.id,
    dueOn: "2026-01-31",
  });
  expect(
    credential.clients.find((client) => client.scope.bookId === book.bookId)?.unknownOutcomes,
  ).toEqual({
    coverage: "legal_delivery_provider_attempts_only",
    items: [],
  });
  expect(credential.needsToday).toContainEqual({
    scope: { entityId: book.entityId, bookId: book.bookId },
    source: "deadline",
    id: deadline.id,
    dueOn: "2026-10-03",
  });
  expect(plan.id).toBeTruthy();
  expect(older.id).toBeTruthy();
  expect(
    credential.clients.find((client) => client.scope.bookId === book.bookId)?.openWork.byKind
      .journal,
  ).toBe("52");
  expect(credential.clients.find((client) => client.scope.bookId === book.bookId)?.openTasks).toBe(
    "1",
  );
  expect((await http(book.agentToken, path)).status).toBe(403);
  expect((await http(book.token, `/${created.firmId}`)).status).toBe(403);

  const catalog = await rpc(book.token, "tools/list", {});

  const tools = catalog.result.tools as Array<{
    name: string;
    annotations: { readOnlyHint: boolean };
  }>;

  expect(tools.some((tool) => tool.name === "firm_get_portfolio")).toBe(true);
  expect(tools.some((tool) => tool.name === "firm_save_member")).toBe(false);

  const call = await rpc(
    book.token,
    "tools/call",
    {
      name: "firm_get_portfolio",
      arguments: { firmId: created.firmId },
    },
    now,
  );

  const mcpPortfolio = Schema.decodeUnknownSync(Firms.Portfolio)(
    call.result.structuredContent.result,
  );

  expect(mcpPortfolio.workspace).toEqual(credential.workspace);
  expect(mcpPortfolio.needsToday).toEqual(credential.needsToday);
  expect(
    mcpPortfolio.clients.map((client) => ({
      scope: client.scope,
      openWork: client.openWork,
      supplierObligations: client.supplierObligations,
      unknownOutcomes: client.unknownOutcomes,
      nearestKnownDeadline: client.nearestKnownDeadline,
      deadlines: client.deadlines,
      assignedAccountantId: client.assignedAccountantId,
      lastActivityAt: client.lastActivityAt,
      lastActivityCoverage: client.lastActivityCoverage,
    })),
  ).toEqual(
    credential.clients.map((client) => ({
      scope: client.scope,
      openWork: client.openWork,
      supplierObligations: client.supplierObligations,
      unknownOutcomes: client.unknownOutcomes,
      nearestKnownDeadline: client.nearestKnownDeadline,
      deadlines: client.deadlines,
      assignedAccountantId: client.assignedAccountantId,
      lastActivityAt: client.lastActivityAt,
      lastActivityCoverage: client.lastActivityCoverage,
    })),
  );
  expect(mcpPortfolio.clients.map((client) => client.scope)).toEqual(
    credential.clients.map((client) => client.scope),
  );

  const denied = await rpc(book.agentToken, "tools/call", {
    name: "firm_get_portfolio",
    arguments: { firmId: created.firmId },
  });

  expect(denied.result.isError).toBe(true);

  const authority = await database();

  try {
    const deniedPortfolio = () => http(other.token, path);
    await authority.query("UPDATE openerp.credentials SET revoked_at = now() WHERE actor_id = $1", [
      other.actorId,
    ]);
    expect((await deniedPortfolio()).status).toBe(403);
    await authority.query(
      "UPDATE openerp.credentials SET revoked_at = null, expires_at = now() - interval '1 second' WHERE actor_id = $1",
      [other.actorId],
    );
    expect((await deniedPortfolio()).status).toBe(403);
    await authority.query(
      "UPDATE openerp.credentials SET expires_at = now() + interval '1 day' WHERE actor_id = $1",
      [other.actorId],
    );
    await authority.query(
      "UPDATE openerp.identity_admissions SET enabled = false WHERE actor_id = $1",
      [other.actorId],
    );
    expect((await deniedPortfolio()).status).toBe(403);
    await authority.query(
      "UPDATE openerp.identity_admissions SET enabled = true WHERE actor_id = $1",
      [other.actorId],
    );

    const removedMember = await decoded(
      await http(session.token, `/${created.firmId}/members`, "POST", {
        email: `${other.actorId}@e2e.invalid`,
        role: "accountant",
        active: false,
        expectedRevision: addedMember.revision,
      }),
      Firms.CommandResult,
    );

    expect((await deniedPortfolio()).status).toBe(403);

    await decoded(
      await http(session.token, `/${created.firmId}/members`, "POST", {
        email: `${other.actorId}@e2e.invalid`,
        role: "accountant",
        active: true,
        expectedRevision: removedMember.revision,
      }),
      Firms.CommandResult,
    );
    await authority.query("DELETE FROM openerp.memberships WHERE book_id = $1 AND actor_id = $2", [
      other.bookId,
      other.actorId,
    ]);
    expect((await decoded(await deniedPortfolio(), Firms.Portfolio)).clients).toEqual([]);
  } finally {
    await authority.end();
  }

  const classes = new Map(
    Object.entries(Capabilities).map(([name, definition]) => [
      name,
      capabilityAgentPolicy(name, definition).classification,
    ]),
  );

  await writeFile(
    join(environment().artifacts, "firm-portfolio.json"),
    JSON.stringify(
      {
        scope: book.bookId,
        portfolio: credential,
        catalog: {
          bearerTransport: "existing_member_credential_not_oauth_onboarding",
          total: tools.length,
          read: tools.filter((tool) => tool.annotations.readOnlyHint).length,
          prepare: tools.filter(
            (tool) => !tool.annotations.readOnlyHint && classes.get(tool.name) === "prepare",
          ).length,
          approvedExecute: tools.filter(
            (tool) =>
              !tool.annotations.readOnlyHint && classes.get(tool.name) === "execute_approved",
          ).length,
          other: tools.filter(
            (tool) =>
              !tool.annotations.readOnlyHint &&
              !["prepare", "execute_approved"].includes(classes.get(tool.name) ?? ""),
          ).length,
          comparison:
            "Accounted claims 150+ tools; no measured feature parity or OAuth onboarding claim",
          tools,
        },
      },
      null,
      2,
    ),
  );
});

test("portfolio reports retained legal provider unknown until owner reconciliation", async () => {
  const { book, author, reviewer, original } = await legalFixture();

  const firm = await decoded(
    await http(author.token, "", "POST", { name: "Delivery bureau" }),
    Firms.CommandResult,
  );

  await decoded(
    await http(author.token, `/${firm.firmId}/clients`, "POST", {
      scope: { entityId: book.entityId, bookId: book.bookId },
      leadId: null,
      nextReviewOn: null,
      note: "Synthetic legal delivery",
      expectedRevision: 0,
    }),
    Firms.CommandResult,
  );

  const pdf = await post(
    book,
    "/commerce/legal-invoice-pdfs",
    {
      issueId: original.id,
      issueDigest: original.digest,
      rendererVersion: "openerp-se-invoice-pdfcn-v1",
    },
    Pdf.LegalInvoicePdfView,
  );

  if (!pdf.artifact) throw new Error("Synthetic PDF artifact missing");

  const requestView = await post(
    author,
    "/commerce/legal-deliveries",
    {
      pdfCaptureId: pdf.capture.id,
      captureDigest: pdf.capture.digest,
      artifactSha256: pdf.artifact.sha256,
      channel: "email",
      destination: "synthetic@example.invalid",
      providerProfileKey: "synthetic_email",
      reason: "Synthetic retained provider attempt",
    },
    Delivery.LegalDeliveryView,
  );

  const approvalView = await post(
    reviewer,
    `/commerce/legal-deliveries/${requestView.request.id}/send-approval`,
    {
      requestDigest: requestView.request.digest,
      reason: "Synthetic reviewer",
      approveSendHandoff: true,
    },
    Delivery.LegalDeliveryView,
  );

  if (!approvalView.approval) throw new Error("Synthetic send approval missing");

  const attemptView = await post(
    reviewer,
    `/commerce/legal-deliveries/${requestView.request.id}/provider-attempts`,
    {
      requestDigest: requestView.request.digest,
      approvalId: approvalView.approval.id,
      providerProfileKey: "synthetic_email",
      acknowledgeUncertainBoundary: true,
    },
    Delivery.LegalDeliveryView,
  );

  const unknown = attemptView.attempts.at(-1)?.attempt;

  if (!unknown) throw new Error("Synthetic provider attempt missing");

  expect(unknown.status).toBe("provider_unknown");
  expect(unknown.externalTrafficProven).toBe(false);

  const portfolio = await decoded(
    await http(book.token, `/${firm.firmId}/portfolio`),
    Firms.Portfolio,
  );

  expect(portfolio.clients[0]?.unknownOutcomes.items).toContainEqual({
    id: unknown.id,
    kind: "legal_delivery_provider_unknown",
    recordedAt: unknown.startedAt,
  });
  const observation = await evidence(book);
  await post(
    author,
    `/commerce/legal-delivery-attempts/${unknown.id}/reconcile`,
    {
      attemptDigest: unknown.digest,
      providerRequestId: unknown.providerRequestId,
      outcome: "confirmed_not_sent",
      providerMessageId: null,
      providerEvidence: { evidenceId: observation.id, sha256: observation.sha256 },
      reason: "Synthetic retained no-send observation",
    },
    Delivery.LegalDeliveryView,
  );

  const resolved = await decoded(
    await http(book.token, `/${firm.firmId}/portfolio`),
    Firms.Portfolio,
  );

  expect(resolved.clients[0]?.unknownOutcomes.items).toEqual([]);
});
