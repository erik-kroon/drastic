# Automation implementation ledger

Parent issue [DRA-217](https://linear.app/drastic-dev/issue/DRA-217/layered-accounting-automation-adr-0021).

## Issue map

| Handoff | Linear issue |
| --- | --- |
| AUT-00 | [DRA-218](https://linear.app/drastic-dev/issue/DRA-218/aut-00-decide-the-automation-basis-and-firm-learning-legal-footing) |
| AUT-01 | [DRA-219](https://linear.app/drastic-dev/issue/DRA-219/aut-01-record-decision-provenance-for-every-human-treatment-decision) |
| AUT-02 | [DRA-220](https://linear.app/drastic-dev/issue/DRA-220/aut-02-derive-the-decision-example-ledger-from-immutable-history) |
| AUT-03 | [DRA-221](https://linear.app/drastic-dev/issue/DRA-221/aut-03-define-accounting-consequence-equivalence) |
| AUT-04 | [DRA-222](https://linear.app/drastic-dev/issue/DRA-222/aut-04-treat-vat-as-categories-resolved-by-the-rule-profile) |
| AUT-05 | [DRA-223](https://linear.app/drastic-dev/issue/DRA-223/aut-05-firm-memory-v1-deterministic-versioned-precedent) |
| AUT-06 | [DRA-224](https://linear.app/drastic-dev/issue/DRA-224/aut-06-verification-coverage-per-book-and-period) |
| AUT-07 | [DRA-225](https://linear.app/drastic-dev/issue/DRA-225/aut-07-deterministic-anomaly-flags-on-prepared-supplier-work) |
| AUT-08 | [DRA-226](https://linear.app/drastic-dev/issue/DRA-226/aut-08-learned-then-ratified-propose-explicit-rules-from-stable) |
| AUT-09 | [DRA-227](https://linear.app/drastic-dev/issue/DRA-227/aut-09-decision-question-catalog-and-contracts) |
| AUT-10 | [DRA-228](https://linear.app/drastic-dev/issue/DRA-228/aut-10-systemone-adapter-and-fixture-provider) |
| AUT-11 | [DRA-229](https://linear.app/drastic-dev/issue/DRA-229/aut-11-decision-persistence-jobs-per-book-policy-and-precedent-in) |
| AUT-12 | [DRA-230](https://linear.app/drastic-dev/issue/DRA-230/aut-12-shadow-questions-v1-and-evaluation-harness) |
| AUT-13 | [DRA-231](https://linear.app/drastic-dev/issue/DRA-231/aut-13-qualify-clef-flash-and-jev-in-shadow) |
| AUT-14 | [DRA-232](https://linear.app/drastic-dev/issue/DRA-232/aut-14-suggestions-with-provenance-in-supplier-and-bank-review) |
| AUT-15 | [DRA-233](https://linear.app/drastic-dev/issue/DRA-233/aut-15-order-att-gora-by-materiality-and-unusualness) |
| AUT-16 | [DRA-234](https://linear.app/drastic-dev/issue/DRA-234/aut-16-firm-learning-consent-model) |
| AUT-17 | [DRA-235](https://linear.app/drastic-dev/issue/DRA-235/aut-17-cross-book-precedent-within-a-firm) |
| AUT-18 | [DRA-236](https://linear.app/drastic-dev/issue/DRA-236/aut-18-training-manifest-and-encrypted-export) |
| AUT-19 | [DRA-237](https://linear.app/drastic-dev/issue/DRA-237/aut-19-firm-adapter-training-service) |
| AUT-20 | [DRA-238](https://linear.app/drastic-dev/issue/DRA-238/aut-20-firm-model-release-registry-promotion-and-retirement) |
| AUT-21 | [DRA-239](https://linear.app/drastic-dev/issue/DRA-239/aut-21-serve-firm-adapters) |
| AUT-22 | [DRA-240](https://linear.app/drastic-dev/issue/DRA-240/aut-22-mandate-terms-over-consequence-classes-and-decision-conditions) |
| AUT-23 | [DRA-241](https://linear.app/drastic-dev/issue/DRA-241/aut-23-conformal-calibration-records) |
| AUT-24 | [DRA-242](https://linear.app/drastic-dev/issue/DRA-242/aut-24-agent-watchdog-questions-and-mandate-suspension) |
| AUT-25 | [DRA-243](https://linear.app/drastic-dev/issue/DRA-243/aut-25-measure-firm-learning-per-book) |
| AUT-26 | [DRA-244](https://linear.app/drastic-dev/issue/DRA-244/aut-26-completeness-chasing-agent) |

## Execution contract

Work through ready issues in dependency order, starting with AUT-01. Use synthetic data and fixture providers. Provider egress, real books, firm learning and design-pending UI remain gated by their issue requirements.

The goal remains active until all authorized ready work is implemented and verified, or a documented external prerequisite prevents further progress.

## Current slice

AUT-01 is implemented in local commit `e685811` and in review in Linear. AUT-02 is in progress. Failure cases are defined in the handoff before implementation.

- Blocking first steps. Trace trusted actor/session, served suggestions, command replay and transaction ownership before edits.
- Independent workstreams. Read-only grounding may run together. One implementation owner changes the coupled provenance paths.
- Shared mutable state. Each suggestion and decision retains book/subject/actor/session identity. Provenance writes use the decision's existing transaction.
- Smallest safe decomposition. Implement AUT-01 as one coherent change because contracts, suggestion serving and decision recording must agree. Run required checks sequentially and one focused E2E journey.

## Task steps

1. State the exit condition as a checkable predicate before the first iteration (tests green, repro fixed, all N PRs merged, pixel-diff zero).
2. Pick the wake mechanism from CODEX.md.
3. Each iteration makes the smallest change the evidence justifies, verifies it against the predicate, commits if it advanced, discards changes that didn't help.
4. Address discoveries within the authorized task.
5. Checkpoint every iteration.
6. Stop when the predicate is met.

The active goal owns continuation. No future heartbeat is configured.

## AUT-01 design

Model the Domain led to explicit subject and selection variants. Supplier treatment,
extraction fields and bank matches carry different meaning, so their application
owners compare the selected values. A shared owner validates exposure identity,
detects omitted citations and writes append-only provenance in the caller transaction.

| Candidate | Benefit | Cost | Decision |
| --- | --- | --- | --- |
| A. Shared validation and classification | One policy location | Can mix supplier, extraction and bank equivalence | Keep shared validation and class precedence |
| B. Owner comparisons with shared persistence | Existing owners retain accounting meaning | Requires typed comparison ports | Adopt with shared exposure validation |

An account and VAT-rate hint covers only those dimensions. Agreement with that hint
does not establish that the full treatment was accepted unchanged. Retain its field
comparison and classify incomplete coverage conservatively as `unknown_exposure`.
Suggestions from earlier sessions still establish exposure for the same actor and
subject. A client cannot select `batch_approved` or `historical_import`.

Sequence Work into Verifiable Units keeps AUT-02 implementation behind AUT-01's
checks and focused synthetic journey. Read-only preparation can continue while the
single implementation owner works.

## AUT-01 checkpoint

Full changed checks, owners (52/52), deterministic MCP (3 tests) and pinned Luna MCP evaluation passed. Six synthetic HTTP journeys retained 13 decisions across all six provenance classes. Two final extraction journeys prove uncited suggestion acceptance remains unknown. Commands and evidence are indexed in `verification/decision-provenance/README.md`; artifacts are under `test-results/dra219-provenance-final`, `test-results/dra219-extraction-final-stable`, and `test-results/mcpjam/8bd1d8b2-735b-4676-b7d1-83b843ae085d`.

Browser transport remains source/TypeScript verified only. No browser parity, live-provider performance or real-company benefit is claimed. The commit is local; no push, merge or deployment occurred.

## AUT-02 design boundary

Export immutable captured evidence with pinned projection, lineage and redaction versions. Keep the original decision cutoff separate from the export lineage cutoff. Missing historical capture is an explicit counted exclusion; current account, draft and counterparty heads cannot reconstruct history. Redact typed document text while preserving exact financial values. Seal export inventory and retain canonical example and manifest digests.

