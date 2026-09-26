import * as Accounting from "@open-erp/contracts/accounting";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { credentials, identityAdmissions, memberships, books } from "./schema";
import { session } from "./auth-schema";
import { failure } from "../application/failures";
import type { Transaction } from "./transaction";

const CredentialRow = Schema.Struct({
  actorId: Schema.String,
  expiresAt: Schema.String,
  revokedAt: Schema.NullOr(Schema.String),
});

const SessionRow = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  expiresAt: Schema.String,
});

const IdentityRow = Schema.Struct({
  enabled: Schema.Boolean,
});

const MembershipRow = Schema.Struct({
  role: Schema.Literals(["operator", "agent"]),
});

const BookRow = Schema.Struct({
  id: Schema.String,
  entityId: Schema.String,
});

const DatabaseTime = Schema.Struct({
  now: Schema.String,
});

export type AccessCredential = {
  readonly token: string;
};

export type AuthorityRequirement = {
  readonly operatorOnly: boolean;
};

export type AuthorityLockMode = "share" | "update";

export type VerifiedPrincipal =
  | {
      readonly actorId: string;
      readonly kind: "apiCredential";
      readonly credentialHash: string;
    }
  | {
      readonly actorId: string;
      readonly kind: "betterAuthSession";
      readonly sessionId: string;
    };

type LockedAuthority =
  | {
      readonly actorId: string;
      readonly kind: "apiCredential";
      readonly credentialHash: string;
      readonly expiresAt: string;
      readonly revokedAt: string | null;
    }
  | {
      readonly actorId: string;
      readonly kind: "betterAuthSession";
      readonly sessionId: string;
      readonly expiresAt: string;
      readonly revokedAt: null;
    };

function decodeOne<A>(schema: Schema.Decoder<A>, value: unknown) {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

function hashToken(token: string) {
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

function lockCredential(transaction: Transaction, credentialHash: string) {
  return transaction
    .select({
      actorId: credentials.actorId,
      expiresAt: credentials.expiresAt,
      revokedAt: credentials.revokedAt,
    })
    .from(credentials)
    .where(and(eq(credentials.tokenHash, credentialHash), isNull(credentials.revokedAt)))
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

function lockMembership(transaction: Transaction, actorId: string, bookId: string) {
  return transaction
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.actorId, actorId), eq(memberships.bookId, bookId)))
    .for("share");
}

function lockAdmission(transaction: Transaction, actorId: string) {
  return transaction
    .select({ enabled: identityAdmissions.enabled })
    .from(identityAdmissions)
    .where(eq(identityAdmissions.actorId, actorId))
    .for("share");
}

function lockBook(
  transaction: Transaction,
  scope: typeof Accounting.Scope.Type,
  lockMode: AuthorityLockMode,
) {
  const query = transaction
    .select({ id: books.id, entityId: books.entityId })
    .from(books)
    .where(and(eq(books.id, scope.bookId), eq(books.entityId, scope.entityId)));

  return lockMode === "update" ? query.for("update") : query.for("share");
}

function readDatabaseTime(transaction: Transaction) {
  return transaction
    .execute(sql`select clock_timestamp() as now`, "objects")
    .pipe(Effect.flatMap((rows) => decodeOne(DatabaseTime, rows[0])));
}

function expiryIsCurrent(expiresAt: string, now: string) {
  const expiry = Date.parse(expiresAt);
  const current = Date.parse(now);

  return Number.isFinite(expiry) && Number.isFinite(current) && expiry > current;
}

