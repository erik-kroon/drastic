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

if (
  fixture.plan.voucherCount !== 428 ||
  before.activation ||
  before.projection.counts.retainedVouchers !== 0
)
  throw new Error("Use the unposted 428-voucher fixture.");

await request(
  `/sie-financial-runs/${fixture.staged.financialRun.id}/lease`,
  { action: "resume" },
  sara,
);

const august = before.controls.find(
  (item) => item.kind === "trial_balance" && item.asOf === "2026-08-31",
);

const snapshot = await request("/onboarding/snapshots", {
  purpose: "opening",
  controlIds: [august.id],
  historicalRunIds: [fixture.staged.financialRun.id],
  closingCertificateId: null,
});

if (snapshot.blockers.length) throw new Error(`Opening blockers: ${snapshot.blockers.join(",")}`);

const decision = await request("/onboarding/decisions", {
  snapshotId: snapshot.id,
  expectedDigest: snapshot.digest,
  decision: {
    kind: "accept_opening",
    reason: "Independent synthetic 428-voucher browser-session owner proof",
  },
});

const batches = [];

for (let iteration = 0; iteration < 23; iteration++) {
  const view = await request(
    `/onboarding/import-batches?financialRunId=${fixture.staged.financialRun.id}`,
  );

  if (view.run.status === "posted") break;

  const batch = await request(
    "/onboarding/import-batches",
    {
      financialRunId: view.run.id,
      expectedFence: view.run.fence,
      expectedNextOrdinal: view.run.nextOrdinal,
      expectedSourcePlanDigest: view.run.planDigest,
      rationale: "Named synthetic preparer derives the next retained source batch",
    },
    sara,
  );

  const approval = await request("/onboarding/import-batch-approvals", {
    batchId: batch.id,
    expectedDigest: batch.digest,
  });

  const chunk = await request(
    "/onboarding/import-batch-executions",
    { batchId: batch.id, expectedDigest: batch.digest, approvalId: approval.id },
    sara,
  );

  batches.push({
    batchId: batch.id,
    preparedBy: batch.preparedBy,
    approvalId: approval.id,
    approvedBy: approval.approvedBy,
    chunk,
  });
  console.info(JSON.stringify({ batches: batches.length, posted: chunk.lastOrdinal }));
}

const after = await request("/onboarding/lifecycle");

if (after.projection.counts.importedVouchers !== 428)
  throw new Error("The retained source inventory did not post all 428 identities.");

const receipt = {
  synthetic: true,
  openingDecision: {
    id: decision.id,
    actorName: decision.actorName,
    recordedAt: decision.recordedAt,
  },
  importedVouchers: after.projection.counts.importedVouchers,
  retainedVouchers: after.projection.counts.retainedVouchers,
  batches,
  activated: after.activation !== null,
};

await writeFile(
  join(dirname(file), "onboarding-history-posting.json"),
  JSON.stringify(receipt, null, 2),
  { mode: 0o600 },
);

console.info(
  JSON.stringify({
    synthetic: true,
    posted: receipt.importedVouchers,
    batches: batches.length,
    activated: receipt.activated,
  }),
);
