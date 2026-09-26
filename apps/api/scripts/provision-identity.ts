import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { IdentityProvisioning } from "@open-erp/contracts/identity";
import { Database, databaseLayer } from "../src/db/connection";
import {
  actors,
  books,
  memberships,
  identityAdmissions,
  identityProvisioningReceipts,
} from "../src/db/schema";
import { account, session, user } from "../src/db/auth-schema";
import { oidcProviderId } from "../src/adapters/auth/configuration";

class IdentitySetupError extends Schema.TaggedError<IdentitySetupError>()("IdentitySetupError", {
  message: Schema.String,
}) {}

const [mode, path] = process.argv.slice(2);

if ((mode !== "plan" && mode !== "apply") || !path || process.argv.length !== 4)
  throw new Error("Usage: bun scripts/provision-identity.ts plan|apply <reviewed-manifest.json>");

const manifest = Schema.decodeSync(Schema.fromJsonString(IdentityProvisioning))(
  await readFile(path, "utf8"),
  { onExcessProperty: "error" },
);

const issuer = new URL(manifest.issuer);

if (
  issuer.protocol !== "https:" ||
  issuer.username ||
  issuer.password ||
  issuer.search ||
  issuer.hash
)
  throw new Error("Supply the exact HTTPS issuer from the provider registration.");

if (manifest.email !== manifest.email.trim().toLowerCase() || !manifest.name.trim())
  throw new Error("Use a normalized email and a non-empty name.");

if (new Set(manifest.grants.map((grant) => grant.scope.bookId)).size !== manifest.grants.length)
  throw new Error("Each book may occur once in the manifest.");

const providerId = await oidcProviderId(manifest.issuer, manifest.clientId);

if (mode === "plan") {
  console.info(
    JSON.stringify(
      {
        requestId: manifest.requestId,
        actorId: manifest.actorId,
        providerId,
        enabled: manifest.enabled,
        grants: manifest.grants,
        sessionEffect: "Applying a new request revokes all existing sessions for this actor.",
        identity:
          "Only the explicit issuer, client registration and subject can sign in. No email matching or automatic book grants.",
      },
      null,
      2,
    ),
  );
} else {
  const connectionString = process.env.DATABASE_ADMIN_URL;

  if (!connectionString)
    throw new Error("Set DATABASE_ADMIN_URL for the reviewed apply operation.");
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      yield* db.transaction((tx) =>
        Effect.gen(function* () {
          // Serialize operator provisioning before taking session and membership locks.
          yield* tx
            .insert(actors)
            .values({ id: manifest.actorId, name: manifest.name })
            .onConflictDoNothing();

          const [actor] = yield* tx
            .select()
            .from(actors)
            .where(eq(actors.id, manifest.actorId))
            .for("update");

          if (!actor) return yield* new IdentitySetupError({ message: "Actor not available." });

          const [prior] = yield* tx
            .select()
            .from(identityProvisioningReceipts)
            .where(eq(identityProvisioningReceipts.requestId, manifest.requestId));

          if (prior) {
            const matches =
              (yield* Schema.encodeEffect(Schema.fromJsonString(IdentityProvisioning))(
                prior.manifest,
              )) ===
              (yield* Schema.encodeEffect(Schema.fromJsonString(IdentityProvisioning))(manifest));

            if (!matches)
              return yield* new IdentitySetupError({
                message: "Request ID already used with different details.",
              });

            return;
          }

          const [human] = yield* tx.select().from(user).where(eq(user.id, manifest.actorId));

          if (human && human.email !== manifest.email)
            return yield* new IdentitySetupError({
              message:
                "Existing actor has a different email. Identity remapping requires a separate reviewed migration.",
            });

          if (!human)
            yield* tx.insert(user).values({
              id: manifest.actorId,
              name: manifest.name,
              email: manifest.email,
              emailVerified: false,
            });

          const [binding] = yield* tx
            .select()
            .from(account)
            .where(
              and(eq(account.providerId, providerId), eq(account.accountId, manifest.subject)),
            );

          if (binding && binding.userId !== manifest.actorId)
            return yield* new IdentitySetupError({
              message: "Provider subject already belongs to another actor.",
            });

          const otherBindings = yield* tx
            .select()
            .from(account)
            .where(eq(account.userId, manifest.actorId));

          if (
            otherBindings.some(
              (item) =>
                item.providerId !== "credential" &&
                (item.providerId !== providerId || item.accountId !== manifest.subject),
            )
          )
            return yield* new IdentitySetupError({
              message:
                "This actor has another provider binding. Rebinding requires a separate reviewed migration.",
            });
          // Revoke sessions first: admission holds session before book membership locks.
          yield* tx.delete(session).where(eq(session.userId, manifest.actorId));

          const [admission] = yield* tx
            .select()
            .from(identityAdmissions)
            .where(eq(identityAdmissions.actorId, manifest.actorId));

          if (
            admission &&
            (admission.providerId !== providerId || admission.subject !== manifest.subject)
          )
            return yield* new IdentitySetupError({
              message: "The actor already has a different immutable identity admission.",
            });

          if (admission)
            yield* tx
              .update(identityAdmissions)
              .set({ enabled: manifest.enabled })
              .where(eq(identityAdmissions.actorId, manifest.actorId));
          else
            yield* tx.insert(identityAdmissions).values({
              actorId: manifest.actorId,
              providerId,
              subject: manifest.subject,
              enabled: manifest.enabled,
            });

          if (!binding)
            yield* tx.insert(account).values({
              id: crypto.randomUUID(),
              providerId,
              accountId: manifest.subject,
              userId: manifest.actorId,
            });

          for (const grant of [...manifest.grants].sort((a, b) =>
            a.scope.bookId.localeCompare(b.scope.bookId),
          )) {
            const [book] = yield* tx
              .select()
              .from(books)
              .where(
                and(eq(books.id, grant.scope.bookId), eq(books.entityId, grant.scope.entityId)),
              );

            if (!book)
              return yield* new IdentitySetupError({
                message: "A reviewed company/book scope does not exist.",
              });

            const where = and(
              eq(memberships.bookId, grant.scope.bookId),
              eq(memberships.actorId, manifest.actorId),
            );

            const [current] = yield* tx.select().from(memberships).where(where).for("update");

            if ((current?.role ?? null) !== grant.expectedRole)
              return yield* new IdentitySetupError({
                message:
                  "A book membership changed after review. Update expectedRole before applying.",
              });

            if (grant.role === null) yield* tx.delete(memberships).where(where);
            else if (current) yield* tx.update(memberships).set({ role: grant.role }).where(where);
            else
              yield* tx.insert(memberships).values({
                actorId: manifest.actorId,
                bookId: grant.scope.bookId,
                role: grant.role,
              });
          }

          yield* tx
            .insert(identityProvisioningReceipts)
            .values({ requestId: manifest.requestId, manifest });
        }),
      );
    }).pipe(
      Effect.provide(
        databaseLayer({
          connectionString: Redacted.make(connectionString),
          applicationName: "openerp-provision-identity",
          connectTimeoutMs: 10000,
          statementTimeoutMs: 15000,
        }),
      ),
      Effect.mapError(
        () =>
          new IdentitySetupError({
            message:
              "Identity admission failed. Check the reviewed identity, request ID and expected book roles. No changes were committed.",
          }),
      ),
    ),
  );
  console.info(
    "Applied the reviewed identity mapping and explicit book changes. Previous browser sessions are revoked.",
  );
}
