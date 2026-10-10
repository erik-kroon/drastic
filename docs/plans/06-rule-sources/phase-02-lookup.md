# Phase 2. Rule lookup

[Overview](overview.md)

## Goal

One operation answers a question for a given date with ranked passages, their authority and their validity. The same operation serves the app, MCP and run steps. Explanations may cite it. Treatments never come from it.

## Changes

- `lookupRule(question, date)` over the Phase 1 corpus. It returns passages with source kind, authority and effective interval. Conflicts and missing sources return `unknown`, never a guess.
- An MCP `read` capability and an HTTP route.
- Review explanations (AUT-14) can cite a passage next to the rule release that decided the treatment.
- A gold question set, written before implementation. It includes date-boundary pairs such as food VAT on 2026-03-31 and on 2026-04-01.

## Data structures

- `LookupResult`. `{ passages: { citation, sourceKind, authority, validFrom, validTo, excerpt }[], conflicts, status: answered | unknown }`.

## Failure cases

- A passage valid only after the asked date is returned.
- A weaker source outranks a stronger one on the same point.
- An official position is presented as law.
- The query text reaches any external service. Queries reveal client situations.

## Verification

- Static. Changed checks, owners, `test:mcp`, `test:mcp:eval`.
- Runtime. Score the gold set and retain the report. Every date-boundary pair must be correct. Artifacts under `test-results/rules-p2`.

Size M. Depends on Phase 1.
