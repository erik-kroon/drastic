# Authentication and identity admission

Better Auth owns browser sign-in and server sessions at `/api/auth/*`. Production uses OIDC authorization code with PKCE. Password sign-in is available only when `BETTER_AUTH_URL` uses localhost, 127.0.0.1 or ::1 and the authentication mode is local. Automation and MCP retain separately provisioned Bearer credentials.

## Configuration

Apply all versioned migrations with `db:migrate` to the selected PostgreSQL database. Supply the API Worker with:

- `DATABASE_URL`, or uncached `HYPERDRIVE`.
- `BETTER_AUTH_URL`: the exact public web origin. HTTPS is required outside localhost.
- `BETTER_AUTH_SECRET`: a random secret of at least 32 characters, stored as a secret.
- `OPENERP_AUTH_MODE=oidc` for production.
- `OIDC_ISSUER`: the exact tenant issuer advertised by its discovery document.
- `OIDC_CLIENT_ID` and secret `OIDC_CLIENT_SECRET`: the reviewed application registration.

Alchemy supplies these bindings and fixes the deployed authentication mode to OIDC. Missing production values fail closed. `/api/auth/configuration` exposes only the sign-in method and the derived provider ID. Register `<BETTER_AUTH_URL>/api/auth/callback/<providerId>` as the provider's redirect URI. The provisioning command's `plan` output includes that provider ID.

The provider ID is a SHA-256 namespace derived from the exact issuer and client ID. Better Auth binds its account ID to the provider's `sub`. Discovery must match the configured issuer; the SDK verifies ID-token signature, issuer, audience and nonce. An ID token is required, PKCE stays enabled, and callbacks use the query response mode. Public signup, implicit signup and account linking are disabled. Email similarity, email domains and provider group names confer no authority.

The actual issuer, application registration, approved human subjects and initial company/book grants must come from the deployment owner. Provider-enforced MFA and account lifecycle policy remain D-01 inputs. A local password session does not verify a real provider callback or its MFA policy.

## Review and apply an identity mapping

The privileged command owns explicit subject-to-actor and actor-to-book mapping. It does not create company books or infer grants. Start with a protected JSON manifest matching `IdentityProvisioning` in `packages/contracts/src/identity.ts`:

```json
{
  "requestId": "admission-reviewed-001",
  "actorId": "actor_example",
  "name": "Example accountant",
  "email": "accountant@example.com",
  "issuer": "https://identity.example.com/tenant",
  "clientId": "reviewed-application-id",
  "subject": "immutable-provider-subject",
  "enabled": true,
  "grants": [
    {
      "scope": { "entityId": "entity_example", "bookId": "book_example" },
      "expectedRole": null,
      "role": "operator"
    }
  ]
}
```

These are placeholders, not production identity facts. Review the manifest against the provider registration and the actual company membership records. Run from `apps/api`:

```bash
bun scripts/provision-identity.ts plan /protected/reviewed-identity.json
DATABASE_ADMIN_URL=... bun scripts/provision-identity.ts apply /protected/reviewed-identity.json
```

`plan` validates and describes the requested change without connecting to a database. `apply` checks that each company/book exists and that the current grant equals `expectedRole`. A null new `role` removes that grant; omitted books retain their grants. The command creates a missing actor and human account, binds only the exact provider subject, and records the full reviewed manifest in an administrator-only audit table. Existing actor/email or subject/actor conflicts fail. Identity rebinding requires a separate reviewed migration. The same request ID and manifest replay without changing authority; changing the manifest with that ID fails.

Each new applied request revokes the actor's existing browser sessions. `enabled: false` also blocks future session admission and every accounting request. The immutable subject binding is retained when disabled. Re-enable that same binding with a new reviewed request; a later grant does not rebind it. Firm membership is independent of book grants. Disabling a sole firm administrator may require an operator-reviewed recovery of firm administration; security revocation is not blocked to keep a firm usable.

## Firm workspaces

`/firms` provides client search, responsible-accountant and review-date filters, current period and work observations, client notes and team management. Each client opens the same company workspace. The HTTP `/api/v1/firms` family and the corresponding capabilities use the same SQL authorization and replay rules.

A firm administrator can link/unlink books they can operate, and add or change already provisioned human team members. An accountant with operation authority on a linked book can update its client handoff. Assignment requires an active firm member, an enabled identity and current access to the same book. Removing a firm member grants or revokes no book permissions. The last active, enabled firm administrator cannot be removed through team management.

Every client read intersects firm membership with live book membership. Unavailable clients, their names and notes are not returned. Revisions prevent lost updates; request keys preserve retries. Reads support up to 100 firms per human, 200 client books per firm and 100 registered team members per firm, including removed memberships. The interface pages the authorized client result ten rows at a time and fetches period/work observations only for those rows. It does not present cross-client financial actions or send client messages.

## Local synthetic accounts

To add a password account to an existing synthetic actor, set `DATABASE_ADMIN_URL`, `OPENERP_EMAIL` and `OPENERP_PASSWORD`, then run `bun run --cwd apps/api db:create-user <existing-actor-id>`. This command changes no book grants. Passwords require 12–128 characters. Public signup and password-reset email are not configured. Do not use this path to admit production users.

## Sessions and revocation

Session cookies are signed, HttpOnly, SameSite=Strict and Secure on HTTPS. Only the short-lived OAuth state cookies use SameSite=Lax so the provider's top-level GET callback can return them. Origin/CSRF checks remain enabled. Sessions expire after eight hours without sliding renewal; cookie caching is disabled. Signing out ends the application session; it does not sign the user out of their identity provider.

The server verifies the signed session, then PostgreSQL rechecks expiry, identity admission and current book membership. Requests already admitted under authority locks may finish before revocation commits. Privileged identity writes revoke sessions before changing admission or book memberships and take no financial book barrier.

The official Better Auth Promise-based Drizzle adapter uses the shared scoped PostgreSQL connection. Accounting queries remain Effect-based. Session reads do not fetch provider discovery. Database-backed rate limiting stays enabled; a self-hosted ingress must replace `CF-Connecting-IP` with the actual client IP. Never log raw adapter errors, bound parameters, passwords, provider secrets or session tokens.
