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
| AUT-27 | [DRA-255](https://linear.app/drastic-dev/issue/DRA-255/aut-27-require-two-approvers-to-grant-a-mandate) |
| AUT-D01 | [DRA-245](https://linear.app/drastic-dev/issue/DRA-245/aut-d01-explanation-and-provenance-in-review-k-11) |
| AUT-D02 | [DRA-246](https://linear.app/drastic-dev/issue/DRA-246/aut-d02-correction-to-rule-prompt-k-11) |
| AUT-D03 | [DRA-247](https://linear.app/drastic-dev/issue/DRA-247/aut-d03-batch-review-with-deviation-highlighting-k-10-granska-alla) |
| AUT-D04 | [DRA-248](https://linear.app/drastic-dev/issue/DRA-248/aut-d04-anomaly-rows-and-bank-detail-change-k-11-and-m-01) |
| AUT-D05 | [DRA-249](https://linear.app/drastic-dev/issue/DRA-249/aut-d05-stickprov-judge-then-reveal-k-11-variant) |
| AUT-D06 | [DRA-250](https://linear.app/drastic-dev/issue/DRA-250/aut-d06-regler-och-mandat-k-09-firm-level-and-book-level) |
| AUT-D07 | [DRA-251](https://linear.app/drastic-dev/issue/DRA-251/aut-d07-presence-step-up-and-enrolment-k-05-dialog-family) |
| AUT-D08 | [DRA-252](https://linear.app/drastic-dev/issue/DRA-252/aut-d08-what-was-handled-automatically-k-10-klart-k-09-rows) |
| AUT-D09 | [DRA-253](https://linear.app/drastic-dev/issue/DRA-253/aut-d09-byrans-modell-the-firm-model-page-k-95-family) |
| AUT-D10 | [DRA-254](https://linear.app/drastic-dev/issue/DRA-254/aut-d10-client-consent-through-a-client-question-k-12-k-13-client) |

## Execution contract

Work through ready issues in dependency order, starting with AUT-01. Use synthetic data and fixture providers. Provider egress, real books, firm learning and design-pending UI remain gated by their issue requirements.

The goal remains active until all authorized ready work is implemented and verified, or a documented external prerequisite prevents further progress.

## Current slice

AUT-01 (`e685811`) and AUT-02 (`15a1b5c`) are implemented locally and in review in Linear. AUT-03 is in progress. Failure cases are defined before implementation.

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

## AUT-02 checkpoint

Local commit `15a1b5c` seals operator-only exports from one SQL snapshot, preserves captured state and exact financial values, resolves committed correction and withdrawal receipts, excludes personal owners before payload reads, and permits only independent/corrected evaluation labels. Missing historic captures and option universes remain explicit.

Full changed checks passed with the supported 180-second timeout after a competing agent check caused the default timeout. Owners passed (52/52). Nine focused journeys passed in `test-results/dra220-final`; its CLI mount-path failure was fixed and superseded by the passing `test-results/dra220-seal-final` rerun. The final uncited-exposure regression passed in `test-results/dra220-uncited-final`. Source integrity stayed stable. Repeatable commands, JSONL and manifest evidence are indexed in `verification/decision-examples/README.md`. No production training, provider flow, UI delivery or MCP catalog change is claimed.

## Design and mandate reconciliation

The updated handoff has 38 child issues, including AUT-27 and AUT-D01 through AUT-D10. The owner approved Paper page 21 on 2026-10-10: https://app.paper.design/file/01M3M9A2DA2G08DSJA5K8ZE68S/p-1E-0 . Its current A-01/A-01b, A-02, A-05/A-05b and A-06 boards are adopted for matching states. Missing or unfinished states remain pending; browser and parity evidence are separate. Linear retains the original backend dependencies plus design gates.

Use the existing canon: evidence rather than percentages in ordinary review, consequence summaries, blind spot checks, correction-to-rule prompts and existing statuses. AUT-27 must retain preparation separately from two approvals because M-01 excludes the preparer. AUT-00's proposed settings-governance policy remains open.

## AUT-03 expectations

The independently written vectors in `automation-consequence-vectors.md` predate implementation. Mapping content checksum, explicit VAT category, normalized deduction, accounting period and captured dimensions determine known classes. Missing facts produce unknown; current mappings and rates cannot fill historical gaps.

## AUT-03 checkpoint

Local commit `8b2a1bb` adds the consequence classifier and its real sealed-export consumer. Known identities pin mapping and VAT profile content, normalized resolved rate/deduction, category, frozen period and required dimensions. Missing captures remain unknown. New exports are v2; immutable v1 seals remain readable.

Four selected synthetic workflows passed, including 21 independent vectors (three equivalent, six different, twelve unknown), public review/export, correction lineage and identical export files. Artifacts are retained in `test-results/dra221-stable`; repeatable commands are in `verification/treatment-consequence/README.md`. Full changed checks and owners (53/53) passed. AUT-03 paths remained unchanged after verification; unrelated concurrent firm changes were preserved. No production mapping or VAT qualification, push, merge or deployment is claimed.

## AUT-04 boundary

Investigate the Swedish VAT owner before implementing explicit purchase categories. Existing approved rational rates remain authoritative. An opt-in category must resolve against the retained effective immutable profile and agree with the exact treatment. Missing category rules or entitlement evidence refuse that opt-in path. Synthetic release boundaries prove the mechanism, not legal qualification. Old posted history is not inferred or rewritten.

## AUT-04 checkpoint and Clef priority

Local commit `cb41384` adds single-line supplier-accrual VAT category opt-in with exact treatment matching and independently reviewed immutable source support. Supersession/withdrawal refuse current work, while posted replay remains unchanged. Stored categories reach exports and hints; old records stay category-unknown. Strict HTTP requests reject forged witnesses.

Final stable synthetic HTTP workflows passed 2/2, with 17 refusal/freshness cases and zero reviews retained by failed preparations. Deterministic MCP passed 3/3; pinned Luna evaluation passed 1/1 across six iterations. Full changed checks, owners (53/53) and diff checks passed. Evidence and repeatable commands are in `verification/vat-purchase-categories/README.md`. No production tax qualification, live-provider call, browser qualification, push, merge or deployment is claimed.

The owner asked when Clef would be added. Prioritize AUT-09 question catalog, then AUT-10 Clef/shared adapter. AUT-11 depends on AUT-05 memory, so complete that prerequisite before shadow jobs and AUT-12 evaluation. Other memory/anomaly/rule work remains queued. AUT-13 live qualification retains its data-use gate. The independent decision vectors are committed before implementation.

## AUT-09 checkpoint

Local commit `922bc73` adds the admitted book catalog, strict SystemOne schemas and full-distribution validation. Server-authored criteria/builders/options are digested; statistics confer no authority. Explicit cardinality skips never truncate. The near-uniform confidence regression was reproduced before its bounded-statistic fix; original probabilities remain intact.

Final workflows passed 2/2 with nine independent gold vectors, fourteen response refusals, four invalid requests, five invalid scores, limit boundaries and digest checks. Evidence is `test-results/dra227-final`, source hash `dd40dc3c5fd0f30d1f6f80eae68bf7fed3115230d2420afca75ae9430ee82670`; repeat commands and protocol limits are in `verification/decision-questions/README.md`. Changed/full checks and owners (54/54) passed. No provider, queue, stored result, UI, MCP or production qualification was added.

AUT-10 is now in progress: shared HTTP validation and a genuine injected Workers AI port. Its independent failure cases predate implementation. Disabled mode remains the default. Reported hosted selectors and immutable weight revisions remain separate facts; source wiring does not qualify a live provider or deploy it.

## AUT-10 checkpoint

Local commit `7bd752d` adds the shared HTTP adapter, injected Workers AI port and explicit runtime configuration. Disabled mode makes no calls; bounded wire JSON rejects duplicate keys, malformed UTF-8 and oversized responses. Deadlines cover headers and body. Reported identity remains separate from configured release; immutable-weight qualification remains unsubstantiated.

Three focused workflows passed, including two authored adapter fixtures and the existing Azure failure regression. Changed/full checks, owners (54/54) and diff checks passed. Evidence and repeatable commands are in `verification/decision-models/README.md` and `test-results/dra228-focused`, stable source hash `3d4765067b96742f090d523965e3d28a48c947572ddfb63be0f19107d0a4d6bd`. No live binding activation, provider call, deployment or new MCP surface occurred.

AUT-05 is now in progress. Its independent memory vectors predate implementation. Same-book retained facts, correction lineage and temporal holdout determine precedent and baseline evidence; missing historical facts remain unknown. Shadow jobs and evaluation follow this prerequisite, with anomaly and remaining ready work retained in the goal.
