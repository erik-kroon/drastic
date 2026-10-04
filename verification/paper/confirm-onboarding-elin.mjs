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

const snapshot = material.snapshots
  .filter((item) => item.current && item.snapshot.purpose === "activation")
  .sort((a, b) => b.snapshot.capturedAt.localeCompare(a.snapshot.capturedAt))[0]?.snapshot;

if (!snapshot || snapshot.blockers.length || !material.operationalProof || material.activation)
  throw new Error("Require the actual retained current restore proof before confirmation.");

const confirmation = await request("/onboarding/decisions", {
  snapshotId: snapshot.id,
  expectedDigest: snapshot.digest,
  decision: {
    kind: "confirm_activation",
    reason: "Elin confirms the independently restored and fenced synthetic boundary",
  },
});

const after = await request("/onboarding/lifecycle");

if (
  after.activation ||
  !after.decisions.some((item) => item.id === confirmation.id && item.actorName === "Elin Sund")
)
  throw new Error("Confirmation must not activate accounting.");

await writeFile(
  join(dirname(file), "onboarding-first-confirmation.json"),
  JSON.stringify({ synthetic: true, confirmation, activated: false }, null, 2),
  { mode: 0o600 },
);

console.info(
  JSON.stringify({
    synthetic: true,
    confirmedBy: confirmation.actorName,
    confirmedAt: confirmation.recordedAt,
    waitingFor: "Sara Lind",
    activated: false,
  }),
);
