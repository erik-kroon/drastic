import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const readiness = process.env.PAPER_READINESS === "1";
const sessionFile = resolve(process.argv[2] ?? "");
const scratch = dirname(sessionFile);

if (basename(sessionFile) !== "session.json" || !basename(scratch).startsWith("openerp-paper-"))
  throw new Error("Use the private session file produced by the Paper launcher");

const session = JSON.parse(await readFile(sessionFile, "utf8"));
const origin = new URL(session.url);

if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:")
  throw new Error("Only the disposable local runtime is allowed");

const scope = "/api/v1/entities/entity_synthetic/books/book_synthetic";

async function signIn(email, password) {
  const response = await fetch(`${origin.origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: origin.origin },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) throw new Error(`Synthetic sign-in failed: ${response.status}`);

  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

  if (!cookie) throw new Error("Synthetic sign-in did not retain a session");

  return cookie;
}

async function call(cookie, path, input) {
  const response = await fetch(`${origin.origin}${scope}${path}`, {
    method: input ? "POST" : "GET",
    headers: {
      cookie,
      origin: origin.origin,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: input ? JSON.stringify(input) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();

  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);

  return result;
}

const reviewer = await signIn(session.email, session.password);
const existing = await call(reviewer, "/company-facts");

if (existing.items.length || existing.nextCursor)
  throw new Error("Use a fresh fixture without existing company facts");

const pid = (await readFile(join(scratch, "pgdata/postmaster.pid"), "utf8")).split("\n");
const password = (await readFile(join(scratch, "pg-password"), "utf8")).trim();
const connectionString = `postgresql://postgres:${password}@127.0.0.1:${Number(pid[3])}/postgres`;
const api = resolve(import.meta.dirname, "../../apps/api");
const { Client } = createRequire(join(api, "package.json"))("pg");
const database = new Client({ connectionString });
const actorId = "actor_paper_profile_preparer";

await database.connect();
try {
  // Fixture-only identity setup in the launcher's disposable database.
  await database.query("insert into openerp.actors(id,name) values($1,'Sara Lind')", [actorId]);
  await database.query(
    "insert into openerp.memberships(book_id,actor_id,role) values('book_synthetic',$1,'operator')",
    [actorId],
  );
  if (readiness) {
    const release = {
      id: "paper_synthetic_posting_v1",
      jurisdiction: "QZ",
      family: "posting_eligibility",
      version: 1,
      checksum: `sha256:${"b".repeat(64)}`,
      applicability: {
        legalForms: [],
        accountingMethods: ["accrual"],
        vatRegistrations: [],
        payrollRegistrations: [],
      },
      requiredFactKinds: ["accounting_method"],
      requiredRoleKinds: ["commerce"],
      calculatorVersion: "synthetic-onboarding-v1",
      rounding: { mode: "half_up", scale: 2 },
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      sourceManifest: "Independent synthetic lifecycle fixture",
      qualificationStatus: "reviewed",
      recordClasses: ["synthetic"],
    };
    await database.query(
      "insert into openerp.rule_releases(id,jurisdiction,family,version,checksum,body) values($1,'QZ','posting_eligibility',1,$2,$3)",
      [release.id, release.checksum, release],
    );
  }
} finally {
  await database.end();
}

const email = "sara-profile@example.test";
const preparerPassword = randomBytes(24).toString("hex");
await promisify(execFile)("bun", ["scripts/create-user.ts", actorId], {
  cwd: api,
  env: {
    ...process.env,
    DATABASE_ADMIN_URL: connectionString,
    OPENERP_EMAIL: email,
    OPENERP_PASSWORD: preparerPassword,
  },
});
const preparer = await signIn(email, preparerPassword);
const facts = [];

for (const [factKind, value, sourceTitle] of [
  ...(readiness
    ? [
        ["jurisdiction", "QZ", "Synthetic jurisdiction"],
        ["vat_registration", "not_registered", "Synthetic applicability"],
        ["asset_applicability", false, "Synthetic applicability"],
        ["payroll_applicability", false, "Synthetic applicability"],
        ["foreign_currency_applicability", false, "Synthetic applicability"],
      ]
    : []),
  ["legal_form", "aktiebolag", "Du angav"],
  ["fiscal_year", { startsOn: "2026-01-01", endsOn: "2026-12-31" }, "Du angav"],
  ["accounting_method", "accrual", "Importfil"],
  ["vat_period", "quarterly", "Byrå Nordlund"],
  ["base_currency", "SEK", "Du angav"],
  ["reporting_framework", "K2", "Byrå Nordlund"],
]) {
  const source = await call(preparer, "/evidence", {
    title: sourceTitle,
    content: JSON.stringify({ synthetic: true, factKind, value }),
    mediaType: "application/json",
    origin: "Disposable Paper onboarding profile fixture",
  });
  const fact = await call(preparer, "/company-facts", {
    factKind,
    value: { state: "known", value },
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    supersedesId: null,
    evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
    note: "Synthetic Paper company profile",
  });
  const review = await call(reviewer, `/company-facts/${fact.id}/reviews`, {
    factRevisionId: fact.id,
    expectedDigest: fact.digest,
    result: "confirmed",
    rationale: "Reviewed synthetic Paper profile fixture",
  });
  facts.push({ factKind, factId: fact.id, sourceId: source.id, reviewer: review.reviewer });
}

if (readiness) {
  const source = await call(preparer, "/evidence", {
    title: "Synthetic profile binding",
    content: "Independent synthetic commerce account binding",
    mediaType: "text/plain",
    origin: "Disposable parity fixture",
  });
  await call(preparer, "/company-role-bindings", {
    roleKind: "commerce",
    accountId: "account_clearing",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    supersedesId: null,
    reviewer: "actor_operator",
    evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
    note: "Synthetic retained binding",
  });
  const plan = await call(preparer, "/company-activation-plans", {
    family: "posting_eligibility",
    recordClass: "synthetic",
    dates: {
      postingOn: "2026-09-30",
      taxPointOn: null,
      paymentOn: null,
      reportOn: null,
      taxPeriodOn: null,
    },
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    reason: "Synthetic onboarding profile",
  });
  const approval = await call(reviewer, `/company-activation-plans/${plan.id}/approvals`, {
    planDigest: plan.digest,
  });
  await call(preparer, `/company-activation-plans/${plan.id}/executions`, {
    planDigest: plan.digest,
    approvalId: approval.id,
  });
}

const artifact = resolve(
  import.meta.dirname,
  "../../test-results/paper/onboarding-profile-seed.json",
);
await writeFile(
  artifact,
  JSON.stringify(
    { synthetic: true, facts, limitations: ["No chart release owner", "No company activation"] },
    null,
    2,
  ),
);
console.info(JSON.stringify({ seeded: true, artifact }));
