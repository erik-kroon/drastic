import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const sessionFile = resolve(process.argv[2] ?? "");
const journalId = process.argv[3];

if (
  basename(sessionFile) !== "session.json" ||
  !basename(dirname(sessionFile)).startsWith("openerp-paper-") ||
  !journalId
)
  throw new Error("Use the private Paper launcher session and its synthetic journal ID");

const session = JSON.parse(await readFile(sessionFile, "utf8"));
const origin = new URL(session.apiUrl);

if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:")
  throw new Error("Only the disposable local Worker is allowed");

const scope = "/api/v1/entities/entity_synthetic/books/book_synthetic";

async function request(path, input) {
  const headers = { authorization: `Bearer ${session.accessToken}` };

  if (input) {
    headers["content-type"] = "application/json";
    headers["idempotency-key"] = randomUUID();
  }

  const response = await fetch(`${origin.origin}${scope}${path}`, {
    method: input ? "POST" : "GET",
    headers,
    body: input ? JSON.stringify(input) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();

  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);

  return result;
}

const plan = await request(`/change-sets/${encodeURIComponent(journalId)}`);
const setup = await request("/setup");

if (
  plan.id !== journalId ||
  plan.scope.entityId !== "entity_synthetic" ||
  plan.scope.bookId !== "book_synthetic"
)
  throw new Error("Synthetic journal scope mismatch");

const source = plan.groups[0]?.actions[0];
const evidence = source?.evidenceRefs[0];
const debit = setup.accounts.find((account) => account.code === "1930");
const control = setup.accounts.find((account) => account.code === "2999");

if (
  !source ||
  !evidence ||
  !debit ||
  !control ||
  !source.lines.some((line) => line.debitMinor === "185000")
)
  throw new Error("The expected synthetic source, accounts or amount are missing");

const party = await request("/commerce/counterparties", {
  kind: "synthetic_counterparty_v1",
  externalKey: `todo_supplier_${randomUUID()}`,
  role: "supplier",
  displayName: "Nordhamn, syntetisk leverantör",
  evidenceId: evidence.evidenceId,
  reason: "Disposable To do review fixture",
});
const identity = {
  legalName: "Fjällby Konsult AB",
  registrationId: "SYNTHETIC-ONLY",
  taxId: null,
  address: "Synthetic address",
  countryCode: "SE",
  evidenceId: evidence.evidenceId,
};
const draft = await request("/commerce/supplier-invoice-drafts", {
  draftKey: `todo_supplier_${randomUUID()}`,
  content: {
    title: "Nordhamn, syntetiskt bokföringsförslag",
    counterpartyId: party.id,
    counterpartyRevision: party.revision,
    supplier: { ...identity, legalName: party.displayName },
    buyer: identity,
    sourceEvidenceId: evidence.evidenceId,
    supplierDocumentNumber: "SYNTHETIC-TODO",
    currency: source.currency,
    currencyScale: 2,
    documentDate: source.postingDate,
    supplyDate: source.postingDate,
    dueDate: "2026-11-02",
    paymentTerms: "Synthetic terms",
    sourceTotalMinor: "185000",
    lines: [
      {
        id: "line_synthetic_todo",
        description: "Synthetic source service",
        quantity: "1",
        unitPriceMinor: "185000",
        baseMinor: "185000",
        discountMinor: "0",
        chargeMinor: "0",
        taxMinor: "0",
        taxDescription: "Synthetic zero tax",
        taxEvidenceId: evidence.evidenceId,
        sourceGrossMinor: "185000",
      },
    ],
  },
});
const review = await request("/commerce/supplier-acceptance-reviews", {
  profile: "synthetic-gross-cost-supplier-v1",
  draftId: draft.id,
  expectedRevision: draft.revision,
  expectedDigest: draft.digest,
  debitAccountId: debit.id,
  controlAccountId: control.id,
  accountingPeriodId: source.accountingPeriodId,
  series: source.series,
  reason: "Disposable synthetic To do layout verification",
  acknowledgeSyntheticOnly: true,
});

const output = join(import.meta.dirname, "../../test-results/paper/todo");
await mkdir(output, { recursive: true });
const artifact = join(output, "seed.json");
await writeFile(
  artifact,
  JSON.stringify(
    {
      synthetic: true,
      draftId: draft.id,
      reviewId: review.id,
      postingPlanId: review.postingPlan.id,
      expectedDebitMinor: "185000",
      expectedCreditMinor: "185000",
      preparedOnly: true,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ seeded: true, artifact }));
