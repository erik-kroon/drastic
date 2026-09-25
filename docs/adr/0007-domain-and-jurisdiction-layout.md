# ADR 0007: domain, jurisdiction and API layout

Status: accepted repository structure under the user's request to implement the open-accounting folder and package boundaries. [ADR 0010](0010-application-owned-accounting-replacement.md) supersedes this ADR's SQL transition/compatibility instructions for the replacement while retaining the package and dependency layout.

## Decision

Extract the existing shared accounting values, money, ledger/book models and errors into `packages/domain`. `packages/contracts` retains wire commands, API routes, capability metadata and the supported accounting exports, re-exporting the domain definitions rather than creating duplicate schemas or error classes.

Move existing deterministic VAT draft calculation and SIE rendering into `jurisdictions/se`. This package depends on domain errors at runtime and uses type-only contract imports for its captured inputs and results. It has no HTTP, SQL, storage, provider or runtime calls. Keep current version identifiers, failure semantics and explicit synthetic limitations.

Organize `apps/api/src` into `application`, `transport`, `db`, `adapters` and `runtime`. Separate VAT/SIE Effect workflows from HTTP handlers so shared capability execution does not load transport composition. Move request bindings out of SQL dispatch; keep the request service identity and connection scope unchanged. `src/index.ts` remains the common API entrypoint. Cloudflare uses `src/runtime/cloudflare.ts`; Bun keeps its existing self-host script.

Keep migrations and maintenance scripts at their existing locations until the application-owned cutover. PostgreSQL remains the single relational authority, but application operations now own business policy, authorization, calculations and scoped writes; the SQL layer is limited to DDL, constraints, grants and the narrow integrity layer. Update workspace dependencies, checks, container copying, Cloudflare composition and recovery release capture with the moved code. The clean three-file baseline and no-compatibility rule are defined by [ADR 0010](0010-application-owned-accounting-replacement.md).

## Consequences

Dependency direction is API → jurisdiction/contracts/domain, jurisdiction → domain plus contract types, and contracts → domain. Domain imports neither the API, contracts nor jurisdiction packages. Strict package compilation excludes ambient runtime globals; lint retains the existing quality rules and rejects runtime/transport dependencies in pure packages.

This is an internal ownership change. REST paths, MCP capability definitions, wire validation, sealed records, generator identities, SQL migrations and command behavior remain unchanged. The supported contract export paths are retained because both the frontend and external integrations consume them.

Do not create empty CLI, agent, provider, report, Rust or managed-service packages. Existing scripts and report/reconciliation handlers have explicit owners; further extraction should serve an independent consumer. A separate cloud repository and Rust remain deferred under ADR 0005.

## Verification

Observed during the layout refactor on 2026-09-22:

- Generated OpenAPI and all 128 capability definitions, including their input/output schemas, matched the pre-refactor capture exactly.
- `bun run check-types` and `bun run build` passed, including Worker dry-run bundling and the web build.
- Type-aware lint and formatting checks passed for the moved API sources, changed scripts, domain and jurisdiction packages. Repository-wide lint still reported errors in untouched frontend invoice/VAT components.
- All 54 migration and existing test files matched their pre-refactor SHA-256 hashes. No test files or fixtures were added or edited, and no E2E suite was run.
- The actual Bun self-host entrypoint served health, unchanged OpenAPI and the built web page, then shut down cleanly. The observation used an unreachable placeholder database URL and made no accounting requests.

These checks establish structural and contract continuity, not new accounting, provider, deployment or financial acceptance. The package boundary remains valid for the application-owned replacement; the earlier function-only persistence instructions are superseded by [ADR 0010](0010-application-owned-accounting-replacement.md). Container execution and live PostgreSQL behavior were not exercised by this refactor.
