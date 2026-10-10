import * as Documents from "@open-erp/contracts/document-signatures";
import * as Presence from "@open-erp/contracts/presence";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { documents, signingFixture } from "./support/document-signing";
import {
  apiDirectory,
  database,
  decoded,
  environment,
  failure,
  key,
  request,
  run,
  type BookFixture,
} from "./support/fixtures";
import { SoftwareAuthenticator } from "./support/software-authenticator";

// ADR 0020 presence proof. The failure contract precedes this journey in the ADR.
// The seam is HTTP into the real Worker and PostgreSQL. The authenticator is a
// software WebAuthn authenticator; database access is limited to fixture setup,
// failure injection (policy, revocation, expiry) and independent observation.

type Context = Awaited<ReturnType<typeof signingFixture>>;

const origin = () => new URL(environment().baseUrl);

async function admin<T>(use: (client: Awaited<ReturnType<typeof database>>) => Promise<T>) {
  const client = await database();

  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

async function operatorConsole(...args: ReadonlyArray<string>) {
  const result = await run("bun", ["scripts/authority.ts", ...args], {
    cwd: apiDirectory,
    env: { ...process.env, DATABASE_ADMIN_URL: environment().adminUrl },
  });

  return result.stdout.trim();
}

async function rows(sql: string, values: ReadonlyArray<string>) {
  return admin(async (client) => Number((await client.query(sql, [...values])).rows[0]?.count));
}

const intentCount = (bookId: string) =>
  rows("SELECT count(*) FROM openerp.document_signature_intents WHERE book_id = $1", [bookId]);

const consumptionCount = (bookId: string) =>
  rows(
    `SELECT count(*) FROM openerp.presence_consumptions u
    JOIN openerp.presence_challenges c ON c.id = u.challenge_id WHERE c.book_id = $1`,
    [bookId],
  );

// The server's WebAuthn options carry the challenge the authenticator signs.
function challengeOf(options: { readonly [key: string]: unknown }) {
  const value = options.challenge;

  if (typeof value !== "string") throw new Error("WebAuthn options carry no challenge");

  return value;
}

function enrollment(book: BookFixture, path: string, body: unknown) {
  return fetch(`${environment().baseUrl}/api/v1/presence/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${book.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function enroll(book: BookFixture, authenticator: SoftwareAuthenticator, ticket: string) {
  const challenge = await decoded(
    await enrollment(book, "enrollment-challenges", { ticket }),
    Presence.EnrollmentChallenge,
  );

  return enrollment(book, "authenticators", {
    challengeId: challenge.id,
    ticket,
    response: authenticator.register({ challenge: challengeOf(challenge.options) }),
  });
}

function intentRequest(context: Context, idempotencyKey: string) {
  return { manifestId: context.manifest.id, signerId: context.book.actorId, idempotencyKey };
}

function createIntent(context: Context, intent: ReturnType<typeof intentRequest>) {
  return request(context.book, `${documents}/signature-intents`, {
    method: "POST",
    headers: { "idempotency-key": intent.idempotencyKey },
    body: JSON.stringify({ manifestId: intent.manifestId, signerId: intent.signerId }),
  });
}

async function challenge(
  book: BookFixture,
  intent: ReturnType<typeof intentRequest>,
  gesture: typeof Presence.PresenceGesture.Type = "prepare_document_signature",
) {
  return request(book, "/presence/challenges", {
    method: "POST",
    body: JSON.stringify({
      gesture,
      subject: {
        idempotencyKey: intent.idempotencyKey,
        id: null,
        input: { manifestId: intent.manifestId, signerId: intent.signerId },
      },
    }),
  });
}

async function prove(
  context: Context,
  authenticator: SoftwareAuthenticator,
  intent: ReturnType<typeof intentRequest>,
  gesture?: typeof Presence.PresenceGesture.Type,
) {
  const issued = await decoded(
    await challenge(context.book, intent, gesture),
    Presence.PresenceChallenge,
  );

  return {
    issued,
    response: await request(context.book, `/presence/challenges/${issued.id}/assertion`, {
      method: "POST",
      body: JSON.stringify({
        response: authenticator.assert({ challenge: challengeOf(issued.options) }),
      }),
    }),
  };
}

test("presence off leaves an operator session's signature intent unchanged", async () => {
  const context = await signingFixture();

  await decoded(
    await createIntent(context, intentRequest(context, key())),
    Documents.DocumentSignatureIntent,
  );
  expect(await intentCount(context.book.bookId)).toBe(1);
});

test("presence proof binds one person, session and exact request to one signature gesture", async () => {
  const context = await signingFixture();
  const { hostname } = origin();
  const authenticator = new SoftwareAuthenticator(origin().origin, hostname);
  const observations: Array<{ readonly step: string; readonly status: number }> = [];

  const observe = async (step: string, response: Response, status: number, code?: string) => {
    observations.push({ step, status: response.status });

    if (code === undefined) expect(response.status).toBe(status);
    else await failure(response, status, code as Parameters<typeof failure>[2]);
  };

  expect(await operatorConsole("policy", context.book.bookId, "required", "off")).toContain(
    "presence required",
  );

  // Enforcement on and no proof: refused before any record.
  const first = intentRequest(context, key());
  await observe("no proof", await createIntent(context, first), 403, "PresenceRequired");
  expect(await intentCount(context.book.bookId)).toBe(0);

  // An API credential has no presence and cannot request a challenge.
  await observe(
    "api credential challenge",
    await challenge(context.credential, first),
    403,
    "Forbidden",
  );

  // A session alone cannot enroll: no ticket, a forged ticket, or another actor's ticket.
  await observe(
    "forged ticket",
    await enrollment(context.book, "enrollment-challenges", { ticket: "x".repeat(48) }),
    403,
    "Forbidden",
  );
  const foreign = await operatorConsole("presence-ticket", context.reviewer.actorId);
  await observe(
    "another actor's ticket",
    await enrollment(context.book, "enrollment-challenges", { ticket: foreign }),
    403,
    "Forbidden",
  );

  // No enrolled authenticator yet: challenge refused with the enrollment hint.
  await observe(
    "unenrolled challenge",
    await challenge(context.book, first),
    403,
    "PresenceRequired",
  );

  // The operator console mints a one-time ticket; it enrolls exactly once.
  const ticket = await operatorConsole("presence-ticket", context.book.actorId);

  const enrolled = await decoded(
    await enroll(context.book, authenticator, ticket),
    Presence.EnrolledAuthenticator,
  );

  expect(enrolled.credentialId).toBe(authenticator.id);
  await observe(
    "ticket reuse",
    await enrollment(context.book, "enrollment-challenges", { ticket }),
    403,
    "Forbidden",
  );

  // A proof for request A does not admit request B.
  const proofA = await prove(context, authenticator, first);
  await decoded(proofA.response, Presence.PresenceProof);
  const second = intentRequest(context, key());
  await observe(
    "proof for another request",
    await createIntent(context, second),
    403,
    "PresenceRequired",
  );

  // A proof bound to another gesture does not admit this one.
  const filingProof = await prove(context, authenticator, second, "authorize_filing");
  await decoded(filingProof.response, Presence.PresenceProof);
  await observe(
    "proof for another gesture",
    await createIntent(context, second),
    403,
    "PresenceRequired",
  );

  // A failing gesture rolls its consumption back: a request whose signer is not a
  // required signer is refused after the proof check.
  const outsider = { ...intentRequest(context, key()), signerId: "actor_not_a_signer" };
  await decoded((await prove(context, authenticator, outsider)).response, Presence.PresenceProof);
  const refused = await createIntent(context, outsider);
  expect(refused.status).toBeGreaterThanOrEqual(400);
  observations.push({ step: "rolled back gesture", status: refused.status });
  expect(await consumptionCount(context.book.bookId)).toBe(0);

  // Request A with its proof succeeds once; its unchanged replay returns the same
  // record; the same input under a new key needs a new proof.
  const created = await decoded(
    await createIntent(context, first),
    Documents.DocumentSignatureIntent,
  );

  const replayed = await decoded(
    await createIntent(context, first),
    Documents.DocumentSignatureIntent,
  );

  expect(replayed.id).toBe(created.id);
  await observe(
    "proof reuse under a new key",
    await createIntent(context, { ...first, idempotencyKey: key() }),
    403,
    "PresenceRequired",
  );
  expect(await intentCount(context.book.bookId)).toBe(1);
  expect(await consumptionCount(context.book.bookId)).toBe(1);

  // Verification refusals: no user verification, an unenrolled key, a counter
  // that does not advance, and an expired challenge.
  const third = intentRequest(context, key());

  const unverified = await decoded(
    await challenge(context.book, third),
    Presence.PresenceChallenge,
  );

  await observe(
    "no user verification",
    await request(context.book, `/presence/challenges/${unverified.id}/assertion`, {
      method: "POST",
      body: JSON.stringify({
        response: authenticator.assert(
          { challenge: challengeOf(unverified.options) },
          { userVerified: false },
        ),
      }),
    }),
    403,
    "Forbidden",
  );

  const stranger = new SoftwareAuthenticator(origin().origin, hostname);

  const strangerChallenge = await decoded(
    await challenge(context.book, third),
    Presence.PresenceChallenge,
  );

  await observe(
    "unenrolled key",
    await request(context.book, `/presence/challenges/${strangerChallenge.id}/assertion`, {
      method: "POST",
      body: JSON.stringify({
        response: stranger.assert({ challenge: challengeOf(strangerChallenge.options) }),
      }),
    }),
    403,
    "Forbidden",
  );

  const cloned = await decoded(await challenge(context.book, third), Presence.PresenceChallenge);
  await observe(
    "counter did not advance",
    await request(context.book, `/presence/challenges/${cloned.id}/assertion`, {
      method: "POST",
      body: JSON.stringify({
        response: authenticator.assert({ challenge: challengeOf(cloned.options) }, { counter: 1 }),
      }),
    }),
    403,
    "Forbidden",
  );

  const expired = await decoded(await challenge(context.book, third), Presence.PresenceChallenge);
  await admin(async (client) => {
    await client.query("SET session_replication_role = replica");
    await client.query(
      "UPDATE openerp.presence_challenges SET expires_at = created_at + interval '1 millisecond' WHERE id = $1",
      [expired.id],
    );
  });
  await observe(
    "expired challenge",
    await request(context.book, `/presence/challenges/${expired.id}/assertion`, {
      method: "POST",
      body: JSON.stringify({
        response: authenticator.assert({ challenge: challengeOf(expired.options) }),
      }),
    }),
    403,
    "Forbidden",
  );

  // A verified but unconsumed proof stops working when its key is revoked.
  await decoded((await prove(context, authenticator, third)).response, Presence.PresenceProof);
  await admin((client) =>
    client.query(
      "INSERT INTO openerp.presence_authenticator_revocations(credential_id) VALUES ($1)",
      [authenticator.id],
    ),
  );
  await observe("revoked key", await createIntent(context, third), 403, "PresenceRequired");
  expect(await intentCount(context.book.bookId)).toBe(1);

  await writeFile(
    join(environment().artifacts, "presence-proof.json"),
    JSON.stringify(
      {
        bookId: context.book.bookId,
        gesture: "prepare_document_signature",
        intentId: created.id,
        consumptions: await consumptionCount(context.book.bookId),
        observations,
      },
      null,
      2,
    ),
  );
});
