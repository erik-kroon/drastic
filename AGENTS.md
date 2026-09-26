# OpenERP

This repository is the starting point for the OpenERP product.

## Documentation

- Start at `docs/README.md` for maintained scope, architecture, domain invariants and delivery gates.
- Check `docs/open-decisions.md` before treating an unresolved company fact or contract choice as settled.
- For a `NEXT-nn` work item, read `docs/plans/12-next-implementation-dossier.md` and its packet under `docs/specs/` for the implementation design. Bind its proposed names to the real owners, resolve its released-slice prerequisite, and keep its vectors as obligations; it is design input, not authority.
- Keep working design, implemented behavior and verified results distinct. Update the relevant maintained docs when a material decision changes.

## Scope

- `apps/web` owns product routes, application composition, and visible product behavior.
- `apps/api` owns Effect application workflows, HTTP/MCP transports, database access and runtime adapters. See `apps/api/README.md` for internal boundaries.
- `packages/domain` owns transport-independent accounting models, exact-money schemas and errors.
- `packages/contracts` owns shared Effect Schema API contracts and composes the domain schemas.
- `jurisdictions/se` owns pure Swedish VAT calculations and SIE rendering.
- `packages/ui` owns reusable interface primitives, StyleX tokens, and global styles.
- `packages/config` owns shared TypeScript configuration.
- `infra/alchemy` owns Cloudflare Worker deployment.

## Data rules

- Use TanStack Query for remote server state in `apps/web`.
- Create a request-scoped QueryClient through the TanStack Start router integration.
- Validate API responses and inputs with contracts from `packages/contracts`.
- Keep backend workflows in Effect and run them only at an owning Worker or Bun runtime boundary.
- Use the native Effect/Drizzle PostgreSQL adapter for application database access. Reuse `apps/api/src/db/connection.ts` and typed table mappings in `apps/api/src/db/schema.ts`; pass the caller's transaction through nested persistence.
- Better Auth owns browser authentication. Its official Drizzle adapter uses Promise queries through the same scoped PostgreSQL connection acquisition; accounting workflows remain native Effect. Keep API tokens for automation and book authorization in the backend.
- The application process owns accounting policy, authorization, calculations and scoped writes. PostgreSQL owns the reviewed DDL, constraints, grants and the narrow integrity layer; it does not own feature workflows through stored functions. The runtime role has only the scoped table/column permissions required by the application.
- Use one book-scoped financial transaction for each atomic posting, correction or other financial group. Lock authority before the book, then periods/accounts, domain resources, approval and counters. Financial transactions use no session-level tenant context or advisory locks.
- Use [ADR 0009](docs/adr/0009-effect-mq-background-jobs.md) and [ADR 0010](docs/adr/0010-application-owned-accounting-replacement.md) for durable work and the application-owned replacement. effect-mq owns queue claims, retries and leases in a separate Bun process; the application owns outbox intent, business progress, current authority, cancellation versions and financial receipts.

## Interface rules

- Use StyleX and the existing UI tokens. Do not add another styling system.
- Reuse owned UI components before creating new controls.
- Keep primary actions clear, accessible, and usable at narrow widths.
- Respect keyboard focus, reduced motion, readable contrast, and 200% zoom.
- Keep interface copy direct and specific.

## Quality rules

- Keep anti-slop Oxlint rules enabled as errors.
- Prefer deletion and direct local code over speculative abstractions.
- Do not add dependencies when the platform or existing UI package solves the need.
- Do not add tests unless the user explicitly approves the test change.
- Never weaken lint or type rules to make a check pass.

## Commands

```bash
bun run dev
bun run check
bun run lint
bun run check-types
bun run build
```
