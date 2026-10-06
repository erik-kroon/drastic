# Luna browser E2E

Before implementation, failure obligations: refuse existing listeners rather than reuse a company database; fail on missing PostgreSQL, Node, Bun, uvx or Codex authentication; use only the disposable launcher's synthetic account; preserve failed HTTP responses and model errors; never replace Luna or mock application boundaries; retain deterministic assertions, screenshots and model evidence; stop owned processes and delete private credentials on success, failure and interruption.

The first test creates a synthetic supplier through the browser, reloads the application, searches by its reference, and verifies the retained name/reference/role. Expected values are specified in the test before observing application output. Contact creation must not issue invoices, post accounting or contact a provider.

## First setup

Requirements: the repository's Bun version, Node 24.8+ (or Node 22.22.3+), `npx`, `uvx`, PostgreSQL binaries discoverable through `pg_config` (or `PG_BINDIR`), and an authorized ChatGPT-mode Codex login. If the proxy reports missing/expired authentication, run `codex login` yourself; credentials remain in the local Codex auth store.

```bash
bun install --frozen-lockfile
bun run setup:browser
bun run test:browser
```

`setup:browser` copies the skill shipped by the locked e2e package into `.agents/skills/e2e/` and installs its matching Chromium. It does not rewrite existing E2E scripts or MCP configuration. Read that skill before adding tests; `npx --no-install e2e guide writing-tests` also works offline after installation.

`test:browser` owns a pinned `openai-api-server-via-codex==0.2.1` process on a free loopback port, plus the existing disposable PostgreSQL/Worker/web launcher on a separate free loopback port. It allocates ports independently for concurrent agents and refuses collisions, uses fresh synthetic credentials, disables replay and retries, and stops its processes on exit. The launcher announces its owned scratch path at startup; if its asynchronous teardown leaves PostgreSQL running, the wrapper stops that exact cluster with `pg_ctl` before deleting its private directory. It never attaches to the normal development app. The test config explicitly selects `gpt-6-luna`; a model/provider failure stays a failure.

The default run uses real model calls. To retain model-call diagnostics:

```bash
bun run test:browser --ai-trace
bun run check:browser
```

Each run prints its unique results directory under `test-results/testerarmy/<run-id>/`: `report.json`, `summary.md`, screenshots, video and Playwright traces. `app.log` and `proxy.log` explain startup failures. If startup fails before the directory is printed, inspect the newest subdirectory under `test-results/testerarmy/`. These are local ignored artifacts; browser traces can contain session cookies. Share only reviewed, credential-free evidence. Concurrent and later runs keep separate reports, startup logs and artifacts. `verification/testerarmy/evidence/` retains the checked sample run.

## Add another test

Put tests under `tests/browser/*.e2e.ts`. Import `test` from `@e2e-dev/web` and `expect` from `e2e`. Reuse `signInSyntheticOperator(browser, app.baseUrl)` from `synthetic-session.ts`; it uses the actual password-auth endpoint and hands its returned cookie to Chromium. Passwords are never typed into agent-visible screens. All test writes disappear when the disposable database is removed.

Use one bounded `agent.act` goal followed immediately by an exact assertion. Use semantic locators for exact values and known fields. The sample deliberately uses deterministic directory search: the app has both a global page/invoice search and a separate contact filter. It verifies one match for the saved reference and zero matches for an unknown reference.

Run a selected file through the same lifecycle:

```bash
bun run test:browser tests/browser/supplier.e2e.ts
```

Do not run `npx e2e run` directly against an arbitrary existing application. The wrapper supplies `OPENERP_E2E_SESSION` from its fresh launcher; the helper refuses a session for another target.

The wrapper supplies `OPENERP_E2E_APP_URL`, `OPENERP_E2E_PROXY_URL` and `OPENERP_E2E_OUTPUT` to the config. Do not override them to point at an existing company runtime.

## Native reviewed supplier group

Use `PAPER_WORK_GROUP=1` to provision the native group's BAS 6110, 2440 and 2641 accounts. The test checks those scoped active accounts before creating any evidence or draft; a missing or ambiguous fixture chart fails that preflight. Select one fixture profile per runtime: the supplier-expiry profile supplies its own 2440 account. Native review grants and postings use the synthetic browser session and independent original evidence.

```bash
PAPER_WORK_GROUP=1 bun run test:browser tests/browser/posting-work-group.e2e.ts
```

The test retains `work-group-results.json`, interrupted/recovered screenshots and the runner's trace/report. A passing run must establish independent native receipts, original-key recovery, exclusion of changed/new supplier proposals and net 20000, input VAT 5000 and payable credit 25000 minor units.
