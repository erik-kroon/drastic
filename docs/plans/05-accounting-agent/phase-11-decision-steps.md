# Phase 11. Decision-model steps

[Overview](overview.md)

## Goal

Decision models enter runs as a measured improvement on the Phase 10 result. Each closed choice goes to the cheapest role that decides it with known reliability.

## Changes

- Extend `routeWork` routing with a role order per decision kind: rule, then firm memory, then decision model, then person. Record which role decided and why.
- Decision steps use the AUT-11 decision jobs once they are rebased and merged. Each step reads its mode from `book_decision_policies`. Shadow results are stored and never shown.
- Every provider call goes through the AUT-28 egress boundary.

## Data structures

- `RoutingRecord`. `{ step, triedRoles, decidedBy, reason }`.

## Failure cases

- A model decides where a ratified rule applies.
- Shadow output reaches any product read. Compare persisted state with shadow on and off.
- A provider call bypasses the egress boundary.
- An abstention is treated as a decision. It must become a person step.

## Verification

- Static. Changed checks, `check:changed:full`, owners.
- Runtime. Fixture-provider E2E on the Phase 3 month. Score consequence accuracy against independent gold labels with the AUT-12 harness. Report touches against Phase 10. The provider egress scan reads what the fixture provider actually received, not the egress log digests. Artifacts under `test-results/agent-p11`.

Size M. Depends on Phase 10, AUT-11, AUT-12 and AUT-28.
