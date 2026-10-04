import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
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

async function post(path, input) {
  const response = await fetch(`${origin.origin}${scope}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15_000),
  });

  const result = await response.json();

  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);

  return result;
}

const evidence = await post("/evidence", {
  title: "Paper visual fixture — synthetic source",
  content:
    "Disposable synthetic records for local UI verification. Not a real customer or accounting source.",
  mediaType: "text/plain",
  origin: "Paper product implementation verification",
});

const drafts = [];

// The two legacy drafts predate the canonical fixture; they stay behind a flag for old receipts.
for (const example of process.env.SEED_LEGACY_DRAFTS
  ? [
      { name: "Nordhamn Studio AB", amountMinor: "1248000" },
      { name: "Sjöstrand Design AB", amountMinor: "3250000" },
    ]
  : []) {
  const party = await post("/commerce/counterparties", {
    kind: "synthetic_counterparty_v1",
    externalKey: `paper_${randomUUID()}`,
    role: "customer",
    displayName: example.name,
    evidenceId: evidence.id,
    reason: "Disposable synthetic visual fixture",
  });

  const identity = {
    legalName: "Fjällby Konsult AB",
    registrationId: "SYNTHETIC-ONLY",
    taxId: null,
    address: "Synthetic address",
    countryCode: "SE",
    evidenceId: evidence.id,
  };

  const draft = await post("/commerce/invoice-drafts", {
    draftKey: `paper_${randomUUID()}`,
    content: {
      title: "Konsultarbete",
      counterpartyId: party.id,
      counterpartyRevision: party.revision,
      seller: identity,
      customer: { ...identity, legalName: example.name },
      currency: "SEK",
      currencyScale: 2,
      plannedIssueDate: "2026-10-03",
      supplyDate: "2026-10-03",
      dueDate: "2026-11-02",
      paymentTerms: "30 dagar netto",
      sourceTotalMinor: example.amountMinor,
      lines: [
        {
          id: "line_1",
          description: "Synthetic service",
          quantity: "1",
          unitPriceMinor: example.amountMinor,
          baseMinor: example.amountMinor,
          discountMinor: "0",
          chargeMinor: "0",
          taxMinor: "0",
          taxDescription: "Synthetic zero tax",
          taxEvidenceId: evidence.id,
          sourceGrossMinor: example.amountMinor,
        },
      ],
    },
  });

  drafts.push({
    id: draft.id,
    customer: example.name,
    amountMinor: example.amountMinor,
    revision: draft.revision,
  });
}

for (const article of [
  { code: "konferensradgivning", description: "Konferensrådgivning", unit: "tim", price: "108000" },
  { code: "lopande-radgivning", description: "Löpande rådgivning", unit: "tim", price: "100000" },
  { code: "workshop-heldag", description: "Workshop, heldag", unit: "st", price: "800000" },
])
  await post("/commerce/articles", {
    code: article.code,
    expectedRevision: 0,
    description: article.description,
    unit: article.unit,
    unitPriceMinor: article.price,
    taxDescription: "25 %",
  });

const journal = await post("/change-sets", {
  kind: "manual_journal",
  evidenceId: evidence.id,
  eventKey: `paper_${randomUUID()}`,
  accountingPeriodId: "period_synthetic_2026",
  postingDate: "2026-10-03",
  series: "A",
  description: "Syntetisk överföring att granska",
  rationale: "Disposable synthetic review fixture",
  taxAssessment: "not_applicable",
  lines: [
    {
      accountId: "account_bank",
      debitMinor: "185000",
      creditMinor: "0",
      description: "Synthetic debit",
    },
    {
      accountId: "account_clearing",
      debitMinor: "0",
      creditMinor: "185000",
      description: "Synthetic credit",
    },
  ],
});

const artifact = join(import.meta.dirname, "../../test-results/paper/seed.json");

await writeFile(
  artifact,
  JSON.stringify(
    { synthetic: true, evidenceId: evidence.id, drafts, journalId: journal.id },
    null,
    2,
  ),
);

console.log(JSON.stringify({ seeded: true, artifact, drafts: drafts.length }));

// Canonical customers, invoices F-2026-0035..0043 and the Skogsbruk Nord draft.
await import("./seed-sales.mjs");