function verifyAuthority(
  authority: LockedAuthority,
  scope: typeof Accounting.Scope.Type,
  requirement: AuthorityRequirement,
  lockMode: AuthorityLockMode,
  transaction: Transaction,
) {
  return Effect.gen(function* () {
    const admissionRows = yield* lockAdmission(transaction, authority.actorId);

    const admission = admissionRows[0]
      ? yield* decodeOne(IdentityRow, admissionRows[0])
      : undefined;

    if (admission?.enabled === false) return yield* failure("Unauthorized");

    const membershipRows = yield* lockMembership(transaction, authority.actorId, scope.bookId);

    const membership = membershipRows[0]
      ? yield* decodeOne(MembershipRow, membershipRows[0])
      : undefined;

    if (!membership || (requirement.operatorOnly && membership.role !== "operator")) {
      return yield* failure("Forbidden");
    }

    const bookRows = yield* lockBook(transaction, scope, lockMode);

    if (!bookRows[0]) return yield* failure("Forbidden");
    yield* decodeOne(BookRow, bookRows[0]);

    const databaseTime = yield* readDatabaseTime(transaction);

    if (authority.revokedAt !== null || !expiryIsCurrent(authority.expiresAt, databaseTime.now)) {
      return yield* failure("Unauthorized");
    }

    if (authority.kind === "apiCredential") {
      return {
        actorId: authority.actorId,
        kind: authority.kind,
        credentialHash: authority.credentialHash,
      } satisfies VerifiedPrincipal;
    }

    return {
      actorId: authority.actorId,
      kind: authority.kind,
      sessionId: authority.sessionId,
    } satisfies VerifiedPrincipal;
  });
}

export function admitPrincipal(
  transaction: Transaction,
  access: AccessCredential,
  scope: typeof Accounting.Scope.Type,
  requirement: AuthorityRequirement,
  lockMode: AuthorityLockMode,
) {
  return Effect.gen(function* () {
    if (access.token.length < 32 || access.token.length > 512) {
      return yield* failure("Unauthorized");
    }

    const credentialHash = yield* hashToken(access.token);
    const credentialRows = yield* lockCredential(transaction, credentialHash);

    if (credentialRows[0]) {
      const credential = yield* decodeOne(CredentialRow, credentialRows[0]);
      const credentialTime = yield* readDatabaseTime(transaction);

      if (expiryIsCurrent(credential.expiresAt, credentialTime.now)) {
        return yield* verifyAuthority(
          {
            actorId: credential.actorId,
            kind: "apiCredential",
            credentialHash,
            expiresAt: credential.expiresAt,
            revokedAt: credential.revokedAt,
          },
          scope,
          requirement,
          lockMode,
          transaction,
        );
      }
    }

    const sessionRows = yield* lockSession(transaction, access.token);

    if (!sessionRows[0]) return yield* failure("Unauthorized");
    const browserSession = yield* decodeOne(SessionRow, sessionRows[0]);
    const sessionTime = yield* readDatabaseTime(transaction);

    if (!expiryIsCurrent(browserSession.expiresAt, sessionTime.now)) {
      return yield* failure("Unauthorized");
    }

    return yield* verifyAuthority(
      {
        actorId: browserSession.userId,
        kind: "betterAuthSession",
        sessionId: browserSession.id,
        expiresAt: browserSession.expiresAt,
        revokedAt: null,
      },
      scope,
      requirement,
      lockMode,
      transaction,
    );
  });
}

export function recheckPrincipal(
  transaction: Transaction,
  principal: VerifiedPrincipal,
  scope: typeof Accounting.Scope.Type,
  requirement: AuthorityRequirement,
  lockMode: AuthorityLockMode,
) {
  return Effect.gen(function* () {
    if (principal.kind === "apiCredential") {
      const rows = yield* lockCredential(transaction, principal.credentialHash);

      if (!rows[0]) return yield* failure("Unauthorized");
      const credential = yield* decodeOne(CredentialRow, rows[0]);

      if (credential.actorId !== principal.actorId) return yield* failure("Unauthorized");

      return yield* verifyAuthority(
        {
          actorId: credential.actorId,
          kind: principal.kind,
          credentialHash: principal.credentialHash,
          expiresAt: credential.expiresAt,
          revokedAt: credential.revokedAt,
        },
        scope,
        requirement,
        lockMode,
        transaction,
      );
    }

    const rows = yield* transaction
      .select({
        id: session.id,
        userId: session.userId,
        expiresAt: sql<string>`${session.expiresAt}`.as("expiresAt"),
      })
      .from(session)
      .where(and(eq(session.id, principal.sessionId), eq(session.userId, principal.actorId)))
      .for("share");

    if (!rows[0]) return yield* failure("Unauthorized");
    const browserSession = yield* decodeOne(SessionRow, rows[0]);

    return yield* verifyAuthority(
      {
        actorId: browserSession.userId,
        kind: principal.kind,
        sessionId: browserSession.id,
        expiresAt: browserSession.expiresAt,
        revokedAt: null,
      },
      scope,
      requirement,
      lockMode,
      transaction,
    );
  });
}
