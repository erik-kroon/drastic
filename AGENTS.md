# OpenERP

This repository is the starting point for the OpenERP product.

## Documentation

- Start at `docs/README.md` for maintained scope, architecture, domain invariants and delivery gates.
- Check `docs/open-decisions.md` before treating an unresolved company fact or contract choice as settled.
- For a `NEXT-nn` work item, read `docs/plans/12-next-implementation-dossier.md` and its packet under `docs/specs/` for the implementation design. Bind its proposed names to the real owners, resolve its released-slice prerequisite, and keep its vectors as obligations; it is design input, not authority. A capability with an owner in the dossier plan is not thereby implemented or verified.
- Keep working design, implemented behavior and verified results distinct. Update the relevant maintained docs when a material decision changes.

## Packet delivery

A `packages/domain` leaf that no application owner consumes is dead code. Delivering a packet therefore means wiring it up, not only writing its calculation:

- A packet is delivered when a named `apps/api` application owner composes the leaf, or when the packet's own text says a *different* owner holds the workflow and that owner is given the leaf. Writing the leaf and stopping is not delivery.
- If you cannot wire it, say so in the same change: add an entry to `docs/plans/domain-leaf-integration.json` marking the leaf `deferred` with the real blocker and what would unblock it. A deferral naming a missing owner is a legitimate answer. Silence is not.
- Never mark a leaf `wired` to make a check pass. The entry is verified against real imports.
- `bun run check:integration` enforces this and runs in CI. New undeclared leaves, placeholder deferral reasons, and stale `deferred` claims for leaves that now have consumers all fail it.
- An owner that exists but takes its financial facts from the request is not wired either. Derive the value from retained data inside the owning transaction; a client may name a source and cite evidence, never state the amount.

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
- Focused unit, property/conformance, regression and integration/E2E tests needed for existing or explicitly adopted workflows are authorised by the owner-delegated decision pass dated 2026-09-28 ([ADR 0015](docs/adr/0015-owner-delegated-decision-pass.md)). Use synthetic fixtures and disposable isolated local/CI systems. Real local PostgreSQL, workerd, Bun and selected browser/REST/MCP tests are within this engineering scope. Prefer the repository's current test/check infrastructure.
- That permission does not authorise real company-data use, live provider credentials, customer contact, production migrations/resets, deployment, payments or statutory submissions. Do not broaden product scope through a test, weaken expectations to get green output or use production functions as their own expected-result oracle. Preserve narrower existing task restrictions, including the dated document-intelligence authorisation and its no-live-provider limit. Unrelated test work needs separate task authority.
- Never weaken lint or type rules to make a check pass.
- When dependency manifests change, update and commit `bun.lock` with them and verify `bun install --frozen-lockfile` before handoff. CI must keep frozen installs enabled.

## Commands

Run `bun run check:changed` after each coherent edit. This is the fast feedback gate: it formats changed source files, then runs normal lint (including anti-slop rules) and incremental TypeScript checks sequentially, one project at a time. The runner limits native worker pools to two (`--threads`, TypeScript `--checkers`, and `GOMAXPROCS`) so several agents can share the machine. Type checks include the changed files' imports. The first run for a project is slower; keep the ignored `tsconfig.changed.tsbuildinfo` caches so later runs reuse compiler work.

Run `bun run check:changed:full` before handoff and after changes involving async or Promise handling. It adds type-aware lint, including floating/misused Promise checks, which the fast gate does not run. A passing fast gate does not replace this fuller gate. Both commands compare against `HEAD` by default and accept a base ref, e.g. `bun run check:changed:full main` to cover committed branch changes too.

Do not run full-workspace `check`, `lint` or `check-types` scans after every edit. Reserve them for final integration checks when shared configuration, dependencies or cross-workspace changes warrant broader coverage. The changed-file commands select source files, so configuration-only edits need the relevant broader check.

### Check process ownership

- Run one check at a time per worktree. Run it once and inspect that result; do not rerun just to count or filter errors. Do not pipe a running check through `head` or hide its progress behind `grep`. Capture output once if needed, retain the check's exit status, then inspect the saved output.
- Let `check:changed` format its inputs. Do not pre-format or append whitespace just to make a file appear changed. Use a base ref to select committed work.
- Each tool has a 60-second deadline. The runner kills that tool's process group on timeout and cleans up its children on SIGINT/SIGTERM or normal exit. A timeout is a failure, never a passing or completed verification. Inspect CPU load and process ownership before extending a timeout; contention needs less concurrent work, not a longer deadline. Only for a measured, legitimate longer check, set `CHECK_CHANGED_TIMEOUT_SECONDS` and allow the outer shell enough time for all sequential stages plus cleanup. Do not bypass the runner with an unbounded direct compiler invocation after a timeout.
- After cancellation or an outer timeout, inspect `ps -Ao pid,ppid,pgid,etime,pcpu,command` before retrying. Confirm ownership by exact worktree path and process ancestry; PPID 1 identifies an orphan but does not by itself authorize killing it. Stop only your task's abandoned check processes: send TERM to their exact PIDs, inspect again, then KILL those same verified processes if they remain. Never use broad `pkill node`, `pkill bun`, or `pkill tsc` commands.
- SIGKILL cannot run cleanup handlers. If the runner was hard-killed, use the process inspection above to remove its surviving children. Confirm they are gone before starting one replacement check. If it stalls again, inspect the named stage rather than stacking more runs.
- Existing worktrees may contain an older runner and older instructions. Inspect that worktree's `scripts/check-changed.ts` and `package.json` before assuming timeout, cleanup, or fast/full behavior is available.

```bash
bun run dev
bun run check:changed
bun run check:changed:full
bun run check
bun run check:integration
bun run lint
bun run check-types
bun run build
```
