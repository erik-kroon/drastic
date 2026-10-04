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

const fixture = JSON.parse(
  await readFile(join(dirname(file), "onboarding-owner-fixture.json"), "utf8"),
);

for (const value of [session.url, session.apiUrl]) {
  const origin = new URL(value);

  if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:")
    throw new Error("Only isolated local owners are allowed.");
}

const scope = "/api/v1/entities/entity_synthetic/books/book_synthetic";

async function login(email, password) {
  const response = await fetch(session.url + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin: session.url, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) throw new Error(`Synthetic login failed: ${response.status}`);

  const cookies = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

  if (!cookies) throw new Error("Better Auth did not issue a session.");

  return cookies;
}

const elin = await login(session.email, session.password),
  sara = await login(fixture.reviewerEmail, fixture.reviewerPassword);

async function request(path, input, cookie = elin) {
  const response = await fetch(session.url + scope + path, {
    method: input === undefined ? "GET" : "POST",
    headers: {
      cookie,
      origin: session.url,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: input === undefined ? undefined : JSON.stringify(input),
    signal: AbortSignal.timeout(30000),
  });

  const result = await response.json();

  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);

  return result;
}

const before = await request("/onboarding/lifecycle");

if (before.activation || before.projection.counts.importedVouchers !== 428)
  throw new Error("Use the posted 428-voucher fixture.");

if (before.controls.some((item) => item.kind === "bank_reconciling_items"))
  throw new Error("Verification has already been seeded.");

const statement = before.projection.bankStatements.find((item) =>
  item.rows.some((row) => row.date === "2026-09-28" && row.amountMinor === "-875000"),
);

const row = statement?.rows.find(
  (item) => item.date === "2026-09-28" && item.amountMinor === "-875000",
);

if (!statement || !row) throw new Error("The retained bank-side outflow is missing.");

async function control(filename, kind, identity, account, amount) {
  const content = `kind,as_of,currency,source_identity,account_code,amount_minor\n${kind},2026-09-30,SEK,${identity},${account},${amount}\n`;

  const occurrence = await request("/source-occurrences", {
    sourceSystem: "synthetic_independent_verification",
    sourceAccountId: "independent_book",
    occurrenceKey: randomUUID(),
    sourceRevision: "1",
    filename,
    mediaType: "text/csv",
    contentBase64: Buffer.from(content).toString("base64"),
  });

  return request(
    "/onboarding/controls",
    { occurrenceId: occurrence.id, kind, provenance: "Independent retained September control" },
    sara,
  );
}

await control(
  "bank-timing-2026.csv",
  "bank_reconciling_items",
  `${statement.id}:${row.rowOrdinal}`,
  "1930",
  "875000",
);

await control("vat-2026-09.csv", "vat", "retained-vat", "2650", "-1428100");

const material = await request("/onboarding/lifecycle");

const latest = new Map();

for (const control of material.controls.toSorted(
  (left, right) =>
    right.qualifiedAt.localeCompare(left.qualifiedAt) || right.id.localeCompare(left.id),
))
  if (control.asOf === "2026-09-30" && !latest.has(control.kind))
    latest.set(control.kind, control.id);

const snapshot = await request("/onboarding/snapshots", {
  purpose: "book_zero",
  controlIds: [...latest.values()],
  historicalRunIds: [fixture.staged.financialRun.id],
  closingCertificateId: null,
});

const receipt = {
  synthetic: true,
  snapshotId: snapshot.id,
  blockers: snapshot.blockers,
  permittedLimitations: snapshot.permittedLimitations,
  comparisons: snapshot.comparisons,
  acceptances: [],
};

await writeFile(
  join(dirname(file), "onboarding-verification-receipt.json"),
  JSON.stringify(receipt, null, 2),
  { mode: 0o600 },
);

console.info(JSON.stringify(receipt));
