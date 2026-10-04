import { invoiceInventory } from "./onboarding-history-fixture.mjs";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const file = process.argv[2];

if (
  !file ||
  basename(file) !== "session.json" ||
  !basename(dirname(file)).startsWith("openerp-paper-")
)
  throw new Error("Use a disposable private session.");

const scratch = dirname(file);

const session = JSON.parse(await readFile(file, "utf8"));

const fixture = JSON.parse(await readFile(join(scratch, "onboarding-owner-fixture.json"), "utf8"));

const origin = new URL(session.apiUrl);

if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:")
  throw new Error("Only isolated local HTTP owners are allowed.");

const scope = "/api/v1/entities/entity_synthetic/books/book_synthetic";

async function request(path, input, token = session.accessToken) {
  const response = await fetch(origin.origin + scope + path, {
    method: input === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: input === undefined ? undefined : JSON.stringify(input),
    signal: AbortSignal.timeout(15000),
  });

  const result = await response.json();

  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);

  return result;
}

const lifecycle = await request("/onboarding/lifecycle");

if (
  fixture.preview.vouchers.length !== 428 ||
  lifecycle.projection.bankStatements.length ||
  lifecycle.controls.some(
    (item) =>
      item.kind === "historical_originals" || (item.asOf === "2026-09-30" && item.openItemDetails),
  )
)
  throw new Error("Use the untouched 428-voucher fixture.");

async function retain(filename, content, mediaType, category) {
  const source = await request("/source-occurrences", {
    sourceSystem: "synthetic_independent_inventory",
    sourceAccountId: "independent_book",
    occurrenceKey: randomUUID(),
    sourceRevision: "1",
    filename,
    mediaType,
    contentBase64: Buffer.from(content).toString("base64"),
  });

  if (category) await request("/onboarding/sources", { occurrenceId: source.id, category });

  return source;
}

const bankStatements = [];

for (let period = 0; period < 2; period++) {
  const bank = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: `onboarding_${randomUUID()}`,
    sourceBankAccountId: "synthetic_1930",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: period ? "2026-09-01" : "2026-01-01",
    endsOn: period ? "2026-09-30" : "2026-08-31",
    openingMinor: "0",
    closingMinor: period ? "18245000" : "0",
    completeness: { declaredComplete: true, basis: "Independent synthetic statement" },
    rows: Array.from({ length: 306 }, (_, index) => ({
      rowOrdinal: index + 1,
      providerId: null,
      date: period ? (index === 304 ? "2026-09-28" : "2026-09-30") : "2026-08-31",
      description: `Synthetic observation ${index + 1}`,
      amountMinor:
        period && index === 304
          ? "-875000"
          : index === 305
            ? period
              ? "19120000"
              : "-100"
            : index % 2 === 0
              ? "100"
              : "-100",
    })),
  };

  await retain(`bank_1930_${period + 1}.json`, JSON.stringify(bank), "application/json", "bank");

  const evidence = await request("/evidence", {
    title: "Independent synthetic statement",
    mediaType: "application/json",
    content: JSON.stringify(bank),
    origin: "Disposable onboarding fixture",
  });

  const result = await request("/bank-statements", {
    ...bank,
    evidenceId: evidence.id,
    existingMatches: [],
  });

  bankStatements.push(result.statement.id);
}

await retain(
  "bank-control-2026-09-30.csv",
  "kind,as_of,currency,source_identity,account_code,amount_minor\nbank,2026-09-30,SEK,bank-1930,1930,18245000\n",
  "text/csv",
  "bank",
);

for (const inventory of invoiceInventory) {
  const rows = inventory.items.map(
    ([identity, amount, name, paid]) =>
      `${inventory.kind},2026-09-30,SEK,${identity},${inventory.code},${amount},${paid ? 0 : amount},${paid ? "paid" : "unpaid"},${name}\n`,
  );

  const occurrence = await retain(
    `${inventory.category}_2026.csv`,
    "kind,as_of,currency,source_identity,account_code,original_minor,outstanding_minor,state,counterparty_name\n" +
      rows.join(""),
    "text/csv",
    inventory.category,
  );

  const retained = await request("/onboarding/lifecycle");

  if (
    !retained.controls.some(
      (item) => item.kind === inventory.kind && item.occurrenceId === occurrence.id,
    )
  )
    await request(
      "/onboarding/controls",
      {
        occurrenceId: occurrence.id,
        kind: inventory.kind,
        provenance: "Independent synthetic history-boundary invoice inventory",
      },
      fixture.reviewerToken,
    );
}

const indexRows = [];

for (let index = 0; index < 403; index++) {
  let occurrenceId = "";

  if (index < 391) {
    const original = await retain(
      `synthetic-original-${index + 1}.pdf`,
      `%PDF-1.4\n% Independent synthetic custody fixture ${index + 1}\n%%EOF\n`,
      "application/pdf",
    );

    occurrenceId = original.id;
  }

  indexRows.push(`2026-09-30,SEK,original-${index + 1},${occurrenceId}\n`);

  if ((index + 1) % 100 === 0)
    console.info(JSON.stringify({ retainedOriginals: Math.min(index + 1, 391) }));
}

await retain(
  "original-index-2026.csv",
  "as_of,currency,source_identity,original_occurrence_id\n" + indexRows.join(""),
  "text/csv",
  "other",
);

await retain(
  "historical-payroll-handoff.csv",
  "source_system,history_starts_on,retained_through,currency\nTidigare bokföringsprogram,2026-01-01,2026-09-30,SEK\n",
  "text/csv",
  "payroll",
);

const result = await request("/onboarding/lifecycle");

const receipt = {
  synthetic: true,
  bankStatementIds: bankStatements,
  bankObservations: result.projection.counts.bankObservations,
  retainedOriginals: result.projection.counts.retainedOriginals,
  invoiceInventories: result.controls
    .filter((item) => item.asOf === "2026-09-30" && item.openItemDetails)
    .map((item) => ({
      kind: item.kind,
      rows: item.openItemDetails.length,
      outstandingMinor: item.facts
        .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n)
        .toString(),
    })),
  nativeCustomerInvoices: result.projection.counts.customerInvoices,
  nativeSupplierInvoices: result.projection.counts.supplierInvoices,
};

await writeFile(
  join(scratch, "onboarding-inventory-receipt.json"),
  JSON.stringify(receipt, null, 2),
  { mode: 0o600 },
);

console.info(JSON.stringify(receipt));
