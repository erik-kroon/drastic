import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Cash from "@open-erp/contracts/cash-method";
import { cashFixture, postedCash, allocateCash } from "./support/cash-payment";
import { createDraft } from "./support/supplier-review";
import * as Fx from "@open-erp/contracts/commerce-fx";
import * as Rates from "@open-erp/contracts/exchange-rates";
import * as Commerce from "@open-erp/contracts/commerce";
import { supplierOpeningFixture } from "./support/cash-basis-supplier";
import {
  cashBasisWorld as world,
  qualifiedCashBasisInput as qualifiedInput,
} from "./support/cash-basis";
import * as SupplierSettlement from "@open-erp/contracts/supplier-settlements";
import * as Reversals from "@open-erp/contracts/commerce-allocation-reversals";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Settlement from "@open-erp/contracts/settlements";
import {
  createSession,
  database,
  decoded,
  environment,
  evidence,
  execute,
  failure,
  fixture,
  journal,
  key,
  persisted,
  post,
  request,
} from "./support/fixtures";

const Observation = Schema.Struct({
  accountId: Schema.String,
  amountMinor: Schema.NullOr(Schema.String),
  effectiveOn: Schema.String,
});

const Opening = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("qualified"),
    totalMinor: Schema.String,
    observations: Schema.Array(Observation),
    blockers: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    totalMinor: Schema.Null,
    observations: Schema.Array(Observation),
    blockers: Schema.Array(Schema.String),
  }),
]);

const Snapshot = Schema.Struct({
  id: Schema.String,
  scope: Accounting.Scope,
  asOf: Accounting.AccountingDate,
  recordedCutoff: Schema.String,
  captureMode: Schema.Literal("current_knowledge"),
  currency: Schema.Literal("SEK"),
  currencyScale: Schema.Literal(2),
  opening: Opening,
  contributions: Schema.Array(
    Schema.Struct({
      invoiceId: Schema.String,
      amountMinor: Schema.NullOr(Schema.String),
      inclusion: Schema.Literals(["included", "excluded", "blocked"]),
      reason: Schema.String,
      dueOn: Accounting.AccountingDate,
      expectedOn: Schema.NullOr(Accounting.AccountingDate),
    }),
  ),
  foreignObligations: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      originalCurrency: Schema.String,
      remainingOriginalMinor: Schema.NullOr(Schema.String),
      inclusion: Schema.Literal("blocked"),
      reason: Schema.String,
    }),
  ),
  coverage: Schema.Array(
    Schema.Struct({ family: Schema.String, status: Schema.String, reason: Schema.String }),
  ),
  companyCoverage: Schema.Literal("incomplete"),
  label: Schema.Literal("known_items"),
  digest: Accounting.Digest,
});

const View = Schema.Struct({
  basis: Snapshot,
  dependenciesCurrent: Schema.Boolean,
  artifact: Schema.Struct({
    content: Schema.String,
    sha256: Schema.String,
    byteLength: Schema.Int,
    mediaType: Schema.Literal("application/json"),
  }),
});

async function capture(context: Awaited<ReturnType<typeof world>>, idempotencyKey = key()) {
  return decoded(
    await request(context.book, "/cash-bases", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify(context.input),
    }),
    Snapshot,
  );
}

