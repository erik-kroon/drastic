import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const readiness = process.env.PAPER_READINESS === "1";
const sessionFile = resolve(process.argv[2] ?? "");
if (
  basename(sessionFile) !== "session.json" ||
  !basename(dirname(sessionFile)).startsWith("openerp-paper-")
)
  throw new Error("Use the private disposable Paper session");
const session = JSON.parse(await readFile(sessionFile, "utf8"));
const origin = new URL(session.url);
if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:")
  throw new Error("Only the disposable loopback runtime is allowed");
const login = await fetch(`${origin.origin}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: origin.origin },
  body: JSON.stringify({ email: session.email, password: session.password }),
  signal: AbortSignal.timeout(15000),
});
if (!login.ok) throw new Error(`Synthetic sign-in failed: ${login.status}`);
const cookie = login.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ");
if (!cookie) throw new Error("Synthetic session missing");
const base = `${origin.origin}/api/v1/entities/entity_synthetic/books/book_synthetic`;
async function call(path, input, allowAbsent = false) {
  const response = await fetch(`${base}${path}`, {
    method: input ? "POST" : "GET",
    headers: {
      cookie,
      origin: origin.origin,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: input ? JSON.stringify(input) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (allowAbsent && response.status === 404) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}
if (await call("/onboarding", undefined, true))
  throw new Error("Use a fresh book without an onboarding case");
const vouchers = await call("/vouchers?after=0");
if (vouchers.items.length || vouchers.next)
  throw new Error("Zero-balance fixture requires an empty book");
const onboardingCase = await call("/onboarding", { path: readiness ? "demo" : "existing_company" });
await call("/onboarding/revisions", {
  expectedRevision: onboardingCase.revision,
  configuration: {
    migrationDepth: "current_fiscal_year",
    incumbentSystem: "Synthetic previous system",
    dates: {
      historyStartsOn: "2026-01-01",
      historyEndsOn: "2026-09-30",
      detailStartsOn: "2026-01-01",
      openingOn: readiness ? "2026-08-31" : "2025-12-31",
      acceptanceStartsOn: "2026-09-01",
      acceptanceEndsOn: "2026-09-30",
      candidateLiveOn: "2026-10-01",
      provingPeriodEndsOn: "2026-10-31",
    },
  },
});
await promisify(execFile)("node", [
  resolve(import.meta.dirname, "seed-onboarding-profile.mjs"),
  sessionFile,
]);
await call("/onboarding/responsibilities", {
  expectedRevision: 0,
  assignments: {
    preparerId: "actor_paper_profile_preparer",
    bookkeepingApproverId: "actor_operator",
    paymentApproverId: "actor_operator",
    vatResponsibleId: "actor_operator",
    activationConfirmerIds: ["actor_operator", "actor_paper_profile_preparer"],
  },
});
const examples = [
  ["trial_balance", ["1930", "2999", "1510", "2440", "2650"]],
  ["bank", ["1930"]],
  ["sales_open_items", ["1510"]],
  ["purchase_open_items", ["2440"]],
  ["vat", ["2650"]],
];
const controls = [];
for (const [kind, codes] of examples) {
  const bytes =
    "kind,as_of,currency,source_identity,account_code,amount_minor\n" +
    codes
      .map((code) => `${kind},2026-09-30,SEK,synthetic-empty-${kind}-${code},${code},0`)
      .join("\n") +
    "\n";
  const source = await call("/source-occurrences", {
    sourceSystem: "independent-synthetic-statement",
    sourceAccountId: "empty-book-fixture",
    occurrenceKey: `empty-book-${kind}`,
    sourceRevision: "1",
    filename: `${kind}.csv`,
    mediaType: "text/csv",
    contentBase64: Buffer.from(bytes).toString("base64"),
  });
  const control = await call("/onboarding/controls", {
    occurrenceId: source.id,
    kind,
    provenance: "Independently specified synthetic empty-book statement. All amounts are zero.",
  });
  controls.push(control);
}
if (readiness) {
  const source = await call("/source-occurrences", {
    sourceSystem: "independent-synthetic-opening",
    sourceAccountId: "empty-book-fixture",
    occurrenceKey: "opening",
    sourceRevision: "1",
    filename: "opening.csv",
    mediaType: "text/csv",
    contentBase64: Buffer.from(
      "kind,as_of,currency,source_identity,account_code,amount_minor\ntrial_balance,2026-08-31,SEK,opening-bank,1930,0\ntrial_balance,2026-08-31,SEK,opening-clearing,2999,0\n",
    ).toString("base64"),
  });
  const control = await call("/onboarding/controls", {
    occurrenceId: source.id,
    kind: "trial_balance",
    provenance: "Independently specified synthetic zero opening",
  });
  const bank = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: "paper-september-zero",
    sourceBankAccountId: "paper-bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    openingMinor: "0",
    closingMinor: "0",
    completeness: { declaredComplete: true, basis: "Independent synthetic empty statement" },
    rows: [],
  };
  const bankSource = await call("/evidence", {
    title: "Synthetic September bank statement",
    content: JSON.stringify(bank),
    mediaType: "application/json",
    origin: "Disposable parity fixture",
  });
  await call("/bank-statements", { ...bank, evidenceId: bankSource.id, existingMatches: [] });
  const opening = await call("/onboarding/snapshots", {
    purpose: "opening",
    controlIds: [control.id],
    historicalRunIds: [],
    closingCertificateId: null,
  });
  if (opening.blockers.length) throw new Error(`Opening blocked: ${opening.blockers}`);
  await call("/onboarding/decisions", {
    snapshotId: opening.id,
    expectedDigest: opening.digest,
    decision: { kind: "accept_opening", reason: "Independent synthetic zero opening accepted" },
  });
}
const snapshot = await call("/onboarding/snapshots", {
  purpose: "book_zero",
  controlIds: controls.map((control) => control.id),
  historicalRunIds: [],
  closingCertificateId: null,
});
if (
  snapshot.comparisons.length !== 9 ||
  snapshot.comparisons.some((row) =>
    [row.expectedMinor, row.actualMinor, row.differenceMinor].some((value) => BigInt(value) !== 0n),
  )
)
  throw new Error("Empty-book comparisons do not match independently specified zero amounts");
if (readiness) {
  await call("/onboarding/decisions", {
    snapshotId: snapshot.id,
    expectedDigest: snapshot.digest,
    decision: {
      kind: "accept_limitation",
      limitation: "missing_tax_statement",
      reason:
        "Synthetic company is not VAT registered; tax statement absent in this isolated fixture",
    },
  });
  await call("/onboarding/decisions", {
    snapshotId: snapshot.id,
    expectedDigest: snapshot.digest,
    decision: { kind: "accept_book_zero", reason: "Independent zero period controls accepted" },
  });
  await call("/onboarding/snapshots", {
    purpose: "final_delta",
    controlIds: controls.map((control) => control.id),
    historicalRunIds: [],
    closingCertificateId: null,
  });
}
const artifact = "test-results/paper/onboarding-controls-seed.json";
await writeFile(
  artifact,
  JSON.stringify(
    {
      synthetic: true,
      scope: snapshot.scope,
      sourceControlIds: controls.map((control) => control.id),
      snapshotId: snapshot.id,
      comparisons: snapshot.comparisons,
      blockers: snapshot.blockers,
      missingTaxEvidence: true,
      bookZeroAccepted: readiness,
      openingAccepted: readiness,
      companyActivated: false,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    artifact,
    comparisons: snapshot.comparisons.length,
    blockers: snapshot.blockers,
  }),
);
