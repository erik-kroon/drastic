import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const file = process.argv[2];

if (
  !file ||
  basename(file) !== "session.json" ||
  !basename(dirname(file)).startsWith("openerp-paper-")
)
  throw new Error("Use the disposable private session.");

const session = JSON.parse(await readFile(file, "utf8"));

const fixture = JSON.parse(
  await readFile(join(dirname(file), "onboarding-owner-fixture.json"), "utf8"),
);

const origin = new URL(session.apiUrl);

if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:")
  throw new Error("Only isolated local owners are allowed.");

const scope = "/api/v1/entities/entity_synthetic/books/book_synthetic";

async function request(path, input) {
  const response = await fetch(origin.origin + scope + path, {
    method: input === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${fixture.reviewerToken}`,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: input === undefined ? undefined : JSON.stringify(input),
  });

  const result = await response.json();

  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);

  return result;
}

const before = await request("/onboarding/lifecycle");

for (const [filename, kind] of [
  ["sales_2026.csv", "sales_open_items"],
  ["purchases_2026.csv", "purchase_open_items"],
]) {
  const source = before.projection.sources.find(
    (item) =>
      item.occurrence.filename === filename &&
      item.occurrence.sourceSystem === "synthetic_independent_inventory",
  );

  if (!source) throw new Error("The retained inventory source is missing.");

  if (
    !before.controls.some(
      (item) => item.kind === kind && item.occurrenceId === source.occurrence.id,
    )
  )
    await request("/onboarding/controls", {
      occurrenceId: source.occurrence.id,
      kind,
      provenance: "Independent synthetic history-boundary invoice inventory",
    });
}

const after = await request("/onboarding/lifecycle");

const receipt = {
  synthetic: true,
  bankObservations: after.projection.counts.bankObservations,
  retainedOriginals: after.projection.counts.retainedOriginals,
  invoiceInventories: after.controls
    .filter((item) => item.asOf === "2026-09-30" && item.openItemDetails)
    .map((item) => ({
      kind: item.kind,
      rows: item.openItemDetails.length,
      outstandingMinor: item.facts
        .reduce((total, row) => total + BigInt(row.amountMinor), 0n)
        .toString(),
    })),
  nativeCustomerInvoices: after.projection.counts.customerInvoices,
  nativeSupplierInvoices: after.projection.counts.supplierInvoices,
};

await writeFile(
  join(dirname(file), "onboarding-inventory-receipt.json"),
  JSON.stringify(receipt, null, 2),
  { mode: 0o600 },
);

console.info(JSON.stringify(receipt));
