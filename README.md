# OpenERP

An Effect 4 accounting application with a TanStack Start frontend and a PostgreSQL posting kernel.

Project-owned code is licensed [AGPL-3.0-only](LICENSING.md), including the accounting core, contracts and agent layer. See [self-host setup](infra/self-host/README.md) for the Bun/PostgreSQL distribution and [contributing](CONTRIBUTING.md) for local work. Optional managed services do not gate local accounting; the [open-accounting decision](docs/adr/0005-open-accounting-and-managed-services.md) records that boundary and the deferred Rust option.

## Current capability

The explicit `synthetic-core-v1` development profile supports retained text evidence, exact manual
journals, immutable sealed proposals, operator approval, atomic posting and execution receipts,
linked reversals, voucher inspection, immutable manual-case contexts, retained synthetic bank statements and matches, bank reconciliation, internal trial balances with evidence drilldown, and operator-activated recurring preparation with durable cancel/resume checkpoints. Recurring preparation never posts automatically. Monetary values use integer minor-unit
strings, not JavaScript floating-point arithmetic.

This is **not a production-ready or Swedish-compliance release**. Real company profiles, tax
calculations, arbitrary bank/provider imports, statutory outputs, durable outbox delivery, archive
retention, migration and provider submissions remain incomplete. The application refuses posting
for unimplemented profiles. Synthetic dates and accounts are not company facts.

## Ownership

```text
apps/web           TanStack Start routes, Query state and review screens
apps/api           Effect workflows, authenticated REST/MCP and runtime adapters
apps/api/migrations PostgreSQL authority and restricted command functions
packages/domain    Accounting models, exact-money schemas and domain errors
packages/contracts Effect Schema transport contracts using shared domain models
jurisdictions/se   Pure Swedish VAT calculations and SIE rendering
packages/ui        Shared StyleX controls and tokens
infra/alchemy      Workers and uncached Hyperdrive connection
infra/self-host    Bun/PostgreSQL distribution
```

The [API layout](apps/api/README.md) separates transports, application workflows, database access and runtime adapters. [ADR 0007](docs/adr/0007-domain-and-jurisdiction-layout.md) records package dependencies and the preserved public contracts.

Effect is pinned to `4.0.0-rc.112`. Database access uses Drizzle's native Effect PostgreSQL adapter,
backed by `@effect/sql-pg` and the Worker-compatible `pg` driver. Each database operation owns its
connection, with query logging and caching disabled. The PostgreSQL runtime role can execute
approved accounting functions, not write ledger tables. The UI Worker has no database credentials.

The repository contains database setup code; it does not provision an application database.
`apps/api/src/db/schema.ts` maps the tables used by typed maintenance queries. SQL files in
`apps/api/migrations` define the complete database, including accounting functions, grants,
constraints and triggers. `db:migrate` applies them through Drizzle transactions and records
checksums; `db:provision` uses typed Drizzle inserts in one transaction. These query mappings are
not a complete DDL schema for `drizzle-kit push`. Backup/restore tooling retains direct PostgreSQL
administration access.

## Local development

Install dependencies with `bun install`. Configure a dedicated local PostgreSQL database before
using accounting routes. Do not point these commands at company or production data.

1. Set `DATABASE_ADMIN_URL` to a direct maintenance connection. The initial migration requires
   schema and role creation rights. Run `bun run --cwd apps/api db:migrate`. Migration checksums
   prevent changing a migration after it has been applied. An optional final filename limits a reviewed rollout: `bun run --cwd apps/api db:migrate 0130-book-readiness.sql`. Later files are not applied or rolled back.
2. Create a PostgreSQL login for the Worker and grant it `openerp_runtime`. Set its password through
   your database administration tool. Never grant the runtime login the migration owner's role.
3. Put its connection string in the ignored `apps/api/.dev.vars`:

   ```text
   DATABASE_URL="postgresql://runtime-user:password@127.0.0.1:5432/openerp_development"
   BETTER_AUTH_URL="http://localhost:3000"
   BETTER_AUTH_SECRET="<random secret of at least 32 characters>"
   ```

