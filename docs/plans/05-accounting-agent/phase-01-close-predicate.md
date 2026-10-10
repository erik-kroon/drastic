# Phase 1. Close predicate (implements AUT-06)

[Overview](overview.md)

## Goal

One read operation answers "is this book and period done?" as typed check results. Every later phase uses it as its exit predicate. This is the riskiest unknown. If "done" cannot be expressed in code, no run can be verified.

This phase is the AUT-06 implementation. Its independent expectations already exist in `docs/operations/automation-coverage-vectors.md` and are not rewritten here.

## What exists, and what cannot pass today

- **Callable checks that can pass:**
  - bank reconciliation status `complete` (`banking/reconciliations.ts:537`);
  - bank source coverage and sign-offs;
  - the actual VAT return control (`vat/actual-return.ts`);
  - the tax account (`vat/tax-account.ts`).
- **Owners whose schemas fix "not covered":**
  - closing provider `coverage` is `Literal("not_established")` (`contracts/closing-providers.ts:127`);
  - VAT draft `ledgerReconciled` and `coverageEstablished` are `Literal(false)` (`contracts/closing-providers.ts:69-72`);
  - subledger `controlAccountReconciled` is `Literal(false)` (`contracts/closing.ts:37`).
- **Not built:** AP and AR against counterparties.
- **Already composed:** `firm-portfolio.ts:200` combines closing readiness with a stale-read check.

## Changes

- A coverage owner that records each check's outcome with its observed cutoff, its dependency digests and its builder version. It evaluates freshness separately from the retained outcome, as the AUT-06 vectors require.
- A **gated check set** for month close. It contains only checks that can reach `pass`:
  - bank reconciliation and coverage;
  - supporting documents (Phase 2);
  - complete facts (Phase 8);
  - no open reviews or questions;
  - the actual VAT return control.

  Every other check is reported as `not_established` with its named reason, and never counts toward `done`.
- An HTTP read and a `read` MCP capability through the existing catalog and agent policy.

## Data structures

- `CheckRecord`. `{ checkId, status: pass | fail | not_established | not_run, observedCutoff: { ledgerSequence, dependencyDigests }, builderVersion, evidenceRefs }`.
- `ClosePredicate`. `{ bookId, periodId, gated: CheckRecord[], reported: CheckRecord[], verdict: done | not_done | inconclusive }`.
  - The verdict is `done` only when every gated check passes and is fresh.
  - `inconclusive` when any gated check is `not_run`, `not_established` or stale.

## Failure cases

The AUT-06 vectors, plus these:

- A check outside the gated set changes the verdict.
- An old passing record counts after its dependencies changed.
- A read through MCP writes anything. Row counts must be unchanged.

## Verification

- Static. `bun run check:changed`, `check:changed:full`, `check:owners`.
- Runtime. E2E for every AUT-06 vector over HTTP and MCP. `bun run test:mcp` and `test:mcp:eval` because the catalog changes. Artifacts under `test-results/agent-p1`.

Size M. Depends on nothing.
