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

const elin = await login(session.email, session.password);

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

const material = await request("/onboarding/lifecycle");

if (
  material.activation ||
  material.projection.counts.importedVouchers !== 434 ||
  material.projection.counts.assets !== 4
)
  throw new Error("Require the completed final native handoff.");

const latest = new Map();

for (const control of material.controls.toSorted(
  (a, b) => b.qualifiedAt.localeCompare(a.qualifiedAt) || b.id.localeCompare(a.id),
))
  if (control.asOf === "2026-09-30" && !latest.has(control.kind))
    latest.set(control.kind, control.id);

const snapshot = await request("/onboarding/snapshots", {
  purpose: "activation",
  controlIds: [...latest.values()],
  historicalRunIds: [fixture.staged.financialRun.id],
  closingCertificateId: null,
});

if (snapshot.blockers.length && !process.argv.includes("--pre-final"))
  throw new Error("Activation blockers: " + snapshot.blockers.join(","));

if (!process.argv.includes("--pre-final")) {
  const configPath = join(dirname(file), "operations-configuration.json"),
    config = JSON.parse(await readFile(configPath, "utf8"));

  config.snapshotId = snapshot.id;
  await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

await writeFile(
  join(dirname(file), "onboarding-activation-snapshot.json"),
  JSON.stringify({ synthetic: true, snapshotId: snapshot.id, digest: snapshot.digest }, null, 2),
  { mode: 0o600 },
);

console.info(
  JSON.stringify({ synthetic: true, activationSnapshotReady: true, blockers: snapshot.blockers }),
);
