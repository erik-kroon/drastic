# Phase 3. Synthetic bureau month and baseline

[Overview](overview.md)

## Goal

Build the lever every later phase is measured with. A script creates a synthetic bureau month. A scorer compares any end state with independently authored gold expectations. The baseline is captured before any run exists, so later results read as "old value against new value".

## Changes

- **Scenario catalog**, in `docs/operations/`, written before the generator. It gives a gold end state for every gated check, for every book. It is authored independently of the implementation, like the existing automation vector files.
- **Generator** under `verification/agent-mode/`. From a fixed seed it builds three firms and twelve books through the public API. Scenarios include:
  - recurring suppliers and a first-time supplier;
  - a missing receipt and an unexplained bank row;
  - a private purchase and a duplicate invoice number;
  - a changed bankgiro and a foreign-currency invoice;
  - a partial payment;
  - a rate change on a boundary date, modelled on the 2026-04-01 food VAT change.
- **Operator seeding step** for rule releases. The runtime can only read `rule_releases` (`migrations/0004-next-02.sql:169`), and no install route exists. The generator therefore installs synthetic releases through a documented operator script, the way tests do. This is the only step that writes to PostgreSQL directly.
- **Canonical end-state projection.** It compares business keys and amounts, and leaves out server ids, timestamps and voucher numbers, which differ between runs. Kill-and-resume checks and the scorer both use it.
- **Scorer.** Reads the Phase 1 predicate and the projection, then writes one verdict per gold expectation, including which gated checks moved from fail to pass against the baseline.
- **Baseline run.** Records the human operations the current product needs to reach the same end state.

## Data structures

- `Scenario`. `{ id, book, inputs, expected: { gatedChecks, postings, questions, items } }`.
- `Projection`. A sorted list of business-keyed rows with a digest.
- `ScoreReport`. `{ revision, seed, perExpectation: VERIFIED | NOT_VERIFIED | INCONCLUSIVE, checksMovedToPass, touches, handled }`.

## Failure cases

- The generator writes to PostgreSQL outside the operator seeding step.
- Two runs with the same seed produce different projection digests.
- The scorer passes when the predicate is `inconclusive`.
- Gold expectations are edited after implementation starts without a recorded reason.

## Verification

- Static. Changed checks.
- Runtime. Run the generator twice and compare projection digests. Run the scorer on the untouched month. It must report the expected failures, not pass. Retain `verification/agent-mode/baseline.json`.

Size M. Depends on Phase 1. Use `/skill:create-verification-skill` so every delegate reruns the same harness.
