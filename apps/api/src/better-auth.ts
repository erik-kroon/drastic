import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth/minimal";
import { drizzle } from "drizzle-orm/node-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { failure, type Bindings } from "./database";
import { acquirePostgres } from "./db/connection";
import * as schema from "./db/auth-schema";

export function makeAuth(bindings: Bindings) {
  return Effect.gen(function* () {
    const connectionString = bindings.HYPERDRIVE?.connectionString || bindings.DATABASE_URL;
    const secret = bindings.BETTER_AUTH_SECRET;
    const baseURL = bindings.BETTER_AUTH_URL;
    if (!connectionString || !secret || secret.length < 32 || !baseURL) {
      return yield* failure("Unavailable");
    }
    const url = yield* Effect.try({
      try: () => new URL(baseURL),
      catch: () => failure("Unavailable"),
    });
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password
    ) {
      return yield* failure("Unavailable");
    }
    const client = yield* acquirePostgres({
      connectionString: Redacted.make(connectionString),
      applicationName: "open-erp-auth",
      connectTimeoutMs: 5000,
      statementTimeoutMs: 15000,
    }).pipe(Effect.mapError(() => failure("Unavailable")));

    // Better Auth expects Promise queries. Its official adapter shares our scoped pg lifecycle.
    return betterAuth({
      appName: "OpenERP",
      baseURL: url.origin,
      basePath: "/api/auth",
      secret,
      trustedOrigins: [url.origin],
      database: drizzleAdapter(drizzle({ client }), {
        provider: "pg",
        schema,
        transaction: true,
      }),
      emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
      session: {
        expiresIn: 60 * 60 * 8,
        disableSessionRefresh: true,
        cookieCache: { enabled: false },
      },
      rateLimit: { enabled: true, storage: "database", window: 60, max: 100 },
      advanced: {
        cookiePrefix: "openerp",
        useSecureCookies: !local,
        defaultCookieAttributes: { httpOnly: true, sameSite: "strict", path: "/" },
        ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      },
      // Adapter failures can contain bound credentials; never log their raw payloads.
      logger: { disabled: true },
    });
  });
}

export function authHandler(request: Request, bindings: Bindings) {
  return Effect.scoped(
    Effect.gen(function* () {
      const auth = yield* makeAuth(bindings);
      return yield* Effect.tryPromise({
        try: () => auth.handler(request),
        catch: () => failure("Unavailable"),
      });
    }),
  ).pipe(
    Effect.orElseSucceed(() =>
      Response.json({ message: "Sign-in is unavailable. Try again later." }, { status: 503 }),
    ),
  );
}
