// Seeds the canonical customers and customer invoices (spec section 2) into the disposable book.
// Everything goes through real API owners. The only raw SQL is labelled "FIXTURE-ONLY SQL":
// the four ledger accounts the invoice journals need (no API creates accounts).
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";

const sessionFile = resolve(process.argv[2] ?? "");

if (
  basename(sessionFile) !== "session.json" ||
  !basename(dirname(sessionFile)).startsWith("openerp-paper-")
)
  throw new Error("Use the private session file produced by the Paper launcher");

const session = JSON.parse(await readFile(sessionFile, "utf8"));

const origin = new URL(session.apiUrl);

if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:")
  throw new Error("Only the disposable local Worker is allowed");

const scope = "/api/v1/entities/entity_synthetic/books/book_synthetic";

const log = [];

const signIn = await fetch(`${session.url}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: session.url },
  body: JSON.stringify({ email: session.email, password: session.password }),
  signal: AbortSignal.timeout(15_000),
});

if (!signIn.ok) throw new Error(`Synthetic operator sign-in failed: ${signIn.status}`);

const cookie = signIn.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ");

if (!cookie) throw new Error("Synthetic operator sign-in did not retain a session");

async function call(path, input) {
  const headers = { cookie, origin: session.url };

  if (input) {
    headers["content-type"] = "application/json";
    headers["idempotency-key"] = randomUUID();
  }

  const response = await fetch(`${session.url}${scope}${path}`, {
    method: input ? "POST" : "GET",
    headers,
    body: input ? JSON.stringify(input) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const result = await response.json();

  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);

  return result;
}

// FIXTURE-ONLY SQL: ledger accounts. Located through the scratch Postgres of this session.
const scratch = dirname(sessionFile);

const pid = (await readFile(join(scratch, "pgdata/postmaster.pid"), "utf8")).split("\n");

const port = Number(pid[3]);

const password = (await readFile(join(scratch, "pg-password"), "utf8")).trim();

const { Client } = createRequire(join(import.meta.dirname, "../../apps/api/package.json"))("pg");

const admin = new Client({
  connectionString: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
});

await admin.connect();

const accounts = [
  ["account_receivable", "1510", "Kundfordringar"],
  ["account_vat", "2611", "Utgående moms 25 %"],
  ["account_revenue", "3041", "Försäljning tjänster"],
  ["account_liability", "2890", "Övriga kortfristiga skulder"],
];

for (const [id, code, name] of accounts)
  await admin.query(
    "INSERT INTO openerp.accounts(book_id, id, code, name) VALUES ('book_synthetic', $1, $2, $3) ON CONFLICT DO NOTHING",
    [id, code, name],
  );

await admin.end();

log.push({ fixtureOnlySql: "accounts 1510, 2611, 3041, 2890 inserted into openerp.accounts" });

const evidence = await call("/evidence", {
  title: "Paper visual fixture, customer invoices",
  content: "Disposable synthetic customer invoices for local UI verification.",
  mediaType: "text/plain",
  origin: "Paper product implementation verification",
});

const customerNames = [
  "Björkdalen Skogsförvaltning AB",
  "Fjällgården Fjällhotell & Konferens AB",
  "Lindqvist Bygg & Entreprenad AB",
  "Norrlands Skogs- och Lantmannaförbund ek. för.",
  "Skogsbruk Nord AB",
  "Eva Nyström",
  "Mats Ek",
  "Nordic Timber Oy",
];

const customers = {};

for (const name of customerNames)
  customers[name] = await call("/commerce/counterparties", {
    kind: "synthetic_counterparty_v1",
    externalKey: `paper_customer_${randomUUID()}`,
    role: "customer",
    displayName: name,
    evidenceId: evidence.id,
    reason: "Disposable synthetic visual fixture",
  });

const invoices = [
  [
    "F-2026-0035",
    "Björkdalen Skogsförvaltning AB",
    "1620000",
    "2026-08-28",
    "2026-09-27",
    "2026-09-12",
  ],
  ["F-2026-0036", "Skogsbruk Nord AB", "4250000", "2026-08-04", "2026-09-03", "2026-09-03"],
  [
    "F-2026-0037",
    "Lindqvist Bygg & Entreprenad AB",
    "3000000",
    "2026-08-23",
    "2026-09-22",
    "2026-09-22",
  ],
  ["F-2026-0038", "Björkdalen Skogsförvaltning AB", "1875000", "2026-08-14", "2026-09-13", null],
  [
    "F-2026-0041",
    "Fjällgården Fjällhotell & Konferens AB",
    "1620000",
    "2026-09-12",
    "2026-10-12",
    null,
  ],
  ["F-2026-0042", "Lindqvist Bygg & Entreprenad AB", "1500000", "2026-09-20", "2026-10-20", null],
  [
    "F-2026-0043",
    "Norrlands Skogs- och Lantmannaförbund ek. för.",
    "1250000",
    "2026-09-24",
    "2026-10-24",
    null,
  ],
];

const created = [];

for (const entry of invoices) {
  const [number, name, gross] = entry;
  const [issuedOn, dueOn, paid] = entry.slice(3);

  const vat = String(BigInt(gross) / 5n);
  const net = String(BigInt(gross) - BigInt(vat));

  const plan = await call("/change-sets", {
    kind: "manual_journal",
    evidenceId: evidence.id,
    eventKey: `paper_${randomUUID()}`,
    accountingPeriodId: "period_synthetic_2026",
    postingDate: issuedOn,
    series: "A",
    description: `Kundfaktura ${number}`,
    rationale: "Disposable synthetic receivable for the visual fixture",
    taxAssessment: "not_applicable",
    lines: [
      { accountId: "account_receivable", debitMinor: gross, creditMinor: "0", description: number },
      { accountId: "account_revenue", debitMinor: "0", creditMinor: net, description: number },
      { accountId: "account_vat", debitMinor: "0", creditMinor: vat, description: number },
    ],
  });

  const approval = await call(`/change-sets/${plan.id}/approvals`, {
    planDigest: plan.planDigest,
    version: plan.version,
  });

  const receipt = await call(`/change-sets/${plan.id}/execute`, {
    planDigest: plan.planDigest,
    version: plan.version,
    approvalId: approval.id,
  });

  const voucher = await call(`/vouchers/${encodeURIComponent(receipt.voucherId)}`);
  const line = voucher.action.lines.find((item) => item.accountId === "account_receivable");
  const party = customers[name];

  const invoice = await call("/commerce/invoices", {
    kind: "synthetic_invoice_v1",
    direction: "customer",
    counterpartyId: party.id,
    counterpartyRevision: party.revision,
    documentNumber: number,
    issuedOn,
    dueOn,
    currency: "SEK",
    amountMinor: gross,
    controlAccountId: "account_receivable",
    recognitionVoucherId: receipt.voucherId,
    recognitionLineId: line.id ?? line.lineId,
    evidenceId: evidence.id,
    description: `Konsultarbete ${number}`,
  });

  let paidVia = null;

  if (paid) {
    // Payment: bank debit / receivable credit posted through the change-set owner on the
    // design's payment date, then allocated to the invoice through the allocation owner.
    const payment = await call("/change-sets", {
      kind: "manual_journal",
      evidenceId: evidence.id,
      eventKey: `paper_${randomUUID()}`,
      accountingPeriodId: "period_synthetic_2026",
      postingDate: paid,
      series: "A",
      description: `Inbetalning ${number}`,
      rationale: "Disposable synthetic customer payment",
      taxAssessment: "not_applicable",
      lines: [
        { accountId: "account_bank", debitMinor: gross, creditMinor: "0", description: number },
        {
          accountId: "account_receivable",
          debitMinor: "0",
          creditMinor: gross,
          description: number,
        },
      ],
    });

    const paymentApproval = await call(`/change-sets/${payment.id}/approvals`, {
      planDigest: payment.planDigest,
      version: payment.version,
    });

    const posted = await call(`/change-sets/${payment.id}/execute`, {
      planDigest: payment.planDigest,
      version: payment.version,
      approvalId: paymentApproval.id,
    });

    const paymentVoucher = await call(`/vouchers/${encodeURIComponent(posted.voucherId)}`);

    const credit = paymentVoucher.action.lines.find(
      (item) => item.accountId === "account_receivable",
    );

    const allocation = await call("/commerce/allocation-plans", {
      voucherId: posted.voucherId,
      lineId: credit.id ?? credit.lineId,
      evidenceId: evidence.id,
      rationale: "Disposable synthetic payment allocation",
      allocations: [{ invoiceId: invoice.id, amountMinor: gross }],
    });

    const input = { version: 1, planDigest: allocation.digest };

    const allocationApproval = await call(
      `/commerce/allocation-plans/${allocation.id}/approvals`,
      input,
    );

    await call(`/commerce/allocation-plans/${allocation.id}/apply`, {
      ...input,
      approvalId: allocationApproval.id,
    });
    paidVia = `allocation, payment posted ${paid}`;
  }

  created.push({
    number,
    customer: name,
    grossMinor: gross,
    issuedOn,
    dueOn,
    id: invoice.id,
    paidVia,
  });
}

// Open draft for Skogsbruk Nord AB: 20 timmar à 1 000,00, moms 5 000,00, totalt 25 000,00.
const party = customers["Skogsbruk Nord AB"];

const identity = {
  legalName: "Fjällby Konsult AB",
  registrationId: "SYNTHETIC-ONLY",
  taxId: null,
  address: "Synthetic address",
  countryCode: "SE",
  evidenceId: evidence.id,
};

const draft = await call("/commerce/invoice-drafts", {
  draftKey: `paper_${randomUUID()}`,
  content: {
    title: "Konsultarbete",
    counterpartyId: party.id,
    counterpartyRevision: party.revision,
    seller: identity,
    customer: { ...identity, legalName: party.displayName },
    currency: "SEK",
    currencyScale: 2,
    plannedIssueDate: "2026-10-03",
    supplyDate: "2026-10-03",
    dueDate: "2026-11-02",
    paymentTerms: "30 dagar netto",
    sourceTotalMinor: "2500000",
    lines: [
      {
        id: "line_1",
        description: "Löpande rådgivning, 20 tim",
        quantity: "20",
        unitPriceMinor: "100000",
        baseMinor: "2000000",
        discountMinor: "0",
        chargeMinor: "0",
        taxMinor: "500000",
        taxDescription: "25 %",
        taxEvidenceId: evidence.id,
        sourceGrossMinor: "2500000",
      },
    ],
  },
});

log.push({ draft: { id: draft.id, customer: party.displayName } });

// Quotes. The API has only draft/accepted/cancelled, no number, no valid-until and no sent state.
const quotes = [
  ["Lindqvist Bygg & Entreprenad AB", "4000000", null],
  ["Skogsbruk Nord AB", "2500000", null],
  ["Norrlands Skogs- och Lantmannaförbund ek. för.", "1800000", "accept"],
  ["Fjällgården Fjällhotell & Konferens AB", "900000", "cancel"],
];

const salesDocuments = [];

for (const [name, net, action] of quotes) {
  const customer = customers[name];
  const vat = String(BigInt(net) / 4n);
  const gross = String(BigInt(net) + BigInt(vat));

  let doc = await call("/commerce/sales-documents", {
    kind: "quote",
    content: {
      title: "Offert, konsultarbete",
      counterpartyId: customer.id,
      counterpartyRevision: customer.revision,
      seller: identity,
      customer: { ...identity, legalName: name },
      currency: "SEK",
      currencyScale: 2,
      plannedIssueDate: "2026-09-25",
      supplyDate: "2026-10-25",
      dueDate: "2026-10-25",
      paymentTerms: "30 dagar netto",
      sourceTotalMinor: gross,
      lines: [
        {
          id: "line_1",
          description: "Konsultarbete",
          quantity: "1",
          unitPriceMinor: net,
          baseMinor: net,
          discountMinor: "0",
          chargeMinor: "0",
          taxMinor: vat,
          taxDescription: "25 %",
          taxEvidenceId: evidence.id,
          sourceGrossMinor: gross,
        },
      ],
    },
  });

  if (action)
    doc = await call(`/commerce/sales-documents/${doc.id}/transitions`, {
      expectedRevision: doc.revision,
      expectedDigest: doc.digest,
      action,
    });

  salesDocuments.push({
    kind: "quote",
    customer: name,
    netMinor: net,
    state: doc.state,
    id: doc.id,
  });
}

log.push({ salesDocuments });

const page = await call("/commerce/sales-register");

const register = page.items.map((item) => ({
  number: item.number,
  customer: item.customer,
  amountMinor: item.amountMinor,
  outstandingMinor: item.outstandingMinor,
  status: item.status,
  overdue: item.overdue,
  date: item.date,
  dueOn: item.dueOn,
}));

const artifact = join(import.meta.dirname, "../../test-results/paper/seed-sales.json");

await writeFile(
  artifact,
  JSON.stringify(
    { synthetic: true, log, created, counts: page.counts, asOf: page.asOf, register },
    null,
    2,
  ),
);

console.log(JSON.stringify({ seededSales: true, artifact, counts: page.counts, asOf: page.asOf }));
