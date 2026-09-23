# OpenERP

**Accounting with a visible chain of evidence.**

OpenERP connects source material, accounting decisions, journal entries and reports. An operator can inspect the exact effect of a change before approving it. After posting, the voucher and its source remain traceable; if a response is lost, the caller can recover the committed result from a receipt.

The web app serves people doing the work. REST and MCP expose the same book-scoped operations to integrations and agents. An agent may prepare work and execute an approved change, but cannot grant its own approval.

```text
Source → proposed entries → validation → human approval → posting receipt
   ↑                                                  │
   └──────── voucher, reconciliation and report trail ┘
```

> **Project status:** OpenERP is under active development. It is not yet validated for live company books or statutory filing. The [roadmap](docs/roadmap.md) records what has been implemented and verified; [open decisions](docs/open-decisions.md) tracks the company facts and external inputs still required.

## What the repository contains

- **A controlled posting lifecycle:** retained evidence, immutable proposals, dependency validation, time-limited approval, atomic posting, receipts and linked corrections.
- **Accounting workspaces:** bank matching and reconciliation, invoices and payments, period work, internal reports and drilldown into the records behind a total.
- **Shared interfaces:** a web application, generated OpenAPI schema, and an [MCP endpoint](apps/api/MCP.md) with the same underlying accounting operations.
- **Portable execution:** the API runs at a Bun or Cloudflare Worker boundary against PostgreSQL. The browser holds no database credential.

Availability varies by book and operation. The authenticated book `/status` response reports installed capabilities and blockers; source code alone is not a release claim.

## Accounting guarantees

| Guarantee | How OpenERP enforces it |
| --- | --- |
| Exact amounts | Contracts carry integer minor-unit strings. Posting does not use floating-point money. |
| Reviewed effects | Approval binds to a proposal's exact digest and version. Changed dependencies require a new review. |
| One posting | Financial effects and execution receipts commit in one PostgreSQL transaction. Retries use the original idempotency key. |
| Preserved history | Corrections link new entries to the original voucher instead of rewriting posted records. |
| Scoped authority | Every operation resolves actor, entity and book permissions; agents cannot approve accounting changes. |

The [domain model](docs/domain.md) and [shared contracts](docs/plans/00-shared-contracts.md) define the detailed invariants.

## Local development

Install dependencies from the repository root, then follow the [source setup guide](docs/local-development.md) to configure PostgreSQL, a restricted application login and a local account:

```bash
bun install --frozen-lockfile
```

Start both development servers with `bun run dev`. The web app runs at [http://localhost:3000](http://localhost:3000) and proxies `/api/*` to the API Worker on port 8788. The generated REST schema is available at `/api/openapi.json`. With the token provisioned in the setup guide, list the books available to that credential:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $OPENERP_ACCESS_TOKEN" \
  http://localhost:3000/api/v1/books
```

## Architecture

```text
apps/web             TanStack Start routes and review screens
apps/api             Effect workflows, REST/MCP and runtime adapters
apps/api/migrations  PostgreSQL schema, grants and accounting transitions
packages/domain      Accounting models, exact values and domain errors
packages/contracts   Shared Effect Schema API contracts
jurisdictions/se     Pure Swedish VAT and SIE functions
packages/ui          StyleX components and design tokens
infra/alchemy        Cloudflare deployment composition
```

PostgreSQL is the financial authority. The API's restricted runtime role calls approved accounting functions and does not write ledger tables directly. Versioned SQL owns financial constraints, locks and receipts. See [architecture](docs/architecture.md) and the [API layout](apps/api/README.md) before changing those boundaries.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [documentation index](docs/README.md). The standard checks are:

```bash
bun run format:check
bun run lint
bun run check-types
bun run build
```

`build` bundles the API without deploying it. The existing end-to-end suite is `bun run test:e2e`; [its guide](apps/api/tests/README.md) lists prerequisites and repeatable artifacts. Checks and builds are not evidence that a financial workflow is ready for a real company.

OpenERP is licensed [AGPL-3.0-only](LICENSING.md). The accounting core and agent interface remain open; optional managed services do not gate local accounting.