4. Review `examples/synthetic-book.json`, including the explicit dates and access-token expiry.
   Set `OPENERP_ACCESS_TOKEN` to a cryptographically random secret of 32–512 characters, then run:

   ```bash
   bun run --cwd apps/api db:provision ../../examples/synthetic-book.json
   ```

   Provisioning creates a new synthetic book atomically. It does not overwrite or reset an existing
   book. Repeating the same configuration fails without changing the existing records.

5. Set `OPENERP_EMAIL` and `OPENERP_PASSWORD` (12–128 characters), then create a Better Auth
   account for the actor ID from your book configuration:

   ```bash
   bun run --cwd apps/api db:create-user <actor-id>
   ```

6. Run `bun run dev` and open the exact origin in `BETTER_AUTH_URL`. Sign in with email and
   password. Better Auth owns the signed HttpOnly, SameSite=Strict session cookie; sessions expire
   after eight hours. API tokens remain available for automation. See [authentication setup](apps/api/AUTH.md).

`bun run dev` starts the API on port 8788 and the web app on port 3000. Browser requests use the
same-origin `/api/*` proxy; do not enable `changeOrigin` on that development proxy.

### Maintenance lock order

There is no runtime period-configuration command yet. A maintenance transaction that changes
period dates/lock state, fiscal years, accounts or book configuration must lock the owning book
first (`SELECT ... FROM openerp.books WHERE id = ... FOR UPDATE`), then update dependent rows.
The calendar row trigger cannot impose this ordering: its target period row is already locked.
Reversing this order can deadlock with posting; PostgreSQL aborts one transaction rather than
committing a partial voucher. Do not grant direct configuration writes to the runtime role.

### Credential admission and revocation

Authentication takes shared locks on the admitted credential and scoped membership until the
request transaction ends. Role revocation and token revocation therefore wait for admitted work,
rather than changing its authority halfway through a commit. Expiry is checked at admission;
this is not a promise of immediate cancellation when wall-clock expiry occurs during a book-lock
wait. PostgreSQL statement timeouts still bound work. Existing approver/activation-operator checks
also lock the relevant membership before use.

Run credential and membership revocations in separate maintenance transactions with **no book
or configuration writes**. If both credential and membership rows change, lock credentials before
memberships. Do not lock a book in that transaction: posting can hold the book while checking an
approver's membership. Book configuration changes keep the separate book-first ordering above.
The book's entity, currency and minor-unit scale cannot be changed after creation. A new book is
required; cross-entity history movement and currency conversion are not implemented.

## Posting flow

```text
Retain evidence → prepare journal → inspect sealed digest and dependencies
    → validate → operator approves exact version → execute → recover receipt
```

Use a stable `Idempotency-Key` on every mutating request. Retrying the same command recovers its
saved result; changing the command under that key returns a conflict. A fresh key does not bypass
an existing event's posting-purpose identity. Approvals expire after one hour. Agents may prepare
and execute an operator-approved plan but cannot approve it.

The public schema is at `/api/openapi.json`. Book-scoped `/status` distinguishes installed features from available synthetic behavior and unverified production readiness. Authenticated accounting routes start at `/api/v1/books`
and `/api/v1/entities/{entityId}/books/{bookId}`. API clients use `Authorization: Bearer <token>`;
browser cookie mutations require the matching Origin. Recover a committed result through
`GET .../receipts/{execution-idempotency-key}` after an uncertain response. Approval does not post.

## Checks

```bash
bun run format:check
bun run lint
bun run check-types
bun run build
```

The API build is a Wrangler dry run. It bundles for workerd without deploying. The existing
[E2E suite](apps/api/tests/README.md) runs with `bun run test:e2e`; its prerequisites and evidence
are separate from static checks. See the [verification strategy](docs/verification-strategy.md)
for runtime, browser, recovery and release gates.

## Deployment

See `infra/alchemy/README.md` for required PostgreSQL/Hyperdrive configuration. Deployment,
production data changes, cutover and authority filing require separate approval. No deployment or
filing has been performed as part of this implementation.

Start with the [documentation index](docs/README.md) for product requirements, architecture and
the [accounting delivery plan](docs/plans/README.md). The [design coverage map](docs/design-coverage.md)
links each major concern to its specification and acceptance gate. Runtime decisions live in
[architecture decisions](docs/adr/README.md); dated official-source research lives in
[sources](docs/sources/README.md).
