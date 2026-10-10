import { readFile, writeFile } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { createHash } from "node:crypto";

const runtimeFile = process.argv[2] ?? "test-results/recurring-targets/runtime.json";

const runtime = JSON.parse(await readFile(runtimeFile, "utf8"));

const sessionFile = runtime.sessionFile;

if (
  basename(sessionFile) !== "session.json" ||
  !basename(dirname(sessionFile)).startsWith("openerp-paper-")
)
  throw new Error("Use a disposable Paper runtime");

const session = JSON.parse(await readFile(sessionFile, "utf8"));

const origin = new URL(session.url);

if (
  origin.protocol !== "http:" ||
  origin.hostname !== "127.0.0.1" ||
  session.workspace !== `${origin.origin}/entities/entity_synthetic/books/book_synthetic`
)
  throw new Error("Synthetic workspace required");

const login = await fetch(`${session.url}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { origin: session.url, "content-type": "application/json" },
  body: JSON.stringify({ email: session.email, password: session.password }),
});

if (!login.ok) throw new Error(`Synthetic sign-in HTTP ${login.status}`);

const cookie = login.headers
  .getSetCookie()
  .map((entry) => entry.split(";")[0])
  .join("; ");

const base = `${session.url}/api/v1/entities/entity_synthetic/books/book_synthetic`;

async function call(path, body) {
  const encoded = body === undefined ? undefined : JSON.stringify(body);

  const headers = {
    origin: session.url,
    cookie,
    "content-type": "application/json",
    "idempotency-key": `recurring_target_${createHash("sha256")
      .update(path + (encoded ?? ""))
      .digest("hex")}`,
  };

  if (session.testNow) headers["x-openerp-test-now"] = session.testNow;

  const response = await fetch(`${base}${path}`, {
    method: encoded ? "POST" : "GET",
    headers,
    body: encoded,
  });

  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${await response.text()}`);

  return response.json();
}

const source = await call("/evidence", {
  title: "Granskat avtalsunderlag",
  mediaType: "text/plain",
  content:
    "Synthetic recurring agreement visual qualification. No issued invoice, posting or delivery.",
  origin: "Adopted R-01 through R-04 synthetic visual qualification",
});

const customer = await call("/commerce/counterparties", {
  kind: "synthetic_counterparty_v1",
  externalKey: "recurring_targets_nordhamn",
  role: "customer",
  displayName: "Nordhamn Studio AB",
  evidenceId: source.id,
  reason: "Synthetic adopted recurring target",
});

const agreement = await call("/commerce/recurring-invoices", {
  customerId: customer.id,
  title: "Redovisning varje månad",
  schedule: {
    anchorLocalDate: "2026-10-01",
    timeZone: "Europe/Stockholm",
    cadence: {
      kind: "monthly",
      monthInterval: "1",
      dayInterval: null,
      monthAnchorPolicy: "anchor_day_clamped",
    },
    firstCycleOrdinal: "1",
  },
  reason: "Synthetic visual qualification of future recurring billing",
});

const path = `/commerce/recurring-invoices/${agreement.id}`;

await call(`${path}/template-revisions`, {
  expectedAgreementRevision: agreement.revision,
  expectedAgreementDigest: agreement.digest,
  effectiveFromCycle: "1",
  chargeComponentKeys: ["monthly_service"],
  template: {
    kind: "commercial",
    title: "Redovisning varje månad",
    counterpartyId: customer.id,
    seller: {
      legalName: "Fjällby Konsult AB",
      registrationId: null,
      taxId: null,
      address: null,
      countryCode: "SE",
      evidenceId: source.id,
    },
    currency: "SEK",
    currencyScale: 2,
    paymentTerms: "30 dagar",
    dateOffsets: { issueDays: "0", supplyDays: "0", dueDays: "30" },
    lines: [
      {
        id: "monthly_service",
        description: "Redovisningstjänst",
        quantity: "1",
        unitPriceMinor: "125000",
        discountMinor: "0",
        chargeMinor: "0",
        treatment: { kind: "unresolved" },
      },
    ],
  },
  reason: "Reviewed synthetic commercial template",
});

const occurrence = await call(`${path}/occurrences`, {
  cycleOrdinal: "1",
  reason: "Synthetic reviewable cycle, not prepared or issued",
});

const route = `/entities/entity_synthetic/books/book_synthetic/sales?view=recurring&record=${agreement.id}`;

const boards = {
  "R-01": {
    route,
    state: "selected saved agreement with one unprepared cycle",
    readyText: "Förbered fakturautkast",
  },
  "R-02": {
    route:
      "/entities/entity_synthetic/books/book_synthetic/sales?view=recurring&recurringForm=create",
    state: "empty creation form",
    readyText: "Spara avtal",
  },
  "R-03": {
    route: `${route}&recurringForm=schedule`,
    state: "future schedule before edits",
    readyText: "Spara framtida schema",
  },
  "R-04": {
    route: `${route}&recurringForm=template`,
    state: "future template with no source selected",
    readyText: "Spara framtida mallrevision",
  },
};

session.boards = { ...session.boards, ...boards };

runtime.boards = { ...runtime.boards, ...boards };

await writeFile(sessionFile, JSON.stringify(session), { mode: 0o600 });

await writeFile(runtimeFile, JSON.stringify(runtime), { mode: 0o600 });

await writeFile(
  join(dirname(runtimeFile), "recurring-target-seed.json"),
  JSON.stringify(
    { agreement, customer, source: { id: source.id, sha256: source.sha256 }, occurrence, boards },
    null,
    2,
  ),
);

console.log(
  JSON.stringify({
    ready: true,
    boards: Object.keys(boards),
    financialEffects: "none; reviewable occurrence only",
  }),
);
