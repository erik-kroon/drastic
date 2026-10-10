import { authConfiguration } from "./configuration";
import { oidcPlugin } from "./oidc";
import { oauthProvider, type OAuthOptions, type Scope } from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth/minimal";
import { drizzle } from "drizzle-orm/node-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { failure } from "../../application/failures";
import { type Bindings } from "../../runtime/environment";
import { acquirePostgres } from "../../db/connection";
import * as authSchema from "../../db/auth-schema";
import * as oauthSchema from "../../db/oauth-schema";

async function oauthTokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
    const oauthOptions: OAuthOptions<Scope[]> = {
      loginPage: "/login",
      consentPage: "/oauth/consent",
      scopes: ["openid", "offline_access", "mcp:read"],
      grantTypes: ["authorization_code", "refresh_token"],
      disableJwtPlugin: true,
      allowDynamicClientRegistration: false,
      allowUnauthenticatedClientRegistration: false,
      clientRegistrationRequirePKCE: true,
      resources: [
        {
          identifier: `${url.origin}/api/mcp`,
          allowedScopes: ["openid", "offline_access", "mcp:read"],
        },
      ],
      enforcePerClientResources: true,
      clientRegistrationDefaultResources: [`${url.origin}/api/mcp`],
      refreshTokenReuseInterval: 0,
      storeTokens: { hash: oauthTokenHash },
      postLogin: {
        page: "/oauth/select",
        shouldRedirect: async ({ session, scopes }) => {
          if (!scopes.includes("mcp:read")) return false;

          const selected = await client.query(
            "select session_id from openerp.oauth_agent_selections where session_id = $1",
            [session.id],
          );

          return selected.rowCount === 0;
        },
        consentReferenceId: async ({ user, session, scopes }) => {
          if (!scopes.includes("mcp:read")) return undefined;

          const selected = await client.query<{ id: string }>(
            `select grant_record.id
                     from openerp.oauth_agent_selections selection
                     join openerp.oauth_agent_grants grant_record on grant_record.id = selection.grant_id
                     join openerp.firm_clients client_book
                       on client_book.firm_id = grant_record.firm_id and client_book.book_id = grant_record.book_id
                     join openerp.firm_members firm_member
                       on firm_member.firm_id = grant_record.firm_id and firm_member.actor_id = grant_record.actor_id and firm_member.active
                     join openerp.memberships book_member
                       on book_member.book_id = grant_record.book_id and book_member.actor_id = grant_record.actor_id and book_member.role = 'operator'
                     where selection.session_id = $1 and grant_record.actor_id = $2
                       and not exists (select 1 from openerp.identity_admissions a where a.actor_id = grant_record.actor_id and not a.enabled)
                       and not exists (
                         select 1 from openerp.oauth_agent_revocations revocation
                         where revocation.grant_id = grant_record.id
                       )`,
            [session.id, user.id],
          );

          const grantId = selected.rows[0]?.id;

          if (!grantId)
            throw new APIError("FORBIDDEN", {
              message: "Choose a firm and book before consenting.",
            });

          return grantId;
        },
      },
    };

    const oauth = oauthProvider(oauthOptions);

    return betterAuth({
      appName: "Drastic",
      baseURL: url.origin,
      basePath: "/api/auth",
      secret,
      trustedOrigins: [url.origin],
      database: drizzleAdapter(drizzle({ client }), {
        provider: "pg",
        schema: { ...authSchema, ...oauthSchema },
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
      plugins: includeProviders
        ? [...(config.provider ? [oidcPlugin(config.provider)] : []), oauth]
        : [],
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

async function selectedOAuthGrant(request: Request, bindings: Bindings) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ message: "Forbidden" }, { status: 403 });

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const auth = yield* makeAuth(bindings);

        const session = yield* Effect.tryPromise({
          try: () =>
            auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } }),
          catch: () => failure("Unavailable"),
        });

        if (!session) return Response.json({ message: "Sign in" }, { status: 401 });
        const connectionString = bindings.HYPERDRIVE?.connectionString || bindings.DATABASE_URL;

        if (!connectionString) return Response.json({ message: "Unavailable" }, { status: 503 });

        const client = yield* acquirePostgres({
          connectionString: Redacted.make(connectionString),
          applicationName: "open-erp-oauth-selection-view",
          connectTimeoutMs: 5000,
          statementTimeoutMs: 15000,
        }).pipe(Effect.mapError(() => failure("Unavailable")));

        const result = yield* Effect.tryPromise({
          try: () =>
            client.query<{
              id: string;
              firmId: string;
              bookId: string;
              firmName: string;
              bookName: string;
              available: boolean;
            }>(
              `select g.id, g.firm_id as "firmId", g.book_id as "bookId", f.name as "firmName", b.name as "bookName",
          exists (
            select 1 from openerp.firm_members fm
            join openerp.firm_clients fc on fc.firm_id = fm.firm_id and fc.book_id = g.book_id
            join openerp.memberships m on m.book_id = g.book_id and m.actor_id = g.actor_id and m.role = 'operator'
            where fm.firm_id = g.firm_id and fm.actor_id = g.actor_id and fm.active
              and not exists (select 1 from openerp.identity_admissions a where a.actor_id = g.actor_id and not a.enabled)
              and not exists (select 1 from openerp.oauth_agent_revocations r where r.grant_id = g.id)
          ) as available
          from openerp.oauth_agent_selections s
          join openerp.oauth_agent_grants g on g.id = s.grant_id
          join openerp.firms f on f.id = g.firm_id join openerp.books b on b.id = g.book_id
          where s.session_id = $1 and g.actor_id = $2`,
              [session.session.id, session.user.id],
            ),
          catch: () => failure("Unavailable"),
        });

        return Response.json(
          { grant: result.rows[0] ?? null },
          { headers: { "cache-control": "no-store" } },
        );
      }),
    ).pipe(Effect.orElseSucceed(() => Response.json({ message: "Unavailable" }, { status: 503 }))),
  );
}

