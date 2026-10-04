import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const file = process.argv[2];

if (
  !file ||
  basename(file) !== "session.json" ||
  !basename(dirname(file)).startsWith("openerp-paper-")
)
  throw new Error("Use the disposable private session.");

const session = JSON.parse(await readFile(file, "utf8"));

const origin = new URL(session.apiUrl);

if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1")
  throw new Error("Only isolated local HTTP owners are allowed.");

const scope = "/api/v1/entities/entity_synthetic/books/book_synthetic";

async function request(path, input) {
  const response = await fetch(origin.origin + scope + path, {
    method: input === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
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

const before = await request("/onboarding/lifecycle");

if (
  before.controls.some((item) => item.kind === "historical_asset_register") ||
  before.projection.importPreviews[0]?.vouchers.length !== 428
)
  throw new Error("Use the 428-voucher fixture without an asset register.");

const rows = [
  ["asset-1", "15000000", "5000000"],
  ["asset-2", "15000000", "5000000"],
  ["asset-3", "15000000", "5000000"],
  ["asset-4", "10000000", "438123"],
];

const content =
  "as_of,currency,source_identity,account_code,cost_minor,accumulated_depreciation_minor\n" +
  rows
    .map(([id, cost, depreciation]) => `2026-09-30,SEK,${id},1210,${cost},${depreciation}\n`)
    .join("");

const occurrence = await request("/source-occurrences", {
  sourceSystem: "synthetic_independent_asset_register",
  sourceAccountId: "independent_book",
  occurrenceKey: randomUUID(),
  sourceRevision: "1",
  filename: "anlaggningsregister_2026.csv",
  mediaType: "text/csv",
  contentBase64: Buffer.from(content).toString("base64"),
});

await request("/onboarding/sources", { occurrenceId: occurrence.id, category: "assets" });

const after = await request("/onboarding/lifecycle");

const control = after.controls.find(
  (item) => item.kind === "historical_asset_register" && item.occurrenceId === occurrence.id,
);

if (!control?.assetRegister || control.assetRegister.rows.length !== 4)
  throw new Error("The received asset register was not qualified.");

const receipt = {
  synthetic: true,
  receivedAssetCount: control.assetRegister.rows.length,
  carryingMinor: control.assetRegister.rows
    .reduce((sum, row) => sum + BigInt(row.carryingMinor), 0n)
    .toString(),
  sourceSha256: control.sourceSha256,
  trialBalanceControlId: control.assetRegister.trialBalanceControlId,
  nativeAssetCount: after.projection.counts.assets,
};

await writeFile(
  join(dirname(file), "onboarding-received-assets.json"),
  JSON.stringify(receipt, null, 2),
  { mode: 0o600 },
);

console.info(JSON.stringify(receipt));
