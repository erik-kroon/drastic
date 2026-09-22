# OpenERP

This repository is the starting point for the OpenERP product.

## Documentation

- Start at `docs/README.md` for maintained scope, architecture, domain invariants and delivery gates.
- Check `docs/open-decisions.md` before treating an unresolved company fact or contract choice as settled.
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
- Use Drizzle's Effect PostgreSQL adapter for application database access. Reuse `apps/api/src/db/connection.ts` and typed table mappings in `apps/api/src/db/schema.ts`.
- Better Auth owns browser authentication. Its official Drizzle adapter uses Promise queries through the same scoped PostgreSQL connection acquisition; accounting workflows remain native Effect. Keep API tokens for automation and book authorization in the backend.
- Keep accounting transitions and database constraints in the versioned SQL setup. The runtime role calls approved functions; it does not gain direct table writes through Drizzle.

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
