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

const saved = JSON.parse(
  await readFile(join(dirname(file), "onboarding-delta-fixture.json"), "utf8"),
);

const before = await request("/onboarding/lifecycle");

if (before.activation || before.projection.counts.importedVouchers !== 434)
  throw new Error("Only the executed final historical fixture.");

async function qualify(filename, kind, content) {
  const occurrence = await request("/source-occurrences", {
    sourceSystem: "synthetic_independent_final_controls",
    sourceAccountId: "independent_book",
    occurrenceKey: randomUUID(),
    sourceRevision: "final",
    filename,
    mediaType: "text/csv",
    contentBase64: Buffer.from(content).toString("base64"),
  });

  return request(
    "/onboarding/controls",
    {
      occurrenceId: occurrence.id,
      kind,
      provenance: "Independent retained final September control",
    },
    sara,
  );
}

await qualify(
  "final-bank-control.csv",
  "bank",
  "kind,as_of,currency,source_identity,account_code,amount_minor\nbank,2026-09-30,SEK,bank-final-1930,1930,19018000\n",
);

const sales = before.controls
  .filter((control) => control.kind === "sales_open_items" && control.asOf === "2026-09-30")
  .toSorted((a, b) => b.qualifiedAt.localeCompare(a.qualifiedAt) || b.id.localeCompare(a.id))[0];

if (sales?.openItemDetails?.length !== 34)
  throw new Error("Full retained invoice inventory missing.");

const rows = sales.openItemDetails.map((item) => {
  const paid = item.sourceIdentity === "F-2026-0034";

  return `sales_open_items,2026-09-30,SEK,${item.sourceIdentity},${item.sourceAccount},${item.originalMinor},${paid ? "0" : item.outstandingMinor},${paid ? "paid" : item.assertedState},${item.counterpartyName}\n`;
});

await qualify(
  "final-customer-invoices.csv",
  "sales_open_items",
  "kind,as_of,currency,source_identity,account_code,original_minor,outstanding_minor,state,counterparty_name\n" +
    rows.join(""),
);

const material = await request("/onboarding/lifecycle");

const latest = new Map();

for (const control of material.controls.toSorted(
  (a, b) => b.qualifiedAt.localeCompare(a.qualifiedAt) || b.id.localeCompare(a.id),
))
  if (control.asOf === "2026-09-30" && !latest.has(control.kind))
    latest.set(control.kind, control.id);

async function capture(purpose) {
  const input = {
    purpose,
    controlIds: [...latest.values()],
    historicalRunIds: [fixture.staged.financialRun.id],
    closingCertificateId: null,
  };

  if (purpose === "final_delta") input.deltaId = saved.delta.id;

  return request("/onboarding/snapshots", input);
}

const august = material.controls
  .filter((control) => control.kind === "trial_balance" && control.asOf === "2026-08-31")
  .toSorted((a, b) => b.qualifiedAt.localeCompare(a.qualifiedAt))[0];

if (!august) throw new Error("Retained August opening missing.");

const opening = await request("/onboarding/snapshots", {
  purpose: "opening",
  controlIds: [august.id],
  historicalRunIds: [fixture.staged.financialRun.id],
  closingCertificateId: null,
});

if (opening.blockers.length) throw new Error("Opening blockers: " + opening.blockers.join(","));

await request("/onboarding/decisions", {
  snapshotId: opening.id,
  expectedDigest: opening.digest,
  decision: {
    kind: "accept_opening",
    reason: "Independent opening rechecked after final source corrections",
  },
});

const zero = await capture("book_zero");

if (zero.blockers.length) throw new Error("Final Book Zero blockers: " + zero.blockers.join(","));

const acceptances = [];

for (const limitation of zero.permittedLimitations) {
  const carried = material.decisions.find(
    (item) =>
      zero.carriedLimitationDecisionIds.includes(item.id) &&
      item.decision.kind === "accept_limitation" &&
      item.decision.limitation === limitation,
  );

  const decision =
    carried ??
    (await request("/onboarding/decisions", {
      snapshotId: zero.id,
      expectedDigest: zero.digest,
      decision: {
        kind: "accept_limitation",
        limitation,
        reason:
          "Consciously accepted retained synthetic limitation after independent final September verification",
      },
    }));

  acceptances.push({
    id: decision.id,
    limitation,
    actorName: decision.actorName,
    recordedAt: decision.recordedAt,
    carried: !!carried,
  });
}

await request("/onboarding/decisions", {
  snapshotId: zero.id,
  expectedDigest: zero.digest,
  decision: {
    kind: "accept_book_zero",
    reason: "Final September balances independently verified with retained limitations",
  },
});

const delta = await capture("final_delta");

if (delta.blockers.length) throw new Error("Final delta blockers: " + delta.blockers.join(","));

const accepted = process.argv.includes("--pre-final")
  ? null
  : await request("/onboarding/decisions", {
      snapshotId: delta.id,
      expectedDigest: delta.digest,
      decision: {
        kind: "accept_final_delta",
        reason:
          "All six new identities and two retained updates are complete before 1 October authority",
      },
    });

const receipt = {
  synthetic: true,
  importedVouchers: 434,
  bookZeroSnapshot: zero.id,
  finalDeltaSnapshot: delta.id,
  acceptances,
  acceptedBy: accepted?.actorName ?? null,
  acceptedAt: accepted?.recordedAt ?? null,
};

await writeFile(
  join(dirname(file), "onboarding-final-verification.json"),
  JSON.stringify(receipt, null, 2),
  { mode: 0o600 },
);

console.info(JSON.stringify(receipt));
