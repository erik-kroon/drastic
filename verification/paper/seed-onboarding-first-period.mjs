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
  console.info(JSON.stringify({ operation: "synthetic-login-start" }));

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
  console.info(JSON.stringify({ path, mutation: input !== undefined }));

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

if (
  !before.activation ||
  before.projection.counts.importedVouchers !== 434 ||
  !before.firstPeriodProgress ||
  before.firstPeriodProgress.bankThrough !== null ||
  before.firstPeriodProgress.originalCoverage !== null
)
  throw new Error("Require an activated fixture with unknown October coverage.");

const originals = [];

for (let index = 0; index < 2; index++) {
  const occurrence = await request("/source-occurrences", {
    sourceSystem: "synthetic_october_source",
    sourceAccountId: "independent_october",
    occurrenceKey: randomUUID(),
    sourceRevision: "1",
    filename: `october-original-${index + 1}.pdf`,
    mediaType: "application/pdf",
    contentBase64: Buffer.from(
      `%PDF-1.4\n% Synthetic October original ${index + 1}\n%%EOF\n`,
    ).toString("base64"),
  });

  originals.push(occurrence.id);

  const evidence = await request("/evidence", {
    title: `October expense ${index + 1}`,
    mediaType: "text/plain",
    content: `Independent synthetic October source ${index + 1}`,
    origin: "Disposable onboarding first-period fixture",
  });

  await request(
    "/change-sets",
    {
      kind: "manual_journal",
      evidenceId: evidence.id,
      eventKey: randomUUID(),
      accountingPeriodId: "period_synthetic_2026",
      postingDate: `2026-10-0${index + 1}`,
      series: "A",
      description: `October expense ${index + 1}`,
      rationale: "Retained October proposal, awaiting independent approval",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "account_expense",
          debitMinor: String((index + 1) * 10000),
          creditMinor: "0",
          description: "October expense",
        },
        {
          accountId: "account_bank",
          debitMinor: "0",
          creditMinor: String((index + 1) * 10000),
          description: "Bank outflow",
        },
      ],
    },
    sara,
  );
}

const bank = {
  kind: "synthetic_bank_statement_v1",
  statementIdentifier: randomUUID(),
  sourceBankAccountId: "synthetic_1930",
  accountId: "account_bank",
  currency: "SEK",
  startsOn: "2026-10-01",
  endsOn: "2026-10-02",
  openingMinor: "19893000",
  closingMinor: "19863000",
  completeness: { declaredComplete: true, basis: "Independent synthetic October statement" },
  rows: [
    {
      rowOrdinal: 1,
      providerId: null,
      date: "2026-10-01",
      description: "October expense 1",
      amountMinor: "-10000",
    },
    {
      rowOrdinal: 2,
      providerId: null,
      date: "2026-10-02",
      description: "October expense 2",
      amountMinor: "-20000",
    },
  ],
};

const bankEvidence = await request("/evidence", {
  title: "October bank statement",
  mediaType: "application/json",
  content: JSON.stringify(bank),
  origin: "Disposable onboarding first-period fixture",
});

await request("/bank-statements", { ...bank, evidenceId: bankEvidence.id, existingMatches: [] });

async function qualify(filename, kind, content) {
  const source = await request("/source-occurrences", {
    sourceSystem: "synthetic_independent_october",
    sourceAccountId: "independent_october",
    occurrenceKey: randomUUID(),
    sourceRevision: "1",
    filename,
    mediaType: "text/csv",
    contentBase64: Buffer.from(content).toString("base64"),
  });

  return request(
    "/onboarding/controls",
    {
      occurrenceId: source.id,
      kind,
      provenance: "Independent retained October control, not a period-end assertion",
    },
    sara,
  );
}

await qualify(
  "october-original-index.csv",
  "historical_originals",
  "as_of,currency,source_identity,original_occurrence_id\n" +
    originals.map((id, index) => `2026-10-02,SEK,october-original-${index + 1},${id}\n`).join(""),
);

for (const kind of ["sales_open_items", "purchase_open_items"]) {
  const control = before.controls
    .filter((item) => item.kind === kind && item.asOf === "2026-09-30")
    .sort((a, b) => b.qualifiedAt.localeCompare(a.qualifiedAt))[0];

  if (!control?.openItemDetails) throw new Error("Missing independent carried invoice inventory.");

  const content =
    "kind,as_of,currency,source_identity,account_code,original_minor,outstanding_minor,state,counterparty_name\n" +
    control.openItemDetails
      .map(
        (item) =>
          `${kind},2026-10-02,SEK,${item.sourceIdentity},${item.sourceAccount},${item.originalMinor},${item.outstandingMinor},${item.assertedState},${item.counterpartyName}\n`,
      )
      .join("");

  await qualify(`october-${kind}.csv`, kind, content);
}

const after = await request("/onboarding/lifecycle");

const progress = after.firstPeriodProgress;

if (
  progress.bankThrough !== "2026-10-02" ||
  progress.originalCoverage !== true ||
  progress.salesMatches !== true ||
  progress.purchaseMatches !== true ||
  progress.pendingProposals !== 2 ||
  after.completion !== null
)
  throw new Error("Native current-period progress mismatch " + JSON.stringify(progress));

await writeFile(
  join(dirname(file), "onboarding-first-period-journey.json"),
  JSON.stringify(
    { synthetic: true, receiptId: after.activation.id, progress, completed: false },
    null,
    2,
  ),
  { mode: 0o600 },
);

console.info(JSON.stringify({ synthetic: true, progress, completed: false }));
