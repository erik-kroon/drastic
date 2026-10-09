# MCPJam verification

Failure obligations, before implementation: an incompatible MCP handshake or schema must fail; unauthenticated and foreign-book access must be refused; the agent catalog must expose no approval writes; execution without a real operator approval must leave the ledger unchanged; an approved execution retried with its original key must return the same receipt and post once. Model evals must fail when the model selects the wrong tool or scope, approves or writes during a read-only task, times out, or cannot authenticate. Never replace real model calls with mocks or silently switch models/providers. Credentials, request headers and raw SDK errors must stay out of published evidence. Every manager connection and owned proxy process must be closed on failure as well as success.

The tests use the existing disposable PostgreSQL/API E2E harness and synthetic agent credentials. Deterministic MCPJam workflows run on every PR. Real-model evals use `gpt-6-luna`, three iterations per case, zero retries, exact tool arguments and persisted ledger assertions. The supported MCP versions are checked separately; no SSE fallback is allowed. This does not qualify OAuth, MCP Apps or production providers, which this endpoint does not offer.

## Run locally

```sh
bun install --frozen-lockfile
bun run check:react
bun run test:mcp
bun run test:mcp:eval
```

`check:react` scans the full web application and shared UI package, fails on errors and retains warnings in `test-results/react-doctor/report.json`. Frontend changes also run it automatically through `check:changed` and `check:changed:full`. React Doctor runs its own curated rules; the existing Oxlint checks still enforce the repository rules, including path-specific primitive exceptions. Importing that root configuration into separate React Doctor project scans loses the root-relative override paths, so those checks stay with their authoritative Oxlint runner. Score uploads, share URLs, crash reporting and dependency network scans are disabled.

`test:mcp` runs the existing admission test and MCPJam real-client workflows through fresh PostgreSQL/API instances. `test:mcp:eval` starts the same pinned `openai-api-server-via-codex==0.2.1` proxy as TesterArmy, on an allocated loopback port, and runs Luna against a separate disposable E2E runtime. It requires `uvx` and an existing authorized ChatGPT-mode Codex login. No API key is needed locally and no credentials are copied out of the local auth store. The model sees the real exposed catalog. Ledger selection checks the exact scope and permits only catalog-declared reads; the refusal case starts with an actual unapproved proposal and requires a human/operator handoff. Neither case may alter the independently read stored ledger.

MCPJam SDK telemetry is disabled. Model runs retain unique directories under `test-results/mcpjam/` with `run.json`, the existing source/migration/lock manifest, Vitest JSON/JUnit results and credential-free case observations. Deterministic runs retain `mcpjam-protocol-*.json` alongside their normal E2E reports. Failed model calls remain failures; the runner does not retry or change providers. Review synthetic text and tool results before sharing evidence.

## CI

React Doctor and deterministic MCPJam workflows run on pull requests and main pushes, with uploaded artifacts. The OpenAI-backed Luna eval step is installed but **disabled at the user's request**. To enable it later, add the repository secret `MCPJAM_OPENAI_API_KEY` and set repository variable `MCPJAM_MODEL_EVALS` to `enabled`. `bun run test:mcp:eval --ci` selects that explicit OpenAI transport; it refuses a missing key. Local runs always use the pinned Codex proxy.

These checks establish synthetic application behavior, not production qualification. Disabled CI evals provide no model verification claim.
