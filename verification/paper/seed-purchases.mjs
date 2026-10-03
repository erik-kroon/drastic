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
    signal: AbortSignal.timeout(15_000),
  });

  const result = await response.json();

  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);

  return result;
}

const initial = JSON.parse(
  await readFile(join(import.meta.dirname, "../../test-results/paper/seed.json"), "utf8"),
);

const recovery = await request(`/posting-recovery/${encodeURIComponent(initial.journalId)}`);

const receipt = recovery.summary.executionReceipt;

if (!receipt)
  throw new Error(
    "Post the initial synthetic journal through the product before seeding purchases",
  );

const voucher = await request(`/vouchers/${encodeURIComponent(receipt.voucherId)}`);

const line = voucher.action.lines.find((item) => BigInt(item.creditMinor) > 0n);

const evidence = voucher.action.evidenceRefs[0];

if (!line || !evidence) throw new Error("The synthetic voucher has no retained credit source");

const party = await request("/commerce/counterparties", {
  kind: "synthetic_counterparty_v1",
  externalKey: `paper_supplier_${randomUUID()}`,
  role: "supplier",
  displayName: "Nordhamn Leverans AB",
  evidenceId: evidence.evidenceId,
  reason: "Disposable synthetic supplier fixture",
});

const invoice = await request("/commerce/invoices", {
  kind: "synthetic_invoice_v1",
  direction: "supplier",
  counterpartyId: party.id,
  counterpartyRevision: party.revision,
  documentNumber: `SYNTHETIC-${randomUUID().slice(0, 8)}`,
  issuedOn: voucher.action.postingDate,
  dueOn: "2026-11-02",
  currency: voucher.action.currency,
  amountMinor: line.creditMinor,
  controlAccountId: line.accountId,
  recognitionVoucherId: voucher.id,
  recognitionLineId: line.lineId,
  evidenceId: evidence.evidenceId,
  description: "Synthetic source register verification",
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
  draftKey: `paper_supplier_${randomUUID()}`,
  content: {
    title: "Syntetiskt leverantörsutkast",
    counterpartyId: party.id,
    counterpartyRevision: party.revision,
    supplier: { ...identity, legalName: party.displayName },
    buyer: identity,
    sourceEvidenceId: evidence.evidenceId,
    supplierDocumentNumber: "SYNTHETIC-DRAFT",
    currency: invoice.currency,
    currencyScale: invoice.currencyScale,
    documentDate: voucher.action.postingDate,
    supplyDate: voucher.action.postingDate,
    dueDate: "2026-11-02",
    paymentTerms: "Synthetic source terms",
    sourceTotalMinor: line.creditMinor,
    lines: [
      {
        id: "line_synthetic_supplier",
        description: "Synthetic source service",
        quantity: "1",
        unitPriceMinor: line.creditMinor,
        baseMinor: line.creditMinor,
        discountMinor: "0",
        chargeMinor: "0",
        taxMinor: "0",
        taxDescription: "Synthetic zero tax",
        taxEvidenceId: evidence.evidenceId,
        sourceGrossMinor: line.creditMinor,
      },
    ],
  },
});

const artifact = join(import.meta.dirname, "../../test-results/paper/purchases-seed.json");

await writeFile(
  artifact,
  JSON.stringify(
    {
      synthetic: true,
      invoiceId: invoice.id,
      draftId: draft.id,
      voucherId: voucher.id,
      amountMinor: invoice.amountMinor,
      currencyScale: invoice.currencyScale,
      supplier: party.displayName,
    },
    null,
    2,
  ),
);

console.log(JSON.stringify({ seeded: true, artifact }));
