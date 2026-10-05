# OpenERP agent rules

## Work
- Use Linear MCP to track work in the existing OpenERP project.
- Make one issue for each result that can be finished and checked.
- Add source links, done checks, and an owner or blocker to each issue.
- Do not ticket finished or deferred work. Do not make one issue per register row.
- Before code changes, read `docs/README.md` and `docs/open-decisions.md`. For `NEXT-nn`, also read its dossier and spec.
- For code work, read and follow the `software-engineering` skill.
- Keep plans, code, and check results distinct. Update docs when facts or decisions change.

## Frontend design and code
- Use Paper MCP to design frontend screens. Work on one screen at a time in `Enthusiastic lantern`.
- Follow `docs/ui-design-prompt.md`, `docs/ui-design-checklist.md`, and `verification/paper/baseline/`.
- Read frame code and styles with Paper `get_jsx` and `get_computed_styles`. Use shared components and UI tokens. Draft designs are not approval or proof of implementation.
- Use only copy and states shown in each frame. Follow its selection style. Do not use middle-dot separators.
- Keep route files thin. Compose pages from owned components; do not put the full interface in a page or route.
- Build with StyleX and existing UI components. A screen is done when its parity check passes and its diff is saved. See `verification/paper/`.

## Safety and checks
- Follow accounting and code ownership in `docs/README.md` and `apps/api/README.md`. Read financial amounts from stored records, not client input.
- Keep anti-slop Oxlint rules enabled. Fix lint and TypeScript errors; do not suppress warnings or weaken checks.
- Run `bun run check:changed` after each coherent code edit. Run `bun run check:changed:full` before handoff and after Promise or async changes.
- Use synthetic test data. Do not use real company data, live providers, production systems, payments, deployments, or statutory submissions without task-specific authorization.
- For each new `packages/domain` leaf, wire it to a real application owner, retain public workflow evidence, and declare its consumer in `docs/plans/domain-leaf-integration.json`. Run `bun run check:owners`; deferrals cannot pass this guard.
- If dependency manifests change, update `bun.lock` and verify with `bun install --frozen-lockfile`.

## Testing
Choose tests in this order of priority:

1. Full E2E tests with nothing mocked out. Exercise real application flows with Playwright or equivalent, using synthetic test accounts and data. Production test accounts require task-specific authorization under the safety rules above. Save a verifiable, repeatable artifact at the end of each E2E run.
2. Integration tests across data and API boundaries, especially where schemas can drift.
3. Golden tests grounded in representative data examples, covering regressions and edge cases. Use synthetic or sanitized fixtures that comply with the safety rules above.

- Unit tests are exceptional; avoid tests that duplicate implementation details or add maintenance bloat. Never write unit tests after writing the implementation.
- Coding agents must use [TesterArmy e2e](https://tester.army/e2e) for new browser E2E tests, with Luna (`gpt-6-luna`) for agent steps. Read its [coding-agent guide](https://e2e.tester.army/docs/coding-agents.md) and the installed `.agents/skills/e2e/SKILL.md` before writing or running tests. If the skill is missing, run `bun run setup:browser` to install the skill and Chromium from the locked packages.
- Use `bun run test:browser` to start the pinned local [openai-api-server-via-codex](https://github.com/hotchpotch/openai-api-server-via-codex) proxy and a fresh synthetic PostgreSQL/API/web runtime, run tests, and clean up. The proxy uses the existing authorized Codex login on an allocated loopback port; `e2e.config.ts` explicitly selects `gpt-6-luna`. Follow [the setup and test recipe](verification/testerarmy/README.md), reuse `tests/browser/synthetic-session.ts`, and run `bun run check:browser` after test changes.
- If Luna, Codex authentication, or the proxy is unavailable, report the blocker and the unverified behavior. Do not silently switch models or providers or claim agent-driven E2E verification from a mocked run.
- Before building a system in isolation, first list all the ways it could fail, then write the code.
- Follow the test scope in `docs/adr/0015-owner-delegated-decision-pass.md`.
