# Authentication

Better Auth owns email/password sign-in and browser sessions at `/api/auth/*`. The browser uses
its plain client inside TanStack Query mutations. The old `/api/v1/session` token-login endpoints
and `openerp_session` cookie have been removed. Automation and MCP continue to use Bearer API
tokens.

## Configure the first database

This code does not provision a hosted database. Apply the SQL setup with `db:migrate`, including
`0900-better-auth.sql`, against your explicitly selected PostgreSQL database. The migration creates
the `openerp_auth` tables and gives `openerp_runtime` access to those tables. It does not grant
direct writes to accounting tables.

Set these API Worker bindings (local values go in the ignored `apps/api/.dev.vars`):

- `DATABASE_URL`, or the uncached `HYPERDRIVE` binding.
- `BETTER_AUTH_URL`: the exact public web origin, such as `http://localhost:3000` locally and an
  HTTPS origin when deployed. Open that same hostname in your browser.
- `BETTER_AUTH_SECRET`: a random secret of at least 32 characters; generate one with
  `openssl rand -hex 32`. Keep it in the secret store, not Git or frontend configuration.

Alchemy reads the two Better Auth settings from the environment and supplies them to the API.
Better Auth's Promise-based Drizzle adapter uses the shared scoped `pg` connection acquisition.
Application accounting queries continue to use the native Effect Drizzle adapter. No connection
or auth instance is shared between Worker requests.

## Create an account

Public sign-up is disabled. First provision the accounting actor and explicitly reviewed book
membership through the existing setup process. Then set `DATABASE_ADMIN_URL`, `OPENERP_EMAIL`
and `OPENERP_PASSWORD` in your shell and run:

```bash
bun run --cwd apps/api db:create-user <existing-actor-id>
```

The password must contain 12–128 characters. The command uses Better Auth's password hasher and
creates the user and password account in one Drizzle transaction. Repeating it fails instead of
overwriting an account or password. The user ID references the existing actor, and the command
does not add or change any company/book memberships. Unset the password environment variable
afterward. No email provider, public registration, social login or password-reset email is
configured.

## Session and permission behavior

Sessions use signed HttpOnly, SameSite=Strict cookies and Secure cookies on HTTPS. They expire
after eight hours without sliding renewal. Cookie caching is disabled so database revocation
is checked on every accounting request. The server verifies the signed session, then PostgreSQL
rechecks expiry and current actor membership under the existing admission locks. Sign-out deletes
the stored session; it cannot authorize a later posting. Work already admitted under a session
lock can finish before revocation commits.

Better Auth uses database-backed rate limiting, including its stricter sign-in limits. In Workers,
the trusted client IP comes from Cloudflare's `CF-Connecting-IP` header. A self-hosted ingress must
replace that header with the actual client IP instead of trusting a caller-supplied value.
The configured public origin is the trusted browser origin. Cross-origin cookie mutations remain
rejected. Do not enable a Better Auth setting that disables CSRF or origin checks.

Keep raw adapter errors, query parameters, passwords and session tokens out of logs and returned
application errors. SQL query logging is disabled. Better Auth accounts establish identity;
accounting membership determines which companies, books and actions that identity can access.

The existing token-login browser check describes the retired flow. No tests were added or edited
for this integration.
