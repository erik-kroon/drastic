# Drastic contributor and agent instructions

Read `docs/README.md`, `docs/domain.md` and `apps/api/README.md` before changing accounting behavior. Keep route files thin; compose owned components using StyleX and existing UI tokens. Reuse application operations across HTTP, MCP and browser clients.

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

The public repository does not require access to the private planning tracker or design workspace. Retained historical references are context; executable contracts and current application owners define the code boundary. Distinguish implementation, check results and production qualification in every handoff.
