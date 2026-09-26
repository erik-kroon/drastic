import { authConfiguration } from "./configuration";
import { oidcPlugin } from "./oidc";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth/minimal";
import { drizzle } from "drizzle-orm/node-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { failure } from "../../application/failures";
import { type Bindings } from "../../runtime/environment";
import { acquirePostgres } from "../../db/connection";
import * as schema from "../../db/auth-schema";

export function makeAuth(bindings: Bindings, includeProviders = true) {
  return Effect.gen(function* () {
    const connectionString = bindings.HYPERDRIVE?.connectionString || bindings.DATABASE_URL;
    const secret = bindings.BETTER_AUTH_SECRET;
    const baseURL = bindings.BETTER_AUTH_URL;

    if (!connectionString || !secret || secret.length < 32 || !baseURL) {
      return yield* failure("Unavailable");
    }

    const config = yield* authConfiguration(bindings);
    const { url, local } = config;

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
      databaseHooks: {
        session: {
          create: {
            before: async (session) => {
              const admission = await client.query<{ enabled: boolean }>(
                "select enabled from openerp.identity_admissions where actor_id = $1",
                [session.userId],
              );

              return admission.rows[0]?.enabled !== false;
            },
          },
        },
      },
      emailAndPassword: {
        enabled: config.method === "password",
        disableSignUp: true,
        minPasswordLength: 12,
      },
      plugins: config.provider && includeProviders ? [oidcPlugin(config.provider)] : [],
      account: {
        accountLinking: { enabled: false, disableImplicitLinking: true },
        updateAccountOnSignIn: false,
      },
      session: {
        expiresIn: 60 * 60 * 8,
        disableSessionRefresh: true,
        cookieCache: { enabled: false },
      },
      // The OAuth state cookie must accompany the provider's top-level GET callback.
      // Session cookies remain Strict; the callback is bound by state, PKCE and nonce.
      rateLimit: { enabled: true, storage: "database", window: 60, max: 100 },
      advanced: {
        cookiePrefix: "openerp",
        cookies: {
          state: { attributes: { sameSite: "lax" } },
          oauth_state: { attributes: { sameSite: "lax" } },
        },
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
  if (request.method === "GET" && new URL(request.url).pathname === "/api/auth/configuration") {
    return authConfiguration(bindings).pipe(
      Effect.map((config) =>
        Response.json({ method: config.method, providerId: config.provider?.providerId ?? null }),
      ),
      Effect.orElseSucceed(() =>
        Response.json({ message: "Sign-in is not configured." }, { status: 503 }),
      ),
    );
  }

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
