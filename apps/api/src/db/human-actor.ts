import { eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { session } from "./auth-schema";
import { credentials, identityAdmissions } from "./schema";
import { failure } from "../application/failures";
import { readDatabaseTime } from "./posting";
import type { Transaction } from "./transaction";

const SessionRow = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  expiresAt: Schema.String,
});

const CredentialRow = Schema.Struct({
  actorId: Schema.String,
  expiresAt: Schema.String,
  revokedAt: Schema.NullOr(Schema.String),
});

const AdmissionRow = Schema.Struct({ enabled: Schema.Boolean });

export type HumanActor = {
  readonly actorId: string;
  readonly kind: "betterAuthSession";
  readonly sessionId: string;
};

export function hashToken(token: string) {
  return Effect.tryPromise({
    try: async () => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      );
    },
    catch: () => failure("Unavailable"),
  });
}

function decodeOne<A>(schema: Schema.Decoder<A>, value: unknown) {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

function expiryIsCurrent(expiresAt: string, now: string) {
  const expiry = Date.parse(expiresAt);
  const current = Date.parse(now);
  return Number.isFinite(expiry) && Number.isFinite(current) && expiry > current;
}

function lockCredential(transaction: Transaction, credentialHash: string) {
  return transaction
    .select({
      actorId: credentials.actorId,
      expiresAt: credentials.expiresAt,
      revokedAt: credentials.revokedAt,
    })
    .from(credentials)
    .where(eq(credentials.tokenHash, credentialHash))
    .for("share");
}

function lockSession(transaction: Transaction, token: string) {
  return transaction
    .select({
      id: session.id,
      userId: session.userId,
      expiresAt: sql<string>`${session.expiresAt}`.as("expiresAt"),
    })
    .from(session)
    .where(eq(session.token, token))
    .for("share");
}

function lockAdmission(transaction: Transaction, actorId: string) {
  return transaction
    .select({ enabled: identityAdmissions.enabled })
    .from(identityAdmissions)
    .where(eq(identityAdmissions.actorId, actorId))
    .for("share");
}

export function readAdmission(transaction: Transaction, actorId: string) {
  return lockAdmission(transaction, actorId);
}

// Company and firm workspaces are human coordination surfaces. They admit a
// provisioned browser session, not an API credential and not a book membership,
// because no book exists yet or no book grants the requested work.
export function admitHumanActor(transaction: Transaction, token: string) {
  return Effect.gen(function* () {
    if (token.length < 32 || token.length > 512) return yield* failure("Unauthorized");
    const credentialHash = yield* hashToken(token);
    const credentialRows = yield* lockCredential(transaction, credentialHash);
    const browserRows = yield* lockSession(transaction, token);
    const browser = browserRows[0] ? yield* decodeOne(SessionRow, browserRows[0]) : undefined;
    if (!credentialRows[0] && !browser) return yield* failure("Unauthorized");
    if (!browser) return yield* failure("Forbidden");
    if (credentialRows[0]) {
      const credential = yield* decodeOne(CredentialRow, credentialRows[0]);
      const credentialTime = yield* readDatabaseTime(transaction);
      if (
        credential.actorId !== browser.userId ||
        credential.revokedAt !== null ||
        !expiryIsCurrent(credential.expiresAt, credentialTime.now)
      ) {
        return yield* failure("Unauthorized");
      }
    }
    const browserTime = yield* readDatabaseTime(transaction);
    if (!expiryIsCurrent(browser.expiresAt, browserTime.now)) {
      return yield* failure("Unauthorized");
    }
    const admissionRows = yield* lockAdmission(transaction, browser.userId);
    const admission = admissionRows[0]
      ? yield* decodeOne(AdmissionRow, admissionRows[0])
      : undefined;
    if (admission?.enabled === false) return yield* failure("Unauthorized");
    return {
      actorId: browser.userId,
      kind: "betterAuthSession",
      sessionId: browser.id,
    } satisfies HumanActor;
  });
}

// Actor-scoped setup and firm command rows are keyed by (actor_id, key) rather
// than by book, so the actor row is the only stable serialization point that
// replaces the retired session advisory lock.
export function lockActor(transaction: Transaction, actorId: string) {
  return transaction.execute<{ readonly id: string }>(
    sql`select id from openerp.actors where id = ${actorId} for update`,
    "objects",
  );
}

// A book-scoped principal already resolved the presented token to a live browser
// session when its kind is a session. An API credential is never a human firm
// participant, even with a valid book grant.
export function requireHumanSession(principal: {
  readonly kind: "apiCredential" | "betterAuthSession";
}) {
  return principal.kind === "betterAuthSession" ? Effect.void : failure("Forbidden");
}
