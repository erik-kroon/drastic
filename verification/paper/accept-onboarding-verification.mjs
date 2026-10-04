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

const elin = await login(session.email, session.password);

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

const lifecycle = await request("/onboarding/lifecycle");

const snapshot = lifecycle.snapshots
  .filter((item) => item.current && item.snapshot.purpose === "book_zero")
  .toSorted((a, b) => b.snapshot.capturedAt.localeCompare(a.snapshot.capturedAt))[0]?.snapshot;

if (!snapshot || snapshot.blockers.length || lifecycle.activation)
  throw new Error("Current unactivated verification required.");

const accepted = [];

for (const limitation of ["missing_historical_originals", "unreconciled_bank_difference"]) {
  if (
    lifecycle.decisions.some(
      (item) =>
        item.snapshotId === snapshot.id &&
        item.decision.kind === "accept_limitation" &&
        item.decision.limitation === limitation,
    )
  )
    throw new Error("Already accepted.");

  const decision = await request("/onboarding/decisions", {
    snapshotId: snapshot.id,
    expectedDigest: snapshot.digest,
    decision: {
      kind: "accept_limitation",
      limitation,
      reason:
        limitation === "missing_historical_originals"
          ? "Twelve missing historical originals remain an explicit synthetic onboarding limitation."
          : "The retained bank-side outflow explains the difference but is not reconciled; the limitation remains explicit.",
    },
  });

  accepted.push({ limitation, actorName: decision.actorName, recordedAt: decision.recordedAt });
}

await writeFile(
  join(dirname(file), "onboarding-verification-acceptance.json"),
  JSON.stringify({ synthetic: true, accepted }, null, 2),
  { mode: 0o600 },
);

console.info(JSON.stringify({ synthetic: true, accepted }));
