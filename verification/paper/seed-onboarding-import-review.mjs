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

if (before.activation || fixture.staged !== null || fixture.preview.vouchers.length !== 428)
  throw new Error("Require pre-import retained source review.");

async function retain(filename, body) {
  return request("/source-occurrences", {
    sourceSystem: "independent_import_review",
    sourceAccountId: "source_review",
    occurrenceKey: randomUUID(),
    sourceRevision: "1",
    filename,
    mediaType: "application/json",
    contentBase64: Buffer.from(JSON.stringify(body)).toString("base64"),
  });
}

const duplicate = {
  kind: "onboarding_invoice_source_v1",
  documentNumber: "882",
  counterpartyName: "Vinter & Co AB",
  currency: "SEK",
  amountMinor: "480000",
};

const first = await retain("vinter-882-original.json", duplicate),
  second = await retain("vinter-882-candidate.json", duplicate),
  currency = await retain("invoice-7731-source.json", {
    kind: "onboarding_invoice_source_v1",
    documentNumber: "7731",
    counterpartyName: "Källans leverantör",
    currency: "XBT",
    amountMinor: "10000",
  });

const duplicateOrdinal =
  fixture.preview.vouchers.find((voucher) => voucher.text?.includes("882"))?.ordinal ?? 20;

const currencyOrdinal = fixture.preview.vouchers.find(
  (voucher) =>
    voucher.ordinal > duplicateOrdinal &&
    !voucher.transactions.some((line) => line.account === "2999"),
)?.ordinal;

if (!currencyOrdinal) throw new Error("Missing separate source ordinal.");

const report = {
  previewId: fixture.preview.id,
  previewDigest: fixture.preview.digest,
  findings: [
    {
      voucherOrdinal: duplicateOrdinal,
      kind: "duplicate_candidate",
      occurrenceIds: [first.id, second.id],
      resolutionOccurrenceId: null,
    },
    {
      voucherOrdinal: currencyOrdinal,
      kind: "unsupported_currency",
      occurrenceIds: [currency.id],
      resolutionOccurrenceId: null,
    },
  ],
};

const source = await retain("historical-import-review.json", report);

const control = await request(
  "/onboarding/controls",
  {
    occurrenceId: source.id,
    kind: "historical_import_review",
    provenance: "Independent retained source findings, no financial approval",
  },
  sara,
);

await writeFile(
  join(dirname(file), "onboarding-import-review.json"),
  JSON.stringify({ synthetic: true, source, report, control }, null, 2),
  { mode: 0o600 },
);

console.info(
  JSON.stringify({
    synthetic: true,
    pendingFindings: control.importReview.findings.length,
    financialApproval: false,
  }),
);
