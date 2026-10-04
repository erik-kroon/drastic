import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const file = process.argv[2];

if (
  !file ||
  basename(file) !== "session.json" ||
  !basename(dirname(file)).startsWith("openerp-paper-")
)
  throw new Error("Use a private disposable session.");

const session = JSON.parse(await readFile(file, "utf8")),
  fixture = JSON.parse(
    await readFile(join(dirname(file), "onboarding-owner-fixture.json"), "utf8"),
  ),
  origin = new URL(session.apiUrl);

if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:")
  throw new Error("Only isolated local owners.");

const scope = "/api/v1/entities/entity_synthetic/books/book_synthetic";

async function request(path, input, token = session.accessToken) {
  const response = await fetch(origin.origin + scope + path, {
    method: input === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
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
  before.activation ||
  !(
    before.projection.counts.assets === 4 ||
    (process.argv.includes("--review-only") &&
      fixture.staged === null &&
      before.controls.some((control) => control.assetRegister?.rows.length === 4))
  )
)
  throw new Error("Complete native asset handoff first.");

const evidence = await request("/evidence", {
  title: "Independent synthetic company facts",
  mediaType: "text/plain",
  content:
    "Synthetic fixture: Aktiebolag, K2, accrual, quarterly VAT, SEK, calendar fiscal year. Assets retained in the independent source register. Historical payroll remains in the predecessor. Posting eligibility retains QZ synthetic jurisdiction; this evidence makes no Swedish statutory readiness claim.",
  origin: "Disposable independent company profile",
});

for (const [factKind, value] of [
  ["legal_form", "aktiebolag"],
  ["reporting_framework", "K2"],
  ["vat_period", "quarterly"],
  ["base_currency", "SEK"],
  ["fiscal_year", { startsOn: "2026-01-01", endsOn: "2026-12-31" }],
  ["asset_applicability", true],
  ["payroll_applicability", true],
]) {
  const existing = before.projection.companyFacts
    .filter((item) => item.revision.factKind === factKind)
    .sort((a, b) => b.revision.recordedAt.localeCompare(a.revision.recordedAt))[0]?.revision;

  const fact = await request("/company-facts", {
    factKind,
    value: { state: "known", value },
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    supersedesId: existing?.id ?? null,
    evidence: [{ evidenceId: evidence.id, sha256: evidence.sha256 }],
    note: "Independent synthetic qualification, historical payroll stays with predecessor",
  });

  await request(
    `/company-facts/${fact.id}/reviews`,
    {
      factRevisionId: fact.id,
      expectedDigest: fact.digest,
      result: "confirmed",
      rationale: "Independent synthetic review of retained facts",
    },
    fixture.reviewerToken,
  );
}

console.info(JSON.stringify({ synthetic: true, qualifiedFacts: 7, statutoryReady: false }));
