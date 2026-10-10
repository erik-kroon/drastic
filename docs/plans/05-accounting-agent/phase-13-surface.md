# Phase 13. Product surface and MCP playbooks

[Overview](overview.md)

## Goal

People can start, watch, pause and hand over a run, and answer its questions. Bureaus' own agents can follow the same playbooks over MCP.

## Changes

- Paper boards before any UI, following the page 00 delivery contract.
  - **AUT-D11 run view.** Outcome, plan preview with skipped steps, progress, gated checks, waiting items, and an end state such as "41 klara, 9 behövde dig".
  - **AUT-D12 batched client question.** Client audience.
- Board requirements from the external research report:
  - Show three things separately: execution status, accounting-check status, and outstanding responsibility, with the person responsible.
  - A skipped step says whether it was not applicable, already satisfied or blocked.
  - An uncertain outcome says that it is being reconciled or needs an operator decision. There is never a plain retry button.
  - The end state lists checks passed, unsupported and blocked, and what changed in the book. "Done" never sits over unresolved statutory work.
  - Batch approval names every included revision.
- UI implementation only after explicit adoption. Each change updates `verification/paper/kanon-manifest.json` in the same change, and visual evidence is kept separate from behaviour evidence.
- MCP `prompts/*` and `resources/*` methods. Today `transport/mcp.ts` advertises tools only.
  - First compare extending that transport with Effect's `McpServer` (`effect/unstable/ai`), which already composes resources, prompts and a toolkit.
  - Each playbook is published as a prompt with the same steps and checks as the in-app run. It lists only tools the agent policy exposes.

## Failure cases

- A screen introduces a ninth status, or a percentage in a work screen.
- A baseline is regenerated from candidate code.
- An MCP prompt lists a step whose tool the agent policy withholds.

## Verification

- Static. `check:design` against the PR base, changed checks, `check:browser`.
- Runtime. `bun run test:browser` with TesterArmy and Luna for the run view and the question journey. `test:mcp` and `test:mcp:eval` for prompts. Artifacts under `test-results/agent-p13`.

Size L. Boards can start now. UI depends on Phases 7 and 9 and on adoption.
