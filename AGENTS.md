# Drastic contributor and agent instructions

Develop product code in `erik-kroon/drastic`. The private `openERP` repository is
a read-only archive. Keep company facts, Book Zero originals and funding
documents in the private `drastic-hq` workspace. Port useful historical work
against current application owners rather than maintaining both codebases.

Read `docs/README.md`, `docs/domain.md` and `apps/api/README.md` before changing accounting behavior. Keep route files thin; compose owned components using StyleX and existing UI tokens. Build new and reworked screens from `@open-erp/ui/kanon/*` as described in `docs/design-system.md`. Reuse application operations across HTTP, MCP and browser clients.

- Read authoritative financial amounts from stored records, not client input.
- Preserve current authority checks, exact approval binding, atomic receipts and immutable posted history.
- Use isolated synthetic accounts and data. Live providers, real books, payments, deployments and statutory submissions need task-specific authorization.
- Keep credentials and private data out of source, fixtures, logs and captured artifacts.
- Keep anti-slop Oxlint rules enabled. Fix lint and TypeScript errors without suppressing checks.
- Run `bun run check:changed` after each coherent code edit and `bun run check:changed:full` before handoff and after Promise or async changes.
- Declare each domain leaf's real application consumer in `docs/plans/domain-leaf-integration.json`; run `bun run check:owners`.
- After dependency changes, update `bun.lock` and verify `bun install --frozen-lockfile`.
- Prefer real application E2E workflows with repeatable artifacts. Before building an isolated system, list its failure cases. Never write unit tests after implementation.
- New browser E2E tests use Vitest or TesterArmy with Luna (`gpt-6-luna`). Follow `verification/testerarmy/README.md`, reuse `tests/browser/synthetic-session.ts`, and run `bun run check:browser` after test changes.
- Use `bun run test:browser` for the pinned local Codex proxy and fresh synthetic PostgreSQL/API/web runtime. If Luna, authentication or the proxy is unavailable, report the blocker and unverified behavior rather than changing providers or claiming mocked verification.
- MCP catalog, schema, transport and tool-description changes require `bun run test:mcp` and `bun run test:mcp:eval`. Follow `verification/mcpjam/README.md`; local model evals use the pinned Codex proxy. The OpenAI CI eval step stays disabled until its key and enable variable are configured.

The public repository does not require access to the private planning tracker or design workspace. Retained historical references are context; executable contracts and current application owners define the code boundary. Distinguish implementation, check results and production qualification in every handoff.

## UI delivery

Follow [the page 00 delivery contract](docs/design/parity.md) and
[issue template](docs/design/ui-issue-template.md). Before UI implementation,
name the screen, audience, adopted board/state, behavior source and missing decisions.
Reconcile deleted Paper references; historical screenshots do not adopt product policy.
Update verification/paper/kanon-manifest.json in the same change as the UI.
Run bun run check:design against the PR base. Keep legacy import exceptions shrinking.
Retain real-route browser behavior and visual baseline/actual/diff evidence separately.
Unverified or design-pending is not parity completion. Baseline changes require
explicit design adoption; never regenerate from candidate code to pass.
