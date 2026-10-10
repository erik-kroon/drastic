import { readFile, writeFile } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { createHash } from "node:crypto";

const runtimeFile = process.argv[2] ?? "test-results/commercial-targets/runtime.json";

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
    "idempotency-key": `commercial_target_${createHash("sha256")
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

const evidence = await call("/evidence", {
  title: "Granskat offertunderlag",
  mediaType: "text/plain",
  content: "Synthetic commercial visual qualification, no issued invoice or financial posting.",
  origin: "Adopted C-01 and C-02 synthetic qualification",
});

const customer = await call("/commerce/counterparties", {
  kind: "synthetic_counterparty_v1",
  externalKey: "commercial_targets_nordhamn",
  role: "customer",
  displayName: "Nordhamn Studio AB",
  evidenceId: evidence.id,
  reason: "Synthetic adopted target",
});

const article = await call("/commerce/articles", {
  code: "RED-01",
  expectedRevision: 0,
  description: "Redovisningstjänst",
  unit: "tim",
  unitPriceMinor: "125000",
  taxDescription: null,
  treatment: { kind: "unresolved" },
  status: "active",
});

const identity = {
  registrationId: null,
  taxId: null,
  address: null,
  countryCode: "SE",
  evidenceId: evidence.id,
};

const content = {
  title: "Redovisning oktober",
  counterpartyId: customer.id,
  counterpartyRevision: customer.revision,
  seller: { ...identity, legalName: "Fjällby Konsult AB" },
  customer: { ...identity, legalName: "Nordhamn Studio AB" },
  currency: "SEK",
  currencyScale: 2,
  plannedIssueDate: null,
  supplyDate: null,
  dueDate: null,
  paymentTerms: "Synthetic retained terms",
  note: null,
  buyerReference: null,
  orderReference: null,
  sourceTotalMinor: "25000",
  lines: [
    {
      id: "commercial_visual_line",
      description: "Redovisning oktober",
      quantity: "2",
      unitPriceMinor: "12500",
      baseMinor: "25000",
      discountMinor: "0",
      chargeMinor: "0",
      taxMinor: "0",
      taxDescription: "Synthetic retained zero tax",
      taxEvidenceId: evidence.id,
      sourceGrossMinor: "25000",
    },
  ],
};

const draft = await call("/commerce/invoice-drafts", {
  draftKey: "commercial_visual_source",
  content,
});

const quote = await call("/commerce/sales-documents", { kind: "quote", content });

const workspace = "/entities/entity_synthetic/books/book_synthetic";

const boards = {
  "C-01": {
    route: `${workspace}/sales?view=articles&record=${article.code}`,
    state: "selected active article with unresolved VAT and missing account",
    readyText: "Redigera artikel",
    selectText: article.description,
  },
  "C-02": {
    route: `${workspace}/sales?view=orders&record=${quote.id}`,
    state: "saved quote before source replacement",
    readyText: "Spara ny offertrevision",
    buttonClicks: [quote.content.title],
    pendingText: "Begäran pågår…",
  },
};

session.boards = { ...session.boards, ...boards };

runtime.boards = { ...runtime.boards, ...boards };

await writeFile(sessionFile, JSON.stringify(session), { mode: 0o600 });

await writeFile(runtimeFile, JSON.stringify(runtime), { mode: 0o600 });

await writeFile(
  join(dirname(runtimeFile), "commercial-target-seed.json"),
  JSON.stringify(
    {
      profile: "synthetic-core-v1",
      evidence: { id: evidence.id, sha256: evidence.sha256 },
      customer: { id: customer.id, revision: customer.revision },
      article,
      draft,
      quote,
      boards,
    },
    null,
    2,
  ),
);

console.log("C-01/C-02 synthetic sources prepared through public operations.");
