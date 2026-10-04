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

const saved = JSON.parse(
  await readFile(join(dirname(file), "onboarding-delta-fixture.json"), "utf8"),
);

const before = await request("/onboarding/lifecycle");

if (before.activation || before.projection.counts.importedVouchers !== 428)
  throw new Error("Use the unexecuted 434 candidate fixture.");

const setup = await request("/setup");

const effects = [];

for (const row of saved.delta.rows.filter((row) => row.kind !== "unchanged")) {
  const source = row.candidate ?? row.previous;
  const date = `${source.date.slice(0, 4)}-${source.date.slice(4, 6)}-${source.date.slice(6, 8)}`;

  const period = setup.periods.find(
    (item) => item.startsOn <= date && item.endsOn >= date && !item.locked,
  );

  if (!period) throw new Error("Current accounting period missing.");

  const proposal = await request(
    "/onboarding/source-delta-proposals",
    {
      deltaId: saved.delta.id,
      expectedDeltaDigest: saved.delta.digest,
      sourceReference: row.sourceReference,
      sourcePlanId: saved.plan.id,
      expectedSourcePlanDigest: saved.plan.digest,
      accountingPeriodId: period.id,
      rationale: "Named preparer applies retained final September source change",
    },
    sara,
  );

  const approval = await request("/onboarding/source-delta-approvals", {
    proposalId: proposal.id,
    expectedDigest: proposal.digest,
  });

  const effect = await request(
    "/onboarding/source-delta-effects",
    {
      proposalId: proposal.id,
      expectedDigest: proposal.digest,
      approvalIds: approval.approvals.map((item) => item.id),
    },
    sara,
  );

  effects.push(effect);
  console.info(
    JSON.stringify({
      sourceReference: row.sourceReference,
      kind: row.kind,
      executed: effects.length,
    }),
  );
}

const after = await request("/onboarding/lifecycle");

if (after.projection.counts.importedVouchers !== 434)
  throw new Error("Final identity count does not equal 434.");

await writeFile(
  join(dirname(file), "onboarding-delta-execution.json"),
  JSON.stringify({ synthetic: true, importedVouchers: 434, effects }, null, 2),
  { mode: 0o600 },
);

console.info(
  JSON.stringify({
    synthetic: true,
    importedVouchers: 434,
    new: 6,
    updated: 2,
    activated: after.activation !== null,
  }),
);
