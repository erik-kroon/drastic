import * as History from "./onboarding-history-fixture.mjs";
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
  throw new Error("Only posted pre-delta fixture.");

const material = await request("/onboarding");

async function retain(filename, content, sourceSystem) {
  return request("/source-occurrences", {
    sourceSystem,
    sourceAccountId: "independent_book",
    occurrenceKey: randomUUID(),
    sourceRevision: "final",
    filename,
    mediaType: filename.endsWith(".csv") ? "text/csv" : "application/octet-stream",
    contentBase64: Buffer.from(content).toString("base64"),
  });
}

const occurrence = await retain(
  "fjallby_2026_final.se",
  History.finalContent,
  "synthetic_incumbent",
);

await request("/onboarding/sources", { occurrenceId: occurrence.id, category: "previous_books" });

const preview = await request(`/source-occurrences/${occurrence.id}/sie-previews`, {
  encoding: "utf-8",
});

const controlSource = await retain(
  "final-independent-trial.csv",
  "kind,as_of,currency,source_identity,account_code,amount_minor\n" +
    History.chart
      .map((account) => {
        const code = account.code === "2890" ? "2999" : account.code;

        return `trial_balance,2026-09-30,SEK,final-${account.code},${account.code},${History.finalBalances[code]}\n`;
      })
      .join(""),
  "synthetic_independent_final",
);

const closing = await request(
  "/onboarding/controls",
  {
    occurrenceId: controlSource.id,
    kind: "trial_balance",
    provenance: "Independent final September balance",
  },
  sara,
);

const opening = before.controls.find(
  (control) => control.kind === "trial_balance" && control.asOf === "2025-12-31",
);

if (!opening) throw new Error("Fiscal opening control missing.");

const mappingState = await request(`/onboarding/account-mappings?previewId=${preview.id}`);

await request("/onboarding/account-mappings", {
  previewId: preview.id,
  expectedPreviewDigest: preview.digest,
  sourceAccount: "2999",
  accountId: "account_clearing",
  remember: true,
  expectedRevision: Math.max(
    0,
    ...mappingState.history
      .filter((item) => item.sourceAccount === "2999")
      .map((item) => item.revision),
  ),
});

const plan = await request(
  "/onboarding/import-plans",
  {
    expectedRevision: material.case.revision,
    previewId: preview.id,
    expectedPreviewDigest: preview.digest,
    openingControlId: opening.id,
    closingControlId: closing.id,
    mappings: History.mappings,
    rationale: "Final retained history before OpenERP authority",
  },
  sara,
);

const delta = await request("/onboarding/source-deltas", {
  candidatePreviewId: preview.id,
  expectedPreviewDigest: preview.digest,
});

const changed = delta.rows.filter((row) => row.kind !== "unchanged");

if (
  changed.filter((row) => row.kind === "new").length !== 6 ||
  changed.filter((row) => row.kind === "changed").length !== 2 ||
  changed.some((row) => row.kind === "removed")
)
  throw new Error("Final source identity totals do not reconcile.");

for (const row of changed)
  await request("/onboarding/source-delta-decisions", {
    deltaId: delta.id,
    expectedDigest: delta.digest,
    sourceReference: row.sourceReference,
    choice: "use_change",
    reason: "Reviewed retained source change before 1 October authority",
  });

const receipt = { synthetic: true, occurrence, preview, plan, delta, closing };

await writeFile(
  join(dirname(file), "onboarding-delta-fixture.json"),
  JSON.stringify(receipt, null, 2),
  { mode: 0o600 },
);

console.info(
  JSON.stringify({
    synthetic: true,
    new: 6,
    updated: 2,
    total: 434,
    dates: "through 2026-09-30",
    financialEffects: 0,
  }),
);