test("P10 captures exact selected current openings and immutable known-items bytes through HTTP and MCP", async () => {
  const context = await world();
  const before = await persisted(context.book);
  const commandKey = key();
  const basis = await capture(context, commandKey);
  expect(basis.opening.status).toBe("qualified");
  expect(basis.opening.totalMinor).toBe("150000");
  expect(basis.opening.observations.map((entry) => entry.amountMinor)).toEqual(["100000", "50000"]);
  expect(basis.opening.blockers).toEqual([]);
  expect(basis.contributions).toEqual([]);
  expect(basis.asOf).toBe(context.today);
  expect(basis.recordedCutoff).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(basis.coverage.map((entry) => entry.family)).toEqual([
    "bank",
    "commerce",
    "tax",
    "payroll",
    "owners",
    "assets",
    "financing",
  ]);
  expect(
    basis.coverage
      .filter((entry) => ["tax", "payroll", "owners", "assets", "financing"].includes(entry.family))
      .every((entry) => entry.status !== "qualified" && entry.reason.length > 0),
  ).toBe(true);
  expect(await capture(context, commandKey)).toEqual(basis);
  const view = await decoded(await request(context.book, `/cash-bases/${basis.id}`), View);
  expect(view.basis).toEqual(basis);
  expect(view.dependenciesCurrent).toBe(true);
  expect(Schema.decodeUnknownSync(Snapshot)(JSON.parse(view.artifact.content))).toEqual(basis);
  expect(view.artifact.sha256).toBe(
    createHash("sha256").update(view.artifact.content).digest("hex"),
  );
  expect(view.artifact.byteLength).toBe(Buffer.byteLength(view.artifact.content));
  const exported = await request(context.book, `/cash-bases/${basis.id}/export`);
  expect(exported.status).toBe(200);
  expect(await exported.text()).toBe(view.artifact.content);
  expect(await persisted(context.book)).toEqual(before);

  const rpc = await fetch(`${environment().baseUrl}/api/mcp`, {
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
      params: {
        name: "cash_get_basis",
        arguments: {
          scope: { entityId: context.book.entityId, bookId: context.book.bookId },
          id: basis.id,
        },
      },
    }),
  });

  expect(rpc.status).toBe(200);

  const envelope = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({
        structuredContent: Schema.Struct({ result: View }),
      }),
    }),
  )(await rpc.json());

  expect(envelope.result.structuredContent.result.artifact.content).toBe(view.artifact.content);

  const rpcCapture = await fetch(`${environment().baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${context.book.agentToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "cash_capture_basis",
        arguments: {
          scope: { entityId: context.book.entityId, bookId: context.book.bookId },
          idempotencyKey: key(),
          input: context.input,
        },
      },
    }),
  });

  expect(rpcCapture.status).toBe(200);

  const prepared = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({
        structuredContent: Schema.Struct({ result: Snapshot }),
      }),
    }),
  )(await rpcCapture.json());

  expect(prepared.result.structuredContent.result.opening.totalMinor).toBe("150000");
  expect(prepared.result.structuredContent.result.contributions).toEqual([]);
  expect(await persisted(context.book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "cash-basis-journey.json"),
    JSON.stringify(
      {
        sourceCoverage: context.coverage.coverage,
        independentOpeningMinor: "150000",
        basis,
        sha256: view.artifact.sha256,
        immutableExport: true,
        mcpRead: true,
        mcpCapture: true,
        financialStateUnchanged: true,
      },
      null,
      2,
    ),
  );
}, 120000);

test.each([{ old: true }, { incomplete: true }])(
  "P10 retains dated observations without inventing a current opening %j",
  async (options) => {
    const context = await world(options);
    const basis = await capture(context);
    expect(basis.opening.status).toBe("unavailable");
    expect(basis.opening.totalMinor).toBeNull();
    expect(basis.opening.observations.map((entry) => entry.amountMinor)).toEqual([
      "100000",
      "50000",
    ]);
    expect(basis.opening.blockers.length).toBeGreaterThan(0);
    expect(basis.companyCoverage).toBe("incomplete");
  },
  120000,
);

test("P10 rejects historical knowledge, supplied amounts and cross-book references and rechecks revoked authority", async () => {
  const context = await world();
  await failure(
    await request(context.book, "/cash-bases", {
      method: "POST",
      body: JSON.stringify({ ...context.input, asOf: context.yesterday }),
    }),
    422,
    "UnsupportedProfile",
  );

  for (const injected of [
    { recordedCutoff: "2026-01-01T00:00:00Z" },
    { openingMinor: "999999" },
    { remainingMinor: "0" },
  ]) {
    const response = await request(context.book, "/cash-bases", {
      method: "POST",
      body: JSON.stringify({ ...context.input, ...injected }),
    });

    expect(response.status).toBe(400);
  }

  const foreign = await fixture();
  await failure(
    await request(foreign, "/cash-bases", { method: "POST", body: JSON.stringify(context.input) }),
    404,
    "NotFound",
  );
  const basis = await capture(context);
  const admin = await database();

  try {
    await admin.query("delete from openerp.memberships where book_id=$1 and actor_id=$2", [
      context.book.bookId,
      context.book.actorId,
    ]);
  } finally {
    await admin.end();
  }

  await failure(await request(context.book, `/cash-bases/${basis.id}`), 403, "Forbidden");
  await failure(await request(context.book, `/cash-bases/${basis.id}/export`), 403, "Forbidden");
  await failure(
    await request(context.book, "/cash-bases", {
      method: "POST",
      body: JSON.stringify(context.input),
    }),
    403,
    "Forbidden",
  );
}, 120000);

async function retainedInvoice(context: Awaited<ReturnType<typeof world>>) {
  const source = await evidence(context.book);

  const party = await post(
    context.book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "customer",
      displayName: "Synthetic basis customer",
      evidenceId: source.id,
      reason: "Independent retained invoice",
    },
    Commerce.CounterpartyRevision,
  );

  const draft = journal(source.id, "1000");

  const plan = await post(
    context.book,
    "/change-sets",
    {
      ...draft,
      postingDate: context.today,
      lines: [
        {
          accountId: "account_ar",
          debitMinor: "1000",
          creditMinor: "0",
          description: "Receivable",
        },
        {
          accountId: "account_revenue",
          debitMinor: "0",
          creditMinor: "1000",
          description: "Revenue",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const posted = await execute(context.book, plan);

  const control = plan.groups[0]?.actions[0]?.lines.find(
    (entry) => entry.accountId === "account_ar",
  );

  if (!control) throw new Error("Invoice requires its retained recognition line");

  const invoice = await post(
    context.book,
    "/commerce/invoices",
    {
      kind: "synthetic_invoice_v1",
      direction: "customer",
      counterpartyId: party.id,
      counterpartyRevision: party.revision,
      documentNumber: key(),
      issuedOn: context.today,
      dueOn: context.today,
      currency: "SEK",
      amountMinor: "1000",
      controlAccountId: "account_ar",
      recognitionVoucherId: posted.voucherId,
      recognitionLineId: control.lineId,
      evidenceId: source.id,
      description: "Literal1000 recognized invoice",
    },
    Commerce.Invoice,
  );

  return { invoice, source };
}

test("P10 reads all canonical invoice amounts and retains immutable captures when revisions change", async () => {
  const context = await world();
  const { invoice, source } = await retainedInvoice(context);

  const refreshed = await qualifiedInput(
    context.book,
    context.today,
    context.input.accounts.map(({ accountId, reconciliationId }) => ({
      accountId,
      reconciliationId,
    })),
  );

  context.input = refreshed.input;
  const first = await capture(context);
  expect(first.opening.totalMinor).toBe("150000");
  expect(first.contributions).toEqual([
    expect.objectContaining({
      invoiceId: invoice.id,
      amountMinor: "1000",
      inclusion: "included",
      dueOn: context.today,
      expectedOn: null,
    }),
  ]);
  const initial = await decoded(await request(context.book, `/cash-bases/${first.id}`), View);
  const later = `${context.today.slice(0, 7)}-28`;
  await post(
    context.book,
    `/commerce/invoices/${invoice.id}/revisions`,
    {
      expectedRevision: invoice.currentRevision.revision,
      dueOn: later,
      description: "Retained revised payment terms",
      evidenceId: source.id,
      reason: "Synthetic later knowledge",
    },
    Commerce.Invoice,
  );
  const stale = await decoded(await request(context.book, `/cash-bases/${first.id}`), View);
  expect(stale.artifact.content).toBe(initial.artifact.content);
  expect(stale.dependenciesCurrent).toBe(false);
  const second = await capture(context);
  expect(second.id).not.toBe(first.id);
  expect(second.contributions).toEqual([
    expect.objectContaining({
      invoiceId: invoice.id,
      amountMinor: "1000",
      dueOn: later,
      expectedOn: null,
    }),
  ]);
  expect(second.digest).not.toBe(first.digest);
  await writeFile(
    join(environment().artifacts, "cash-basis-later-knowledge.json"),
    JSON.stringify(
      {
        first,
        second,
        originalContentSha256: initial.artifact.sha256,
        oldBytesUnchanged: true,
      },
      null,
      2,
    ),
  );
}, 120000);

async function foreignItem(context: Awaited<ReturnType<typeof world>>) {
  const source = await evidence(context.book);
  const independent = await fixture();
  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [context.book.bookId, independent.actorId],
    );
  } finally {
    await admin.end();
  }

  const reviewer = {
    ...context.book,
    actorId: independent.actorId,
    token: (await createSession(independent)).token,
  };

  const rate = await post(
    context.book,
    "/exchange-rates",
    {
      sourceKey: key(),
      terms: {
        fromCurrency: "USD",
        toCurrency: "SEK",
        effectiveOn: context.today,
        retrievedOn: context.today,
        rateNumerator: "10",
        rateDenominator: "1",
        evidenceId: source.id,
        sourceLocator: "P10 independently specified synthetic rate",
        reviewEvidenceId: source.id,
        rationale: "USD100.00 carryingSEK1000.00, no default1:1",
      },
    },
    Rates.ExchangeRateRevision,
  );

  const party = await post(
    context.book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "customer",
      displayName: "Synthetic foreign customer",
      evidenceId: source.id,
      reason: "Retained FX obligation",
    },
    Commerce.CounterpartyRevision,
  );

  const review = await post(
    context.book,
    "/commerce/fx/recognition-reviews",
    {
      profile: "synthetic_customer_foreign_receivable_v1",
      sourceKey: key(),
      sourceRevision: "1",
      counterpartyId: party.id,
      counterpartyRevision: party.revision,
      documentNumber: key(),
      recognitionDate: context.today,
      originalCurrency: "USD",
      originalScale: 2,
      originalMinor: "10000",
      rateObservationId: rate.observationId,
      rateDigest: rate.digest,
      accountingPeriodId: "period_2026",
      series: "A",
      controlAccountId: "account_ar",
      cashAccountId: "account_bank",
      realizedGainAccountId: "account_gain",
      realizedLossAccountId: "account_loss",
      accountRoleEvidence: { evidenceId: source.id, sha256: source.sha256 },
      evidenceId: source.id,
      eventKey: `fx_${key()}`,
      reason: "Explicit synthetic FX basis",
      revenueAccountId: "account_revenue",
      syntheticNoTaxConfirmed: true,
      acknowledgeLimitedProfile: true,
    },
    Fx.RecognitionReview,
  );

  const approval = await post(
    reviewer,
    `/commerce/fx/recognition-reviews/${review.id}/approvals`,
    { version: 1, digest: review.digest },
    Fx.FxApproval,
  );

  return post(
    context.book,
    `/commerce/fx/recognition-reviews/${review.id}/execute`,
    { version: 1, digest: review.digest, approvalId: approval.id },
    Fx.MonetaryItem,
  );
}

test("P10 preserves unsupported foreign obligations without converting them or hiding coverage gaps", async () => {
  const context = await world();
  const item = await foreignItem(context);
  const basis = await capture(context);
  expect(basis.contributions).toEqual([]);
  expect(basis.foreignObligations).toEqual([
    expect.objectContaining({
      id: item.id,
      originalCurrency: "USD",
      remainingOriginalMinor: "10000",
      inclusion: "blocked",
    }),
  ]);
  expect(basis.companyCoverage).toBe("incomplete");
  expect(basis.coverage.find((entry) => entry.family === "commerce")?.status).not.toBe("qualified");
  expect(JSON.stringify(basis)).not.toContain("employeeId");
  expect(JSON.stringify(basis)).not.toContain("salaryMinor");
}, 120000);

test("P10 keeps a same-day allocated residual blocked when the selected closing lacks its payment witness", async () => {
  const context = await world();
  const { invoice, source } = await retainedInvoice(context);
  const draft = journal(source.id, "300");
  const sourcePayment = await evidence(context.book);

  const plan = await post(
    context.book,
    "/change-sets",
    {
      ...draft,
      evidenceId: sourcePayment.id,
      postingDate: context.today,
      lines: [
        { accountId: "account_bank", debitMinor: "300", creditMinor: "0", description: "Receipt" },
        {
          accountId: "account_ar",
          debitMinor: "0",
          creditMinor: "300",
          description: "Receivable settlement",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const posted = await execute(context.book, plan);

  const payment = plan.groups[0]?.actions[0]?.lines.find(
    (entry) => entry.accountId === "account_ar",
  );

  if (!payment) throw new Error("Payment needs its retained control line");

  const allocation = await post(
    context.book,
    "/commerce/allocation-plans",
    {
      voucherId: posted.voucherId,
      lineId: payment.lineId,
      evidenceId: sourcePayment.id,
      rationale: "Independent same-day300 partial allocation",
      allocations: [{ invoiceId: invoice.id, amountMinor: "300" }],
    },
    Commerce.AllocationPlan,
  );

  const approval = await post(
    context.book,
    `/commerce/allocation-plans/${allocation.id}/approvals`,
    { version: 1, planDigest: allocation.digest },
    Commerce.AllocationApproval,
  );

  const allocationReceipt = await post(
    context.book,
    `/commerce/allocation-plans/${allocation.id}/apply`,
    { version: 1, planDigest: allocation.digest, approvalId: approval.id },
    Commerce.AllocationReceipt,
  );

  const owner = await decoded(
    await request(context.book, `/commerce/invoices/${invoice.id}`),
    Commerce.Invoice,
  );

  expect(owner.outstandingMinor).toBe("700");
  const basis = await capture(context);
  expect(basis.opening.status).toBe("unavailable");
  expect(basis.opening.totalMinor).toBeNull();
  expect(basis.contributions).toEqual([
    expect.objectContaining({ invoiceId: invoice.id, amountMinor: "700", inclusion: "blocked" }),
  ]);
  expect(basis.opening.blockers.length).toBeGreaterThan(0);
  const before = await decoded(await request(context.book, `/cash-bases/${basis.id}`), View);

  const reversal = await post(
    context.book,
    "/commerce/allocation-reversal-plans",
    {
      receiptId: allocationReceipt.id,
      reason: "Independent release of the300 partial allocation",
    },
    Reversals.CommerceAllocationReversalPlan,
  );

  const reversalApproval = await post(
    context.book,
    `/commerce/allocation-reversal-plans/${reversal.id}/approve`,
    { version: 1, digest: reversal.digest },
    Reversals.CommerceAllocationReversalApproval,
  );

  await post(
    context.book,
    `/commerce/allocation-reversal-plans/${reversal.id}/execute`,
    { version: 1, digest: reversal.digest, approvalId: reversalApproval.id },
    Reversals.CommerceAllocationReversalExecution,
  );
  const restored = await capture(context);
  expect(restored.contributions).toEqual([
    expect.objectContaining({ invoiceId: invoice.id, amountMinor: "1000", inclusion: "included" }),
  ]);
  const after = await decoded(await request(context.book, `/cash-bases/${basis.id}`), View);
  expect(after.artifact.content).toBe(before.artifact.content);
  expect(after.dependenciesCurrent).toBe(false);
}, 120000);

test("P10 never treats a restricted account review or unavailable balance as selected opening cash", async () => {
  const context = await world();

  for (const eligibility of ["private", "restricted", "tax_account", "unused_credit", "unknown"]) {
    const response = await request(context.book, "/cash-bases", {
      method: "POST",
      body: JSON.stringify({
        ...context.input,
        accounts: context.input.accounts.map((entry, index) =>
          index === 0 ? { ...entry, review: { ...entry.review, eligibility } } : entry,
        ),
      }),
    });

    const basis = await decoded(response, Snapshot);
    expect(basis.opening.status).toBe("unavailable");
    expect(basis.opening.totalMinor).toBeNull();
    expect(basis.opening.blockers.length).toBeGreaterThan(0);
  }

  const response = await request(context.book, "/cash-bases", {
    method: "POST",
    body: JSON.stringify({
      ...context.input,
      accounts: context.input.accounts.map((entry, index) =>
        index === 0 ? { ...entry, review: { ...entry.review, balanceType: "available" } } : entry,
      ),
    }),
  });

  const unavailable = await decoded(response, Snapshot);
  expect(unavailable.opening.status).toBe("unavailable");
  expect(unavailable.opening.totalMinor).toBeNull();
}, 120000);

test("P10 proves same-day cash settlement membership and reads partial payment plus credit once", async () => {
  const cash = await cashFixture();
  const admin = await database();
  let today: string;
  let yesterday: string;

  try {
    await admin.query(
      "insert into openerp.accounts(book_id,id,code,name) values($1,'account_bank_two','1931','Synthetic second bank')",
      [cash.book.bookId],
    );

    const clock = await admin.query<{ today: string; yesterday: string }>(
      "select (clock_timestamp() at time zone 'Europe/Stockholm')::date::text as today, ((clock_timestamp() at time zone 'Europe/Stockholm')::date-1)::text as yesterday",
    );

    const date = clock.rows[0];

    if (!date) throw new Error("Current synthetic fixture needs DB clock");
    today = date.today;
    yesterday = date.yesterday;
  } finally {
    await admin.end();
  }

  for (const [accountId, amount] of [
    ["account_bank", "100000"],
    ["account_bank_two", "50000"],
  ]) {
    if (!accountId || !amount) throw new Error("Missing independently specified bank funding");
    const source = await evidence(cash.book);
    const original = journal(source.id, amount);

    const funding = await post(
      cash.book,
      "/change-sets",
      {
        ...original,
        postingDate: yesterday,
        lines: original.lines.map((line) => ({
          ...line,
          accountId: line.accountId === "account_bank" ? accountId : line.accountId,
        })),
      },
      Accounting.ChangeSet,
    );

    await execute(cash.book, funding);
  }

  const payment = await postedCash(cash.book, {
    date: today,
    dailyStatement: true,
    openingMinor: "100000",
    amountMinor: "50000",
  });

  const allocation = await allocateCash(cash, payment, "50000");

  const approved = await post(
    cash.reviewer,
    `/commerce/allocation-plans/${allocation.id}/approvals`,
    { version: 1, planDigest: allocation.digest },
    Commerce.AllocationApproval,
  );

  await post(
    cash.book,
    `/commerce/allocation-plans/${allocation.id}/apply`,
    { version: 1, planDigest: allocation.digest, approvalId: approved.id },
    Commerce.AllocationReceipt,
  );

  const source = await post(
    cash.book,
    "/evidence",
    {
      title: "Independent unpaid suffix credit25000",
      content: "Original125000 less paid50000 less unpaid credit25000 leaves50000",
      mediaType: "text/plain",
      origin: "P10 literal expected residual",
    },
    Accounting.Evidence,
  );

  const originalLine = cash.draft.content.lines[0];

  if (!originalLine) throw new Error("Original cash source line missing");

  const creditDraft = await createDraft(cash.book, {
    ...cash.draft.content,
    sourceEvidenceId: source.id,
    supplierDocumentNumber: key(),
    documentDate: today,
    supplyDate: today,
    dueDate: today,
    sourceTotalMinor: "25000",
    supplier: { ...cash.draft.content.supplier, evidenceId: source.id },
    buyer: { ...cash.draft.content.buyer, evidenceId: source.id },
    lines: [
      {
        ...originalLine,
        id: "credit_line",
        baseMinor: "20000",
        unitPriceMinor: "20000",
        taxMinor: "5000",
        sourceGrossMinor: "25000",
        taxEvidenceId: source.id,
      },
    ],
  });

  const basis = Schema.decodeUnknownSync(Cash.CashInvoiceBasis)(cash.invoice.cashMethod);
  const treatment = basis.lines[0]?.treatment;

  if (!treatment) throw new Error("Credit requires retained original treatment");

  const credit = await post(
    cash.book,
    "/commerce/cash-method/credits",
    {
      invoiceId: cash.invoice.id,
      draftId: creditDraft.id,
      expectedRevision: creditDraft.revision,
      expectedDigest: creditDraft.digest,
      accountingPeriodId: "period_2026",
      series: "A",
      lineMappings: [{ creditLineId: "credit_line", sourceLineId: originalLine.id, treatment }],
      rationale: "Credit the independently specified unpaid suffix",
    },
    Cash.CashCreditPlan,
  );

  const creditApproval = await post(
    cash.reviewer,
    `/commerce/cash-method/credits/${credit.id}/approvals`,
    { planDigest: credit.digest },
    Cash.CashCreditApproval,
  );

  await post(
    cash.book,
    `/commerce/cash-method/credits/${credit.id}/execute`,
    { planDigest: credit.digest, approvalId: creditApproval.id },
    Cash.CashCreditReceipt,
  );

  const secondStatement = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "cash_second_bank",
    accountId: "account_bank_two",
    currency: "SEK",
    startsOn: today,
    endsOn: today,
    openingMinor: "50000",
    closingMinor: "50000",
    completeness: {
      declaredComplete: true,
      basis: "Independently specified synthetic idle daily statement",
    },
    rows: [],
  };

  const secondSource = await post(
    cash.book,
    "/evidence",
    {
      title: "Synthetic second daily close",
      content: JSON.stringify(secondStatement),
      mediaType: "application/json",
      origin: "P10 synthetic source",
    },
    Accounting.Evidence,
  );

  await post(
    cash.book,
    "/bank-statements",
    { ...secondStatement, evidenceId: secondSource.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );
  const refs = [];

  for (const accountId of ["account_bank", "account_bank_two"]) {
    const report = await post(
      cash.book,
      "/bank-capacity-reconciliations",
      {
        accountId,
        startsOn: today,
        endsOn: today,
      },
      Settlement.BankCapacityReconciliation,
    );

    expect(report.status).toBe("complete");
    expect(report.bankClosingMinor).toBe("50000");
    refs.push({ accountId, reconciliationId: report.id });
  }

  const selected = await qualifiedInput(cash.book, today, refs);
  const result = await capture({ book: cash.book, today, yesterday, ...selected });
  expect(result.opening.status).toBe("qualified");
  expect(result.opening.totalMinor).toBe("100000");
  expect(result.contributions).toEqual([
    expect.objectContaining({
      invoiceId: cash.invoice.id,
      amountMinor: "50000",
      inclusion: "included",
    }),
  ]);

  const retained = await decoded(
    await request(cash.book, `/commerce/invoices/${cash.invoice.id}`),
    Commerce.Invoice,
  );

  expect(retained.recordedAllocatedMinor).toBe("50000");
  expect(retained.creditedMinor).toBe("25000");
  expect(retained.outstandingMinor).toBe("50000");
  await writeFile(
    join(environment().artifacts, "cash-basis-same-day-credit.json"),
    JSON.stringify(
      {
        independentOpeningMinor: "100000",
        originalMinor: "125000",
        paidMinor: "50000",
        creditMinor: "25000",
        expectedResidualMinor: "50000",
        paymentStatementId: payment.statementId,
        result,
        noRepeatedPayment: true,
      },
      null,
      2,
    ),
  );
}, 120000);

async function invoicePopulation(context: Awaited<ReturnType<typeof world>>, total: number) {
  const { invoice, source } = await retainedInvoice(context);
  const admin = await database();

  try {
    for (let offset = 1; offset < total; offset += 250) {
      const count = Math.min(250, total - offset);
      const original = journal(source.id, "1000");

      const plan = await post(
        context.book,
        "/change-sets",
        {
          ...original,
          postingDate: context.today,
          description: "Independent population receivable recognition",
          lines: Array.from({ length: count }).flatMap(() => [
            {
              accountId: "account_ar",
              debitMinor: "1000",
              creditMinor: "0",
              description: "Synthetic invoice1000",
            },
            {
              accountId: "account_revenue",
              debitMinor: "0",
              creditMinor: "1000",
              description: "Synthetic revenue1000",
            },
          ]),
        },
        Accounting.ChangeSet,
      );

      const posted = await execute(context.book, plan);

      const lines = plan.groups[0]?.actions[0]?.lines.filter(
        (line) => line.accountId === "account_ar",
      );

      if (!lines || lines.length !== count)
        throw new Error("Population requires independently posted distinct receivable lines");

      const references = lines.map((line, ordinal) => ({
        id: `cash_population_${offset + ordinal}`,
        lineId: line.lineId,
      }));

      await admin.query(
        `
        with sources as (select * from jsonb_to_recordset($4::jsonb) as p(id text, "lineId" text)),
        added as (
          insert into openerp.commerce_invoices
            (book_id,id,direction,counterparty_id,counterparty_revision,document_number,issued_on,
             amount_minor,control_account_id,recognition_voucher_id,recognition_line_id,evidence_id,current_revision,body)
          select original.book_id,p.id,original.direction,original.counterparty_id,original.counterparty_revision,
            p.id,original.issued_on,1000,original.control_account_id,$3,p."lineId",original.evidence_id,1,
            original.body || jsonb_build_object('id',p.id,'documentNumber',p.id,
              'recognition', original.body->'recognition' || jsonb_build_object('voucherId',$3::text,'lineId',p."lineId",'eventId',v.event_id,'postingDate',v.posting_date::text))
          from openerp.commerce_invoices original cross join sources p
          join openerp.vouchers v on v.book_id=$1 and v.id=$3
          where original.book_id=$1 and original.id=$2 returning book_id,id,evidence_id
        )
        insert into openerp.commerce_invoice_revisions(book_id,invoice_id,revision,evidence_id,body)
        select added.book_id,added.id,1,added.evidence_id,
          revision.body || jsonb_build_object('id',added.id)
        from added join openerp.commerce_invoice_revisions revision
          on revision.book_id=added.book_id and revision.invoice_id=$2 and revision.revision=1
      `,
        [context.book.bookId, invoice.id, posted.voucherId, JSON.stringify(references)],
      );
    }

    await admin.query("ANALYZE openerp.commerce_invoices");
    await admin.query("ANALYZE openerp.commerce_invoice_revisions");
  } finally {
    await admin.end();
  }

  const selected = await qualifiedInput(
    context.book,
    context.today,
    context.input.accounts.map(({ accountId, reconciliationId }) => ({
      accountId,
      reconciliationId,
    })),
  );

  context.input = selected.input;
}

test.skipIf(process.env.P10_PERFORMANCE !== "1")(
  "P10 captures ten thousand unpaid canonical invoices within the ordinary budget",
  async () => {
    const context = await world();
    await invoicePopulation(context, 10000);
    const durations: number[] = [];
    const sharedReadMs: number[] = [];
    let lastId = "";

    for (let trial = 0; trial < 35; trial++) {
      const started = performance.now();
      const basis = await capture(context);
      const duration = performance.now() - started;
      expect(basis.opening.totalMinor).toBe("150000");
      expect(basis.contributions).toHaveLength(10000);
      expect(
        basis.contributions.every(
          (entry) => entry.amountMinor === "1000" && entry.inclusion === "included",
        ),
      ).toBe(true);
      expect(
        basis.contributions.reduce((total, entry) => total + BigInt(entry.amountMinor ?? "0"), 0n),
      ).toBe(10000000n);
      lastId = basis.id;
      const readStart = performance.now();

      const page = await decoded(
        await request(context.book, "/commerce/invoices"),
        Commerce.InvoicePage,
      );

      expect(page.items).toHaveLength(50);
      expect(page.next).not.toBeNull();

      if (trial >= 5) {
        durations.push(duration);
        sharedReadMs.push(performance.now() - readStart);
      }
    }

    const p95 = durations.toSorted((a, b) => a - b)[28];
    expect(p95).toBeDefined();
    expect(p95).toBeLessThanOrEqual(3000);
    await writeFile(
      join(environment().artifacts, "cash-basis-performance.json"),
      JSON.stringify(
        {
          population: 10000,
          originalMinorPerInvoice: "1000",
          independentRemainingTotalMinor: "10000000",
          warmups: 5,
          trials: 30,
          captureMs: durations,
          p95Ms: p95,
          captureBudgetMs: 3000,
          sharedReadMs,
          populationBasis:
            "Synthetic retained registration fixtures reference distinct public posted1000 receivable lines. No production source is the expected amount oracle.",
        },
        null,
        2,
      ),
    );
    const extra = await retainedInvoice(context);
    expect(extra.invoice.outstandingMinor).toBe("1000");
    await failure(
      await request(context.book, "/cash-bases", {
        method: "POST",
        body: JSON.stringify(context.input),
      }),
      422,
      "UnsupportedProfile",
    );

    const immutable = await decoded(
      await request(context.book, `/cash-bases/${lastId}`),
      Schema.Struct({
        ...View.fields,
        dependencyStatus: Schema.Literal("unavailable"),
        dependencyReason: Schema.String,
      }),
    );

    expect(immutable.dependenciesCurrent).toBe(false);
    expect(immutable.basis.contributions).toHaveLength(10000);
    const exported = await request(context.book, `/cash-bases/${lastId}/export`);
    expect(exported.status).toBe(200);
    expect(await exported.text()).toBe(immutable.artifact.content);
  },
  600000,
);

test.skipIf(process.env.P10_SHARED_BASELINE !== "1")(
  "P10 measures the parent comparable canonical invoice page",
  async () => {
    const context = await world();
    await invoicePopulation(context, 10000);
    const durationsMs: number[] = [];

    for (let trial = 0; trial < 35; trial++) {
      const started = performance.now();

      const page = await decoded(
        await request(context.book, "/commerce/invoices"),
        Commerce.InvoicePage,
      );

      expect(page.items).toHaveLength(50);
      expect(page.next).not.toBeNull();
      expect(page.items.every((invoice) => invoice.outstandingMinor === "1000")).toBe(true);

      if (trial >= 5) durationsMs.push(performance.now() - started);
    }

    await writeFile(
      join(environment().artifacts, "cash-basis-parent-shared-read.json"),
      JSON.stringify(
        {
          population: 10000,
          warmups: 5,
          trials: 30,
          durationsMs,
          p95Ms: durationsMs.toSorted((a, b) => a - b)[28],
          fixture: "same independently specified1000 receivable population",
        },
        null,
        2,
      ),
    );
  },
  600000,
);

test("P10 retains reviewed expected dates separately from unchanged contractual due dates", async () => {
  const context = await world();
  const { invoice, source } = await retainedInvoice(context);

  const assumption = await post(
    context.book,
    "/evidence",
    {
      title: "Synthetic payment expectation review",
      content: "Independent reviewed expected date2026-12-15; contractual due date unchanged.",
      mediaType: "text/plain",
      origin: "P10 explicit assumption, not payment outcome",
    },
    Accounting.Evidence,
  );

  const selected = await qualifiedInput(
    context.book,
    context.today,
    context.input.accounts.map(({ accountId, reconciliationId }) => ({
      accountId,
      reconciliationId,
    })),
  );

  const input = {
    ...selected.input,
    expectedDates: [
      {
        invoiceId: invoice.id,
        expectedOn: "2026-12-15",
        review: {
          evidenceId: assumption.id,
          sha256: assumption.sha256,
          reason: "Independent expected payment assumption",
        },
      },
    ],
  };

  const saved = await decoded(
    await request(context.book, "/cash-bases", { method: "POST", body: JSON.stringify(input) }),
    Schema.Struct({ ...Snapshot.fields, input: Schema.JsonObject }),
  );

  expect(saved.contributions).toEqual([
    expect.objectContaining({
      invoiceId: invoice.id,
      dueOn: invoice.currentRevision.dueOn,
      expectedOn: "2026-12-15",
      amountMinor: "1000",
    }),
  ]);
  expect(saved.input).toEqual(input);

  const current = await decoded(
    await request(context.book, `/commerce/invoices/${invoice.id}`),
    Commerce.Invoice,
  );

  expect(current.currentRevision.dueOn).toBe(context.today);
  expect(current.currentRevision.evidence.evidenceId).toBe(source.id);

  const invalidDate = {
    ...input,
    expectedDates: input.expectedDates.map((entry) => ({ ...entry, expectedOn: "2026-13-15" })),
  };

  const invalidDateResponse = await request(context.book, "/cash-bases", {
    method: "POST",
    body: JSON.stringify(invalidDate),
  });

  expect(invalidDateResponse.status).toBe(400);

  const mismatch = {
    ...input,
    expectedDates: [
      {
        ...input.expectedDates[0],
        review: { ...input.expectedDates[0]?.review, sha256: "0".repeat(64) },
      },
    ],
  };

  await failure(
    await request(context.book, "/cash-bases", { method: "POST", body: JSON.stringify(mismatch) }),
    409,
    "StaleDependency",
  );
}, 120000);

test("P10 qualifies an actual supplier settlement receipt and preserves cancellation knowledge", async () => {
  const context = await world();
  const data = await supplierOpeningFixture(context.today);

  const plan = await post(
    data.book,
    "/purchases/supplier-settlement-plans",
    data.input,
    SupplierSettlement.SupplierSettlementPlan,
  );

  const approval = await post(
    data.reviewer,
    `/purchases/supplier-settlement-plans/${plan.id}/approvals`,
    { version: 1, digest: plan.digest },
    SupplierSettlement.SupplierSettlementApproval,
  );

  const receipt = await post(
    data.book,
    `/purchases/supplier-settlement-plans/${plan.id}/execute`,
    { version: 1, digest: plan.digest, approvalId: approval.id },
    SupplierSettlement.SupplierSettlementReceipt,
  );

  const reconciliation = await post(
    data.book,
    "/bank-capacity-reconciliations",
    {
      accountId: "account_bank",
      startsOn: context.today,
      endsOn: context.today,
    },
    Settlement.BankCapacityReconciliation,
  );

  expect(reconciliation.status).toBe("complete");
  expect(reconciliation.bankClosingMinor).toBe("96000");

  const selected = await qualifiedInput(data.book, context.today, [
    { accountId: "account_bank", reconciliationId: reconciliation.id },
  ]);

  const basis = await capture({
    book: data.book,
    today: context.today,
    yesterday: context.yesterday,
    ...selected,
  });

  expect(basis.opening.totalMinor).toBe("96000");
  expect(basis.contributions).toEqual([
    expect.objectContaining({
      invoiceId: data.acceptance.registerInvoiceId,
      amountMinor: "6000",
      inclusion: "included",
    }),
  ]);
  const initial = await decoded(await request(data.book, `/cash-bases/${basis.id}`), View);

  const provenance = Schema.decodeSync(Schema.fromJsonString(Schema.Struct({
    contributions: Schema.Array(Schema.Struct({
      invoiceId: Schema.String,
      paymentMembership: Schema.Array(Schema.Struct({
        sourceOwner: Schema.NullOr(Schema.String),
        sourceId: Schema.NullOr(Schema.String),
      })),
    })),
  })))(initial.artifact.content);

  await writeFile(
    join(environment().artifacts, "cash-basis-supplier-provenance.json"),
    JSON.stringify({ supplierReceiptId: receipt.id, expectedSourceOwner: "purchases/supplier-settlements", provenance }, null, 2),
  );

  expect(provenance.contributions).toEqual([
    {
      invoiceId: data.acceptance.registerInvoiceId,
      paymentMembership: [{ sourceOwner: "purchases/supplier-settlements", sourceId: receipt.id }],
    },
  ]);

  const cancellation = await post(
    data.book,
    "/purchases/supplier-settlement-cancellation-plans",
    {
      settlementReceiptId: receipt.id,
      reason: "Independent cancellation keeps original bank movement unresolved",
      evidence: { evidenceId: data.bankEvidence.id, sha256: data.bankEvidence.sha256 },
      correction: {
        accountingPeriodId: "period_2026",
        postingDate: context.today,
      },
    },
    SupplierSettlement.SupplierSettlementCancellationPlan,
  );

  const inverseApproval = await post(
    data.reviewer,
    `/purchases/supplier-settlement-cancellation-plans/${cancellation.id}/approvals`,
    { version: 1, digest: cancellation.digest },
    SupplierSettlement.SupplierSettlementCancellationApproval,
  );

  await post(
    data.book,
    `/purchases/supplier-settlement-cancellation-plans/${cancellation.id}/execute`,
    { version: 1, digest: cancellation.digest, approvalId: inverseApproval.id },
    SupplierSettlement.SupplierSettlementCancellationReceipt,
  );

  const later = await capture({
    book: data.book,
    today: context.today,
    yesterday: context.yesterday,
    ...selected,
  });

  expect(later.opening.status).toBe("unavailable");
  expect(later.contributions).toEqual([
    expect.objectContaining({
      invoiceId: data.acceptance.registerInvoiceId,
      amountMinor: "10000",
      inclusion: "included",
    }),
  ]);
  const old = await decoded(await request(data.book, `/cash-bases/${basis.id}`), View);
  expect(old.artifact.content).toBe(initial.artifact.content);
  expect(old.dependenciesCurrent).toBe(false);
  await writeFile(
    join(environment().artifacts, "cash-basis-supplier-settlement.json"),
    JSON.stringify(
      {
        originalMinor: "10000",
        paymentMinor: "4000",
        expectedRemainingMinor: "6000",
        expectedOpeningMinor: "96000",
        receiptId: receipt.id,
        basis,
        later,
        oldBytesUnchanged: true,
      },
      null,
      2,
    ),
  );
}, 120000);

test("P10 preserves canonical unknown from retained historical recognition and refuses generic correction", async () => {
  const context = await world();
  const { invoice } = await retainedInvoice(context);

  if (!invoice.recognition) throw new Error("Fixture requires the actual original recognition");

  const protectedCorrection = await post(
    context.book,
    `/vouchers/${invoice.recognition.voucherId}/correction-proposals`,
    {
      accountingPeriodId: "period_2026",
      postingDate: context.today,
      rationale: "Registered recognition must keep its commerce owner",
    },
    Accounting.ChangeSet,
  );

  const protectedApproval = await post(
    context.book,
    `/change-sets/${protectedCorrection.id}/approvals`,
    { version: 1, planDigest: protectedCorrection.planDigest },
    Accounting.Approval,
  );

  const protectedState = await persisted(context.book);

  await failure(
    await request(context.book, `/change-sets/${protectedCorrection.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        planDigest: protectedCorrection.planDigest,
        approvalId: protectedApproval.id,
      }),
    }),
    422,
    "UnsupportedProfile",
  );

  expect(await persisted(context.book)).toEqual(protectedState);

  const source = await evidence(context.book);

  const original = await post(
    context.book,
    "/change-sets",
    {
      ...journal(source.id, "1000"),
      postingDate: context.today,
      lines: [
        {
          accountId: "account_ar",
          debitMinor: "1000",
          creditMinor: "0",
          description: "Historical receivable before discovery",
        },
        {
          accountId: "account_revenue",
          debitMinor: "0",
          creditMinor: "1000",
          description: "Historical revenue before discovery",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const originalReceipt = await execute(context.book, original);

  const recognitionLine = original.groups[0]?.actions[0]?.lines.find(
    (line) => line.accountId === "account_ar",
  );

  if (!recognitionLine) throw new Error("Historical fixture requires an actual receivable line");

  const correction = await post(
    context.book,
    `/vouchers/${originalReceipt.voucherId}/correction-proposals`,
    {
      accountingPeriodId: "period_2026",
      postingDate: context.today,
      rationale: "Real correction before retained historical discovery",
    },
    Accounting.ChangeSet,
  );

  const correctionReceipt = await execute(context.book, correction);

  const historicalId = `historical_${key()}`;

  const admin = await database();

  try {
    await admin.query(
      `
      with added as (
        insert into openerp.commerce_invoices
          (book_id,id,direction,counterparty_id,counterparty_revision,document_number,issued_on,
           amount_minor,control_account_id,recognition_voucher_id,recognition_line_id,evidence_id,current_revision,body)
        select i.book_id,$5,i.direction,i.counterparty_id,i.counterparty_revision,$5,i.issued_on,
          1000,i.control_account_id,v.id,$4,$6,1,
          i.body || jsonb_build_object('id',$5::text,'documentNumber',$5::text,
            'evidence',jsonb_build_object('evidenceId',$6::text,'sha256',$7::text),
            'recognition',i.body->'recognition' || jsonb_build_object('voucherId',v.id,'lineId',$4::text,'eventId',v.event_id,'postingDate',v.posting_date::text))
        from openerp.commerce_invoices i
        join openerp.vouchers v on v.book_id=i.book_id and v.id=$3
        join openerp.journal_lines l on l.book_id=v.book_id and l.voucher_id=v.id and l.id=$4
        join openerp.vouchers reversed on reversed.book_id=v.book_id and reversed.corrects_voucher_id=v.id and reversed.id=$8 and reversed.posting_purpose='reversal'
        where i.book_id=$1 and i.id=$2 and l.debit_minor=1000 and l.credit_minor=0
        returning book_id,id,evidence_id
      )
      insert into openerp.commerce_invoice_revisions(book_id,invoice_id,revision,evidence_id,body)
      select a.book_id,a.id,1,a.evidence_id,r.body || jsonb_build_object('id',a.id,
        'evidence',jsonb_build_object('evidenceId',$6::text,'sha256',$7::text))
      from added a join openerp.commerce_invoice_revisions r
        on r.book_id=a.book_id and r.invoice_id=$2 and r.revision=1
    `,
      [
        context.book.bookId,
        invoice.id,
        originalReceipt.voucherId,
        recognitionLine.lineId,
        historicalId,
        source.id,
        source.sha256,
        correctionReceipt.voucherId,
      ],
    );
  } finally {
    await admin.end();
  }

  const owner = await decoded(
    await request(context.book, `/commerce/invoices/${historicalId}`),
    Commerce.Invoice,
  );

  expect(owner.status).toBe("blocked");
  expect(owner.outstandingMinor).toBeNull();

  const basis = await capture(context);

  expect(basis.contributions).toContainEqual(
    expect.objectContaining({
      invoiceId: historicalId,
      amountMinor: null,
      inclusion: "blocked",
      reason: "canonical_residual_unknown",
    }),
  );

  expect(basis.companyCoverage).toBe("incomplete");

  await writeFile(
    join(environment().artifacts, "cash-basis-unknown-residual.json"),
    JSON.stringify(
      {
        sourceBoundary:
          "Disposable retained historical SQL fixture; not current registration admission or correction workflow",
        originalMinor: "1000",
        originalReceipt,
        correctionReceipt,
        recognitionLineId: recognitionLine.lineId,
        historicalId,
        genericRegisteredCorrectionRefused: true,
        expectedResidual: "unknown",
        owner,
        basis,
      },
      null,
      2,
    ),
  );
}, 120000);

test.each(["commerce_invoices", "bank_observations"])(
  "P10 preserves saved bytes when native source SELECT is unavailable %s",
  async (table) => {
    const context = await world();
    const basis = await capture(context);
    const original = await decoded(await request(context.book, `/cash-bases/${basis.id}`), View);
    const admin = await database();

    try {
      await admin.query(`REVOKE SELECT ON openerp.${table} FROM openerp_runtime`);

      const response = await request(context.book, `/cash-bases/${basis.id}`);
      const body = await response.text();

      await writeFile(
        join(environment().artifacts, `cash-basis-source-grant-${table}.json`),
        JSON.stringify(
          {
            table,
            basisId: basis.id,
            status: response.status,
            body,
            originalSha256: original.artifact.sha256,
          },
          null,
          2,
        ),
      );

      expect(response.status).toBe(200);

      const retained = Schema.decodeSync(
        Schema.fromJsonString(
          Schema.Struct({
            ...View.fields,
            dependencyStatus: Schema.String,
            dependencyReason: Schema.NullOr(Schema.String),
          }),
        ),
      )(body);

      expect(retained.dependenciesCurrent).toBe(false);
      expect(retained.dependencyStatus).toBe("unavailable");
      expect(retained.dependencyReason).toBe("UnsupportedProfile");
      expect(retained.artifact).toEqual(original.artifact);
      expect(retained.basis).toEqual(original.basis);

      const exported = await request(context.book, `/cash-bases/${basis.id}/export`);

      expect(exported.status).toBe(200);
      expect(await exported.text()).toBe(original.artifact.content);

      await failure(
        await request(context.book, "/cash-bases", {
          method: "POST",
          body: JSON.stringify(context.input),
        }),
        422,
        "UnsupportedProfile",
      );
    } finally {
      await admin.query(`GRANT SELECT ON openerp.${table} TO openerp_runtime`);
      await admin.end();
    }
  },
  120000,
);

test("P10 freezes body digest integrity independently of its artifact byte hash", async () => {
  const context = await world();
  const basis = await capture(context);
  const admin = await database();

  try {
    const canonical = await admin.query<{ app: string; database: string; equal: boolean }>(
      "select body->>'digest' as app, openerp.digest(body-'digest') as database, body->>'digest'=openerp.digest(body-'digest') as equal from openerp.cash_bases where book_id=$1 and id=$2",
      [context.book.bookId, basis.id],
    );

    expect(canonical.rows).toEqual([{ app: basis.digest, database: basis.digest, equal: true }]);

    await expect(
      admin.query("update openerp.cash_bases set id=id where book_id=$1 and id=$2", [
        context.book.bookId,
        basis.id,
      ]),
    ).rejects.toMatchObject({ code: "P0001", detail: "Forbidden" });

    await expect(
      admin.query("delete from openerp.cash_bases where book_id=$1 and id=$2", [
        context.book.bookId,
        basis.id,
      ]),
    ).rejects.toMatchObject({ code: "P0001", detail: "Forbidden" });

    const tampered = await admin
      .query(
        `
      with changed as (
        select body || jsonb_build_object('id','cash_tampered_digest','digest','sha256:' || repeat('0',64)) as body
        from openerp.cash_bases where book_id=$1 and id=$2
      ), rendered as (select body, openerp.canonical(body) as content from changed)
      insert into openerp.cash_bases(book_id,id,body,content,sha256,byte_length)
      select $1,'cash_tampered_digest',body,content,encode(sha256(convert_to(content,'UTF8')),'hex'),octet_length(content)
      from rendered
    `,
        [context.book.bookId, basis.id],
      )
      .then(
        () => null,
        (cause: unknown) =>
          Schema.decodeUnknownSync(
            Schema.Struct({ code: Schema.String, constraint: Schema.String }),
          )(cause),
      );

    await writeFile(
      join(environment().artifacts, "cash-basis-digest-integrity.json"),
      JSON.stringify(
        {
          canonicalEquality: canonical.rows,
          immutableUpdateAndDelete: true,
          tampered,
          candidate: "body.digest = openerp.digest(body - digest)",
        },
        null,
        2,
      ),
    );
    expect(tampered?.code).toBe("23514");
  } finally {
    await admin.end();
  }
}, 120000);
