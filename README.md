# OpenERP

OpenERP is an open-source accounting application built around a simple rule: every change to the books should be explainable and recoverable. It connects source evidence to reviewed decisions, approved postings, reconciliations and reports that can be traced back to their inputs.

The application has a TanStack Start web interface, an Effect 4 API, and a PostgreSQL accounting kernel. Humans use the web app; automation uses scoped REST or MCP operations. Both reach the same accounting workflows.

> **Development status:** The available accounting profile is `synthetic-core-v1`. It is for isolated development records, not a real company's books. The repository contains working capabilities and ongoing implementation, but no production-ready or Swedish-compliance release. See the [roadmap](docs/roadmap.md) for implementation and proof status, and [open decisions](docs/open-decisions.md) for the company facts and external inputs still needed.

## What is here

- **Review before posting.** Retain evidence, prepare an immutable proposal, inspect its exact effects, validate dependencies, obtain an operator's approval, and execute it once. A receipt identifies the committed result; corrections preserve the original voucher.
- **Account for exact amounts.** Money travels through contracts and posting as integer minor-unit strings. PostgreSQL owns the financial constraints, lock order, authorization checks and atomic transitions.
- **Work across the accounting cycle.** The source includes synthetic workflows for bank matching and reconciliation, invoices and payments, accounting cases, recurring preparation, internal reports and other areas under active development. Availability depends on the book profile and the specific operation; book `/status` reports capability and readiness separately.
- **Keep automation within its authority.** REST and MCP share application operations. Agents can prepare and inspect work and execute an already approved change; they cannot approve their own proposal. Mutations use stable idempotency keys so callers can recover an uncertain outcome.

The [product scope](docs/product.md) describes the intended end-to-end result. A working synthetic workflow, a reconciled company period and an accepted external filing are separate milestones.

## Run it

Choose the path that fits the work:

| Path | Use it for | Start here |
| --- | --- | --- |
| Self-hosted container | Run the current app and PostgreSQL locally without a Cloudflare account | [Self-host setup](infra/self-host/README.md) |
| Source development | Run the web app and API Worker with a dedicated local PostgreSQL database | [Local development](#local-development) |
| Cloudflare | Review the hosted Worker, R2, Workflow and Hyperdrive composition | [Alchemy deployment](infra/alchemy/README.md) |

The self-hosted container starts with **no book or user**. Neither path creates a production company profile.

### Local development

Use the Bun version pinned in [package.json](package.json) and a dedicated PostgreSQL 17 database. Run these commands from the repository root unless a command says otherwise. Use only synthetic data.

1. Install dependencies and apply the versioned SQL migrations using a direct maintenance connection with schema and role creation rights:

   ```bash
   bun install --frozen-lockfile
   export DATABASE_ADMIN_URL='postgresql://owner:password@127.0.0.1:5432/openerp_development'
   bun run --cwd apps/api db:migrate
   ```

   Applied migration checksums are enforced. Change the schema with a new migration rather than editing an applied one.

2. Create the restricted application login. Generate a separate random password of at least 32 characters, then run:

   ```bash
   export OPENERP_RUNTIME_PASSWORD='<random runtime password>'
   bun apps/api/scripts/self-host-role.ts
   ```

   This configures the `openerp_app` login with the `openerp_runtime` grant. The API must use this login, not the maintenance account.

3. Add an ignored `apps/api/.dev.vars` file for the local API Worker:

   ```text
   DATABASE_URL="postgresql://openerp_app:<url-encoded runtime password>@127.0.0.1:5432/openerp_development"
   BETTER_AUTH_URL="http://localhost:3000"
   BETTER_AUTH_SECRET="<separate random secret of at least 32 characters>"
   ```

4. Review [the synthetic book example](examples/synthetic-book.json), including its dates and token expiry. Generate a random access token of 32–512 characters and provision the book once:

   ```bash
   export OPENERP_ACCESS_TOKEN='<random development access token>'
   bun run --cwd apps/api db:provision ../../examples/synthetic-book.json
   ```

   Provisioning is atomic and refuses an existing book; it never resets accounting records. Keep the token private. It is for API and MCP development, not browser sign-in.

5. Give the example's `actor_operator` a local password account, then start both development servers:

   ```bash
   export OPENERP_EMAIL='operator@example.test'
   export OPENERP_PASSWORD='<local password of 12–128 characters>'
   bun run --cwd apps/api db:create-user actor_operator
   bun run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) and sign in. The web app uses the same-origin `/api/*` proxy to the API Worker on port 8788. Password sign-in is limited to local development; [authentication setup](apps/api/AUTH.md) covers production OIDC and explicit identity grants.

For the container path, follow its [provisioning commands](infra/self-host/README.md#container-setup) and the same synthetic actor/account setup. For an API caller, use `Authorization: Bearer <token>` and consult the generated schema at `/api/openapi.json`; [MCP setup](apps/api/MCP.md) documents its authentication and protocol.

## How posting works

```text
Evidence → proposal → inspect and validate → operator approval
         → execute → receipt → voucher and report drilldown
```

Approval is bound to the exact proposal version and digest; it does not post by itself. Every mutating REST request needs an `Idempotency-Key`. If a response is lost, look up the receipt or retry the **unchanged** command with its original key. A new key is not a way to create a second accounting effect. [The shared contract](docs/plans/00-shared-contracts.md) describes authority, locking and replay rules in detail.

## Repository map

```text
apps/web             Web routes, review screens and TanStack Query state
apps/api             Effect workflows, REST/MCP transports and runtime adapters
apps/api/migrations  Versioned PostgreSQL schema, grants and accounting functions
packages/domain      Transport-independent accounting models and exact-money types
packages/contracts   Shared Effect Schema API contracts
jurisdictions/se     Pure Swedish VAT calculations and SIE rendering
packages/ui          Reusable StyleX components and design tokens
infra/self-host      Bun/PostgreSQL distribution
infra/alchemy        Cloudflare deployment composition
```

The browser has no database credentials. The API runs workflows at an owning Worker or Bun boundary; the restricted database role calls approved functions rather than writing ledger tables directly. The [architecture](docs/architecture.md) and [API layout](apps/api/README.md) explain those boundaries. SQL migrations define the complete database; the typed Drizzle table mappings are not a substitute for them.

## Check a change

```bash
bun run format:check
bun run lint
bun run check-types
bun run build
```

`build` includes a Wrangler dry run; it does not deploy. The existing end-to-end suite is `bun run test:e2e`. It needs PostgreSQL 17 binaries and writes repeatable results under `test-results/e2e`; see the [suite instructions](apps/api/tests/README.md) and [verification strategy](docs/verification-strategy.md). Passing code checks do not establish financial or company readiness.

## Read further

| If you need to… | Read |
| --- | --- |
| Understand product requirements and current progress | [Product scope](docs/product.md) · [Roadmap](docs/roadmap.md) |
| Find an accounting invariant or delivery gate | [Documentation index](docs/README.md) · [Design coverage](docs/design-coverage.md) |
| Inspect API contracts and automation | [API layout](apps/api/README.md) · [MCP](apps/api/MCP.md) |
| Run or recover an installation | [Self-host setup](infra/self-host/README.md) · [Operations](docs/operations.md) |
| Contribute a change | [Contributing](CONTRIBUTING.md) · [Repository instructions](AGENTS.md) |

Project-owned code is licensed **AGPL-3.0-only**. See [licensing](LICENSING.md) for distribution terms and the boundary between the open accounting application and optional managed services.