async function selectOAuthGrant(request: Request, bindings: Bindings) {
  const origin = bindings.BETTER_AUTH_URL ? new URL(bindings.BETTER_AUTH_URL).origin : null;

  if (
    !origin ||
    request.headers.get("origin") !== origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return Response.json({ message: "Forbidden" }, { status: 403 });

  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ message: "Invalid request" }, { status: 400 });
  const body: unknown = await request.json().catch(() => null);

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !("firmId" in body) ||
    !("bookId" in body)
  )
    return Response.json({ message: "Invalid request" }, { status: 400 });

  const { firmId, bookId } = body;

  if (
    typeof firmId !== "string" ||
    typeof bookId !== "string" ||
    firmId.length > 128 ||
    bookId.length > 128
  )
    return Response.json({ message: "Invalid request" }, { status: 400 });

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const auth = yield* makeAuth(bindings);

        const session = yield* Effect.tryPromise({
          try: () =>
            auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } }),
          catch: () => failure("Unavailable"),
        });

        if (!session)
          return Response.json({ message: "Sign in to choose a firm and book" }, { status: 401 });
        const connectionString = bindings.HYPERDRIVE?.connectionString || bindings.DATABASE_URL;

        if (!connectionString) return Response.json({ message: "Unavailable" }, { status: 503 });

        const client = yield* acquirePostgres({
          connectionString: Redacted.make(connectionString),
          applicationName: "open-erp-oauth-grant",
          connectTimeoutMs: 5000,
          statementTimeoutMs: 15000,
        }).pipe(Effect.mapError(() => failure("Unavailable")));

        const grantId = crypto.randomUUID();

        return yield* Effect.promise(async () => {
          try {
            await client.query("BEGIN");

            await client.query("select id from openerp.actors where id = $1 for share", [
              session.user.id,
            ]);

            const retainedSession = await client.query(
              "select id from openerp_auth.session where id = $1 and user_id = $2 and expires_at > clock_timestamp() for share",
              [session.session.id, session.user.id],
            );

            if (retainedSession.rowCount !== 1) {
              await client.query("ROLLBACK");

              return Response.json({ message: "Sign in" }, { status: 401 });
            }

            await client.query(
              "select enabled from openerp.identity_admissions where actor_id = $1 for share",
              [session.user.id],
            );

            const issued = await client.query<{ id: string }>(
              `insert into openerp.oauth_agent_grants (id, session_id, actor_id, firm_id, book_id)
         select $1, $2, $3, client_book.firm_id, client_book.book_id
         from openerp.firm_clients client_book
         join openerp.firm_members firm_member
           on firm_member.firm_id = client_book.firm_id and firm_member.actor_id = $3 and firm_member.active
         join openerp.memberships book_member
           on book_member.book_id = client_book.book_id and book_member.actor_id = $3 and book_member.role = 'operator'
         where client_book.firm_id = $4 and client_book.book_id = $5
           and not exists (select 1 from openerp.identity_admissions a where a.actor_id = $3 and not a.enabled)
         returning id`,
              [grantId, session.session.id, session.user.id, firmId, bookId],
            );

            if (!issued.rowCount) {
              await client.query("ROLLBACK");

              return Response.json({ message: "Firm and book access required" }, { status: 403 });
            }

            const selected = await client.query<{ grant_id: string }>(
              `insert into openerp.oauth_agent_selections (session_id, grant_id)
         values ($1, $2) on conflict (session_id) do nothing returning grant_id`,
              [session.session.id, grantId],
            );

            if (!selected.rowCount) {
              await client.query("ROLLBACK");

              return Response.json(
                { message: "Start a new sign-in for another grant" },
                { status: 409 },
              );
            }

            await client.query("COMMIT");

            return Response.json({ grantId, firmId, bookId }, { status: 201 });
          } catch {
            await client.query("ROLLBACK").catch(() => undefined);

            return Response.json({ message: "Unavailable" }, { status: 503 });
          }
        });
      }),
    ).pipe(Effect.orElseSucceed(() => Response.json({ message: "Unavailable" }, { status: 503 }))),
  );
}

