# Phase 8. Missing-fact model

[Overview](overview.md)

## Goal

The system can say, deterministically, which facts are missing for a book and period. This is the largest lever on accountant time. A model cannot book a receipt nobody sent.

## Changes

- Extend the existing missing-fact vocabulary on period-work routing (`routeWork` and `missingFacts`, `packages/domain/src/period-work.ts:337`, stored in `db/period-work.ts:329-333`). Do not build a parallel model.
- Add the facts it does not cover yet, read from:
  - unmatched bank rows (`db/banking/workspace.ts:55-66`);
  - vouchers without support (Phase 2);
  - documents whose reading failed (`db/workspace.ts:545-562`);
  - unexplained control rows.
- A typed private-or-business classification, recorded by a person. Nothing records it today.
- Unmatched bank rows become readable over MCP. They are HTTP only today.
- The result feeds the Phase 1 gated check `facts_complete`.

## Data structures

- `MissingFact`. `{ id, kind, subjectRef, amountMinor, occurredOn, askable }`. `kind` extends the existing `missingFacts` strings with `receipt`, `bank_explanation`, `private_or_business`, `counterparty` and `document_unreadable`.
- `askable` is true only when the client, not the bureau, can supply the fact.

## Failure cases

- A fully allocated bank row is reported missing.
- A fact resolved after the observed cutoff counts as resolved at that cutoff.
- The same gap appears twice under two kinds.
- An unknown read is reported as "nothing missing". It must be `not_established`.

## Verification

- Static. Changed checks, owners, `test:mcp` and `test:mcp:eval`.
- Runtime. Run on the Phase 3 month. Every seeded gap appears exactly once and no complete item appears. Artifacts under `test-results/agent-p8`.

Size M. Depends on Phases 1 to 3. Can run in parallel with Phases 4 to 7.
