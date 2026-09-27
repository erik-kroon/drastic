# OpenERP

**Open-source accounting for Swedish businesses.**

Bookkeeping, invoicing, bank reconciliation and financial reports, built to be operated by you or your AI agent. Run it yourself, work with your accountant, and keep control of what gets posted.

[Self-host](#self-hosting) · [Documentation](docs/README.md) · [Connect an agent](apps/api/docs/MCP.md) · [Contribute](CONTRIBUTING.md)

## Why OpenERP?

**Traceable by design.** Follow a report total back to its journal entries and original documents. Review changes before posting, and correct mistakes without rewriting history.

**Agent-native.** MCP tools let your agent gather evidence, draft entries and reconcile transactions through the same accounting engine as the web app. You approve the posting; the agent cannot approve its own work.

**Yours to run.** AGPL-3.0-only, self-hostable with Docker, Bun and PostgreSQL. The accounting core and agent interface require no paid service or Cloudflare account.

## Features

The development build includes:

- **Double-entry bookkeeping** — Chart of accounts, sequential voucher numbering, exact amounts and approval before posting.
- **Invoicing** — Customer invoice drafts, PDF generation, credit notes and payment tracking.
- **Recurring invoices** — Billing schedules, versioned invoice templates, pauses and per-cycle billing records.
- **Sales orders and catalog** — Customer orders, reusable articles and invoice handoff.
- **Supplier invoices** — Document inbox, invoice review, purchase recognition, credits and payment batches.
- **Bank reconciliation** — Statement imports, match candidates, transaction matching and reconciliation sign-offs.
- **VAT preparation** — Reviewed VAT facts, return calculations and ledger controls for supported rule profiles.
- **Corporate tax preparation** — Accounting-to-tax adjustments, current-tax calculations and INK2/SRU export preparation.
- **Skattekonto** — Tax-account transactions matched to ledger entries, with reconciliation and correction history.
- **Financial reports** — Profit and loss, balance sheets, trial balances and general ledger, with drilldown to source entries.
- **Fixed assets** — Asset registers, depreciation schedules, impairment and disposal workflows.
- **Foreign currencies** — Reviewed exchange rates, receivable and payable settlements, fees and exchange differences.
- **Owner expenses and funding** — Owner-paid purchases, reimbursements, shareholder loans and capital contributions.
- **Payroll preparation** — Employment records and gross-to-net calculation drafts using reviewed payroll rules.
- **Period closing** — Readiness checks, outstanding obligations, period locks and accountant review packs.
- **SIE import/export** — Historical bookkeeping imports, transaction exports and complete-book export preparation.
- **Document history** — Retained source documents, content hashes and links from evidence to posted entries.
- **Accountant workspaces** — Multiple client books, team assignments, access controls and due-work views.
- **Agent access (MCP)** — Book-scoped tools for preparation, reconciliation, reports and execution of human-approved postings; REST and OpenAPI for integrations.

> **Under active development.** Modules have different levels of implementation and verification, and availability depends on company setup and reviewed rule profiles. OpenERP is not yet validated for live company books or statutory filing. See [implementation status](docs/plans/next-packet-progress.md) and the [roadmap](docs/roadmap.md).

## Self-hosting

Requirements: the Bun version pinned in [`package.json`](package.json), Docker Engine and Docker Compose v2. From the repository root:

```bash
bun infra/self-host/setup.ts
docker compose --env-file infra/self-host/.env -f infra/self-host/compose.yaml up --build -d
```

The app runs at [http://localhost:3000](http://localhost:3000). Follow the [self-hosting guide](infra/self-host/README.md) to create your first account and book, configure background jobs and manage upgrades.

## Local development

Requirements: the pinned Bun version and an isolated PostgreSQL 17 database.

```bash
bun install --frozen-lockfile
```

Follow the [local setup guide](docs/local-development.md) to migrate the database, configure the application login and create a development book and sign-in account. Then start the web app and API:

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). Background preparation uses a [separate Bun runner](docs/local-development.md#5-run-durable-preparation-work).

## Connect an agent or integration

Connect to `/api/mcp` with a book-scoped API token. The [MCP guide](apps/api/docs/MCP.md) covers authentication, tool discovery and the prepare–approve–execute workflow. REST clients can use the generated schema at `/api/openapi.json`.

## Architecture

- **Web:** React, TanStack Start, TanStack Query and StyleX.
- **API:** TypeScript and Effect, running on Bun or Cloudflare Workers.
- **Data:** PostgreSQL with Drizzle's native Effect adapter; Better Auth for browser authentication.
- **Background jobs:** effect-mq in a separate Bun process.

Accounting logic lives in the application; PostgreSQL enforces record integrity and preserves posted history. See the [architecture guide](docs/architecture.md), [API layout](apps/api/README.md) and [accounting guarantees](docs/domain.md).

### Repository map

| Path | Purpose |
| --- | --- |
| [`apps/web`](apps/web) | Product routes, accounting workspaces and review screens |
| [`apps/api`](apps/api) | Effect workflows, REST/MCP, database access and runtime adapters |
| [`packages/domain`](packages/domain) | Accounting models, exact amounts and domain errors |
| [`packages/contracts`](packages/contracts) | Shared API schemas and capability contracts |
| [`jurisdictions/se`](jurisdictions/se) | Swedish VAT calculations and SIE formats |
| [`packages/ui`](packages/ui) | Reusable components, StyleX tokens and global styles |
| [`infra/self-host`](infra/self-host) | Bun and PostgreSQL self-hosting |
| [`infra/alchemy`](infra/alchemy) | Cloudflare deployment |
| [`docs`](docs/README.md) | Product scope, architecture, delivery plans and verification |

## Contributing

Start with the [contributing guide](CONTRIBUTING.md). For local changes, run:

```bash
bun run check:changed
bun run check:changed:full
```

`bun run build` builds the web app and bundles the API without deploying it. The existing end-to-end suite runs with `bun run test:e2e`; its [guide](apps/api/tests/README.md) covers prerequisites and repeatable artifacts.

## Documentation

- [Documentation index](docs/README.md) — guides organized by task.
- [Product scope](docs/product.md) — users, outcomes and delivery boundaries.
- [Local development](docs/local-development.md) and [self-hosting](infra/self-host/README.md) — run OpenERP yourself.
- [MCP](apps/api/docs/MCP.md) and [authentication](apps/api/docs/AUTH.md) — connect agents and manage access.
- [Roadmap](docs/roadmap.md) — progress, verification and remaining work.

## License

[AGPL-3.0-only](LICENSE). See the [licensing policy](LICENSING.md) for scope, third-party material and hosted-operation requirements.