async function revokeOAuthGrant(request: Request, bindings: Bindings) {
  const origin = bindings.BETTER_AUTH_URL ? new URL(bindings.BETTER_AUTH_URL).origin : null;

  if (
    !origin ||
    request.headers.get("origin") !== origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return Response.json({ message: "Forbidden" }, { status: 403 });

  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ message: "Invalid request" }, { status: 400 });

  const body: unknown = await request.json().catch(() => null);

  if (
    !body ||
    typeof body !== "object" ||
    !("grantId" in body) ||
    typeof body.grantId !== "string" ||
    body.grantId.length > 128
  )
    return Response.json({ message: "Invalid request" }, { status: 400 });

  const grantId = body.grantId;

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const auth = yield* makeAuth(bindings);

        const session = yield* Effect.tryPromise({
          try: () =>
            auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } }),
          catch: () => failure("Unavailable"),
        });

        if (!session)
          return Response.json({ message: "Sign in to revoke the grant" }, { status: 401 });

        const connectionString = bindings.HYPERDRIVE?.connectionString || bindings.DATABASE_URL;

        if (!connectionString) return Response.json({ message: "Unavailable" }, { status: 503 });

        const client = yield* acquirePostgres({
          connectionString: Redacted.make(connectionString),
          applicationName: "open-erp-oauth-revocation",
          connectTimeoutMs: 5000,
          statementTimeoutMs: 15000,
        }).pipe(Effect.mapError(() => failure("Unavailable")));

        const revocation = yield* Effect.tryPromise({
          try: async () => {
            await client.query("BEGIN");

            try {
              await client.query(
                "select id from openerp.oauth_agent_grants where id = $1 and actor_id = $2 for update",
                [grantId, session.user.id],
              );

              const result = await client.query<{ grant_id: string }>(
                `insert into openerp.oauth_agent_revocations (grant_id)
         select id from openerp.oauth_agent_grants where id = $1 and actor_id = $2
         on conflict (grant_id) do nothing returning grant_id`,
                [grantId, session.user.id],
              );

              await client.query("COMMIT");

              return result;
            } catch (error) {
              await client.query("ROLLBACK");
              throw error;
            }
          },
          catch: () => failure("Unavailable"),
        });

        return revocation.rowCount
          ? Response.json({ grantId, revoked: true })
          : Response.json({ message: "Grant not found or already revoked" }, { status: 404 });
      }),
    ).pipe(Effect.orElseSucceed(() => Response.json({ message: "Unavailable" }, { status: 503 }))),
  );
}

