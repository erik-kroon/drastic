import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Database, databaseLayer } from "../src/db/connection";
import { actors } from "../src/db/schema";
import { account, user } from "../src/db/auth-schema";

class UserSetupError extends Schema.TaggedError<UserSetupError>()("UserSetupError", {
  message: Schema.String,
}) {}

const actorId = process.argv[2];

const connectionString = process.env.DATABASE_ADMIN_URL;

const email = process.env.OPENERP_EMAIL?.trim().toLowerCase();

const password = process.env.OPENERP_PASSWORD;

if (!actorId || process.argv.length !== 3 || !connectionString || !email || !password) {
  throw new Error(
    "Set DATABASE_ADMIN_URL, OPENERP_EMAIL and OPENERP_PASSWORD, then run bun scripts/create-user.ts <existing-actor-id>.",
  );
}

if (
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
  email.length > 254 ||
  password.length < 12 ||
  password.length > 128
) {
  throw new Error("Use a valid email address and a password of 12–128 characters.");
}

const passwordHash = await hashPassword(password);

await Effect.runPromise(
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const [actor] = yield* tx.select().from(actors).where(eq(actors.id, actorId));

        if (!actor)
          return yield* new UserSetupError({
            message: "Provision the actor and book access before creating a sign-in account.",
          });
        yield* tx.insert(user).values({ id: actor.id, name: actor.name, email });
        yield* tx.insert(account).values({
          id: crypto.randomUUID(),
          accountId: actor.id,
          providerId: "credential",
          userId: actor.id,
          password: passwordHash,
        });
      }),
    );
  }).pipe(
    Effect.provide(
      databaseLayer({
        connectionString: Redacted.make(connectionString),
        applicationName: "openerp-create-user",
        connectTimeoutMs: 10000,
        statementTimeoutMs: 15000,
      }),
    ),
    Effect.mapError(
      () =>
        new UserSetupError({
          message:
            "Account creation failed. Check that the actor exists and that its user and email are not already registered.",
        }),
    ),
  ),
);

console.info("Created the sign-in account. Existing book memberships are unchanged.");