async function handleTokenRequest(
  request: Request,
  bindings: Bindings,
  handle: () => Promise<Response>,
) {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/x-www-form-urlencoded"
  )
    return Response.json({ error: "invalid_request" }, { status: 400 });

  const payload = await request.clone().text();

  if (payload.length > 16_384) return Response.json({ error: "invalid_request" }, { status: 413 });

  const form = new URLSearchParams(payload);

  if (form.get("grant_type") !== "refresh_token") return handle();

  const refreshTokens = form.getAll("refresh_token");

  if (refreshTokens.length !== 1 || !refreshTokens[0])
    return Response.json({ error: "invalid_request" }, { status: 400 });

  const connectionString = bindings.HYPERDRIVE?.connectionString || bindings.DATABASE_URL;

  if (!connectionString) throw new Error("OAuth refresh database unavailable");

  const tokenHash = await oauthTokenHash(refreshTokens[0]);

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* acquirePostgres({
          connectionString: Redacted.make(connectionString),
          applicationName: "open-erp-oauth-refresh-lock",
          connectTimeoutMs: 5000,
          statementTimeoutMs: 15000,
        });

        return yield* Effect.promise(async () => {
          await client.query("BEGIN");

          try {
            const record = await client.query<{
              reference_id: string | null;
              authorization_code_id: string | null;
            }>(
              `select reference_id, authorization_code_id
           from openerp_auth.oauth_refresh_token where token = $1`,
              [tokenHash],
            );

            const family =
              record.rows[0]?.reference_id ?? record.rows[0]?.authorization_code_id ?? tokenHash;

            await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [family]);

            const grantId = record.rows[0]?.reference_id;

            if (grantId) {
              await client.query(
                "select a.id from openerp.actors a join openerp.oauth_agent_grants g on g.actor_id = a.id where g.id = $1 for share of a",
                [grantId],
              );
              await client.query(
                "select a.enabled from openerp.identity_admissions a join openerp.oauth_agent_grants g on g.actor_id = a.actor_id where g.id = $1 for share of a",
                [grantId],
              );
              await client.query(
                "select id from openerp.oauth_agent_grants where id = $1 for share",
                [grantId],
              );

              const admitted = await client.query(
                `select g.id from openerp.oauth_agent_grants g
                 join openerp.firm_members fm on fm.firm_id = g.firm_id and fm.actor_id = g.actor_id and fm.active
                 join openerp.firm_clients fc on fc.firm_id = g.firm_id and fc.book_id = g.book_id
                 join openerp.memberships m on m.book_id = g.book_id and m.actor_id = g.actor_id and m.role = 'operator'
                      where g.id = $1 and not exists (select 1 from openerp.identity_admissions a where a.actor_id = g.actor_id and not a.enabled) and not exists (select 1 from openerp.oauth_agent_revocations r where r.grant_id = g.id)
                 for share of fm, fc, m`,
                [grantId],
              );

              if (admitted.rowCount !== 1) {
                await client.query("COMMIT");

                return Response.json({ error: "invalid_grant" }, { status: 400 });
              }
            }

            const response = await handle();

            await client.query("COMMIT");

            return response;
          } catch (error) {
            await client.query("ROLLBACK").catch(() => undefined);

            throw error;
          }
        });
      }),
    ),
  );
}

export function authHandler(request: Request, bindings: Bindings) {
  if (
    request.method === "GET" &&
    new URL(request.url).pathname === "/api/auth/oauth2/selected-grant"
  )
    return Effect.promise(() => selectedOAuthGrant(request, bindings));

  if (
    request.method === "POST" &&
    new URL(request.url).pathname === "/api/auth/oauth2/select-grant"
  )
    return Effect.promise(() => selectOAuthGrant(request, bindings));

  if (
    request.method === "POST" &&
    new URL(request.url).pathname === "/api/auth/oauth2/revoke-grant"
  )
    return Effect.promise(() => revokeOAuthGrant(request, bindings));

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
        try: () =>
          request.method === "POST" && new URL(request.url).pathname === "/api/auth/oauth2/token"
            ? handleTokenRequest(request, bindings, () => auth.handler(request))
            : auth.handler(request),
        catch: () => failure("Unavailable"),
      });
    }),
  ).pipe(
    Effect.orElseSucceed(() =>
      Response.json({ message: "Sign-in is unavailable. Try again later." }, { status: 503 }),
    ),
  );
}
