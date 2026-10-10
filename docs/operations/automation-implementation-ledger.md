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

## AUT-05 checkpoint

Local commit `d5c199d` replaces the latest-five query with retained same-book precedent, correction-aware labels and deterministic ranking. Suggestion records preserve both full precedents and the exact compatible items returned to the current client. New sealed examples are v3; old immutable exports remain readable.

Four focused workflows passed across retained runs: memory vectors, the Swedish hint/provenance regression, the shared public reversal/export workflow and the corrected public serving/CLI workflow. The synthetic baseline has two eligible targets, one suggestion and zero known comparable consequences: coverage 1/2 and accuracy unavailable. Changed/full checks and owners (55/55) passed. `verification/firm-memory/README.md` records commands, artifacts, CLI fixes and the distinction between retained behavior-run hash and final type hardening. No browser parity, live-provider performance, training or production qualification is claimed.

AUT-11 is now in progress: immutable requests/results, fenced background dispatch, read-only runtime policies and bounded synthetic budgets. Independent failure cases are already committed. Add a bounded machine-runner processing surface so the Cloudflare entry can genuinely inject its AI binding into the shared processor; configuring or invoking a live deployment remains gated. AUT-12 evaluation and remaining anomaly/verification work follow.

## PR 19 owner review, 2026-10-10

AUT-11 is parked in unpushed local checkpoint `4958339` on `automation/aut11-parked-2026-10-10`. One focused workflow passed and one failed at queued delivery; full and owners checks were not run. It remains incomplete and will resume after the owner review fixes.

Accepted ADR 0021 and the handoff are committed in `36711e2`. Main through `295d0b4` is merged in `6a73127`; migrations 0106 and 0107 follow main's 0105. Main's design entries and immutable references are retained. K-10, K-11 and K-21 are unverified because their retained source hashes predate request transport changes; no composition, baseline or new visual evidence is adopted. Erik Kroon adopted the AUT-01 request transport scope on 2026-10-10.

A clean worktree at `6a73127` ran the seven affected automation suites: 15 of 16 tests passed. The stale consequence test expected export v2 despite current v3 exports; `477f381` corrects that assertion. Its two-test suite passed in a clean worktree at that commit. Artifacts are `test-results/pr19-main-merge` and `test-results/pr19-main-merge-consequence` in `/tmp/drastic-pr19-review-6a73127`. Final clean-worktree checks against the PR base remain outstanding.

## Merged PR and follow-up checkpoint

PR 19 merged at `8cc665e` before the owner corrections. They continue in draft [PR 20](https://github.com/erik-kroon/drastic/pull/20), on `automation/pr19-review-fixes`; main is not pushed by this work. The accepted documents and transport adoption are included in that follow-up.

Clean worktree `400e569`, against main `8cc665e`, passed `check:changed:full origin/main`, `check:owners` (55/55), and `check:design origin/main`; tracked status remained clean. The preceding full check at `6e9b3d1` against older main failed on missing generated web route/localization types and is not a passing qualification. No current visual parity is claimed.

The independently authored [owner review failure cases](automation-review-failure-cases.md) govern the remaining fixes in owner order. AUT-11 remains parked locally at `4958339` until those fixes and their evidence are complete.

## Owner review: extraction bounds and capture resilience

The extraction envelope now derives from its contract bounds: 64 header fields plus 50 lines with 16 fields each, or 864 fields. Every suggestion variant decodes before insertion. An undecodable retained suggestion is a counted `undecodable_capture` exclusion, without aborting valid examples in the same seal. Other retained review, correction and document schemas remain strict.

The fully unfixed public preparation failed with 457 merged fields; a separate unfixed export failed on a malformed capture. Supplemental evidence restored only the old 400-option schema and is explicitly distinguished from a fully unfixed checkout. Four focused workflows passed across retained runs: three in `pr20-extraction-final`, then the corrected native eligibility assertion in `pr20-extraction-native-final`. The native path commits 457 decisions with a 407-option native-derived citation, while its ordinary preview serves seven header options. It seals successfully with 457 `source_text_not_captured` exclusions and zero native training examples; the existing hash-only owner is preserved. The malformed-capture seal retains one valid example and one exclusion. Four invalid suggestion variants insert no rows.

[Extraction evidence](../../verification/extraction-review-bounds/README.md) records exact hashes, commands, fixture corrections and the observed summary. The changed check and read-only review passed. Clean-HEAD full/owners/design and required MCP deterministic/evaluation checks are the gate before advancing to bank citations. No provider, browser parity, visual baseline, history rewrite or statutory qualification is claimed. Implementation is isolated in `/tmp/drastic-pr19-review-6a73127`; concurrent AUT-28 edits in the primary workspace are preserved.

That gate passed at clean HEAD `111f1e9` against main `8cc665e`: full changed checks, owners (55/55), design contract, three deterministic MCP tests and one pinned Luna MCP evaluation. Tracked status stayed clean. MCP evidence is `test-results/pr20-extraction-mcp` and `test-results/mcpjam/3ad212d9-2437-473e-9cbe-97d01efed133`. The design contract measured zero matching screens and is not visual comparison evidence. The verified source is pushed only to draft PR 20. Bank citations are next; other owner review items and AUT-11 remain incomplete.
## Approved phase issue map, evening update

| Handoff | Phase | Linear issue |
| --- | --- | --- |
| AUT-28 | Egress | [DRA-256](https://linear.app/drastic-dev/issue/DRA-256/aut-28-enforce-the-ai-egress-boundary) |
| AUT-06 | Plan 05 | [DRA-224](https://linear.app/drastic-dev/issue/DRA-224/aut-06-verification-coverage-per-book-and-period) |
| AUT-33 | Plan 05 | [DRA-257](https://linear.app/drastic-dev/issue/DRA-257/aut-33-supporting-document-per-voucher) |
| AUT-32 | Plan 05 | [DRA-258](https://linear.app/drastic-dev/issue/DRA-258/aut-32-synthetic-bureau-month-and-deterministic-baseline) |
| AUT-29 | Plan 05 | [DRA-259](https://linear.app/drastic-dev/issue/DRA-259/aut-29-run-engine-and-deterministic-playbooks) |
| AUT-29-P4 | Plan 05 | [DRA-260](https://linear.app/drastic-dev/issue/DRA-260/aut-29-p4-run-model-and-architect-arena) |
| AUT-29-P5 | Plan 05 | [DRA-261](https://linear.app/drastic-dev/issue/DRA-261/aut-29-p5-fenced-step-executor-and-recovery) |
| AUT-29-P6 | Plan 05 | [DRA-262](https://linear.app/drastic-dev/issue/DRA-262/aut-29-p6-playbook-registry-and-supplier-invoices) |
| AUT-29-P7 | Plan 05 | [DRA-263](https://linear.app/drastic-dev/issue/DRA-263/aut-29-p7-att-gora-read-model-pause-and-hand-over) |
| AUT-31 | Plan 05 | [DRA-264](https://linear.app/drastic-dev/issue/DRA-264/aut-31-completeness-and-batched-questions) |
| AUT-31-P8 | Plan 05 | [DRA-265](https://linear.app/drastic-dev/issue/DRA-265/aut-31-p8-missing-fact-model) |
| AUT-31-P9 | Plan 05 | [DRA-266](https://linear.app/drastic-dev/issue/DRA-266/aut-31-p9-batched-question-with-typed-answers) |
| AUT-29-P10 | Plan 05 | [DRA-267](https://linear.app/drastic-dev/issue/DRA-267/aut-29-p10-deterministic-month-close-playbook) |
| AUT-34 | Plan 05 | [DRA-268](https://linear.app/drastic-dev/issue/DRA-268/aut-34-decision-model-steps-evaluated-against-deterministic-close) |
| AUT-35 | Plan 05 | [DRA-269](https://linear.app/drastic-dev/issue/DRA-269/aut-35-llm-steps-and-code-mode-investigation) |
| AUT-D11 | Plan 05 | [DRA-270](https://linear.app/drastic-dev/issue/DRA-270/aut-d11-design-the-run-view) |
| AUT-D12 | Plan 05 | [DRA-271](https://linear.app/drastic-dev/issue/DRA-271/aut-d12-design-the-batched-client-question) |
| AUT-36 | Plan 05 | [DRA-272](https://linear.app/drastic-dev/issue/DRA-272/aut-36-mcp-playbook-prompts-and-resources) |
| AUT-30 | Plan 06 | [DRA-273](https://linear.app/drastic-dev/issue/DRA-273/aut-30-fixture-backed-rule-sources) |
| AUT-30-P1 | Plan 06 | [DRA-274](https://linear.app/drastic-dev/issue/DRA-274/aut-30-p1-point-in-time-source-corpus) |
| AUT-30-P2 | Plan 06 | [DRA-275](https://linear.app/drastic-dev/issue/DRA-275/aut-30-p2-deterministic-rule-lookup-over-http-and-mcp) |
| AUT-30-P3 | Plan 06 | [DRA-276](https://linear.app/drastic-dev/issue/DRA-276/aut-30-p3-source-change-monitor-and-reviewed-dossiers) |

The owner sequence and gates are recorded in the handoff evening update. The deterministic baseline must precede engine implementation. New boards remain design-pending.

## Plan and issue publication checkpoint

Commit `eee5faa` preserves the 20 supplied plan documents in draft [PR #22](https://github.com/erik-kroon/drastic/pull/22). All 43 local file links resolve. Clean-worktree owners passed at 55/55. Changed and full checks are blocked by main's stale K-10/K-11 supplier evidence and missing handoff reference. No runtime, browser or production qualification is claimed.

Linear AUT-06 was rewritten for Phase 1; AUT-28 through AUT-36, phase children and AUT-D11/D12 are mapped above. AUT-00 retains provider, client-role, mandate and live-fetching decisions. AUT-31 is related to AUT-26.

## Bank citation freshness checkpoint

The retained failure in `test-results/pr20-bank-freshness-before` returned Forbidden for a same-subject stale citation. The fix returns StaleDependency after foreign identity checks and uses one subject builder across discovery, matching, preparation and approval. Candidate responses carry the stored option-set digest. The screen request driver refreshes once, retains a new request key before retry, and requires unchanged options. Saved replay keeps its original payload.

Two focused real HTTP workflows passed in `test-results/pr20-bank-freshness-resumed`; all three retry outcomes are retained. Changed-file checks passed before source integration. [Evidence](../../verification/bank-citation-freshness/README.md) records the before, intermediate invalid fixture and final run. Browser storage, screen rendering and visual parity remain unverified. Clean committed full/owners/design and MCP checks are pending. Exposure equivalence remains the next unit.

Clean committed HEAD `af7efe1` against main `4380287` passed full changed checks, owners (55/55), design contract, deterministic MCP (3/3) and pinned Luna MCP evaluation (1/1). Tracked status remained clean. MCP artifacts are `test-results/pr20-bank-mcp` and `test-results/mcpjam/844d91a8-a2a5-49c5-b46b-ad525b660fdd`. The design check measured zero matching screens and is not visual evidence. The source is ready for the next review unit, exposure equivalence.

## PR #20 exposure-equivalence checkpoint

Owner review item 7 compares earlier suggestion exposure using the stable subject identity and option-set digest for the same actor and book. Direct citation authorization still rejects foreign identity and stale revisions. A changed option set still yields unknown exposure. No historical decision is rewritten.

The reproducing HTTP E2E failed before the SQL change; three selected workflows passed afterward, including unequal options and existing authorization/freshness boundaries. Evidence is retained in `verification/exposure-equivalence/`. Changed-file checks passed. Clean-commit qualification is recorded separately; this does not establish model or representative accounting accuracy. The remaining state-limit failure specification now uses the owner's 24,576-token hosted Clef-flash window and the complete request.

## Owner research follow-up checkpoint

The supplied plan amendments distinguish month completion from run settlement, pin effect and version protocols, extend recovery and blind evaluation cases, and retain fixture-only legal-source work. Hosted Clef-flash is specified as 24,576 tokens; complete request fit is checked before dispatch and probability thresholds confer no authority. No implementation or legal/provider qualification is implied by these plan amendments.

The ADR 0020 counter table now matches existing SimpleWebAuthn behavior. Before editing that wording, the unchanged-runtime synthetic HTTP suite passed two selected tests: successive fresh zero-counter assertions with exact binding and single consumption, and the existing positive-counter clone refusal. Evidence is retained in `verification/presence-zero-counter/`. Hardware and browser authenticator behavior remain unverified.

The initial changed check passed formatting and lint, then stopped on main's stale K-10/K-11 supplier design evidence. No baseline or unrelated design evidence was regenerated. The shared main worktree's supplied edits were preserved; this unit uses an isolated branch.

Clean source `b2d6e5a` full check against main `4380287` passed the design contract and formatting, then timed out in type-aware lint after 60 seconds; process-group cleanup reported EPERM. This is incomplete validation, not a pass. The separate research test compiler was stopped after more than four minutes and remains unverified. Main's merged research follow-up is incorporated before the next unit.

Clean committed source `517640e` against main `b53db7f` passed full changed checks, owners (55/55) and the design contract with tracked status clean. Heavy checks were serialized after the earlier timeout. The changed test project passed in 15.66 seconds; this covers the merged zero-counter regression's static types as well. The design contract measured zero matching screens and provides no visual qualification. Exposure equivalence has three passing selected HTTP workflows; extraction read and suggestion identity are next.

## PR #20 extraction read checkpoint

Owner review item 8 now reads review basis without inbox or lifecycle row locks. A typed stale/missing basis returns retained extraction state and attempt diagnostics with no suggestion citation; database and decoding errors still propagate. Preparation and commit retain locked strict reads. Suggestion identity is the next separate unit.

Failure-first HTTP artifacts reproduced inbox lock timeout and stale-basis 409, then a separate lifecycle lock timeout before that reader was fixed. Four final selected workflows passed, including the ordinary extraction read/prepare/commit/cancel/replay path. Evidence is retained in `verification/extraction-read-state/`; changed checks passed. The unavailable-basis fixture is explicitly fault-injected mutable history, not a claimed public lifecycle. No schema, MCP description, screen composition, baseline or provider changed. Clean qualification follows the source commit.

Clean committed source `b28342f` against main `b53db7f` passed full changed checks, owners (55/55) and design contract; tracked status stayed clean. The design contract measures zero matching screens, not visual parity. No MCP catalog/schema changed in this unit, so no new MCP qualification is claimed. Suggestion identity follows.

## PR #20 suggestion identity checkpoint

Owner item 9 adds migration 0109 without editing 0106/0107. The append-only registry uniquely binds book, actor, nullable session, subject digest and option digest. Conflict-safe claims return one validated capture; legacy originals and citation IDs are preserved. Indexed adoption checks at most 64 old candidates and skips undecodable or inconsistent records, without a history backfill. An invalid canonical record fails closed.

Sequential and concurrent HTTP growth reproduced before implementation; the first legacy fixture error is excluded from defect evidence and its corrected reproduction is retained. Seven focused workflows passed, followed by one refined same-subject option/rollback workflow. It observes a fresh reservation inside the deliberately failed transaction and no retained increase afterward. Changed checks passed. Evidence is `verification/suggestion-identity/`. Browser and explicit cross-book/actor metamorphic caching behavior are unverified. Clean qualification follows the source commit.

Clean committed source `041fd9e` against main `ff21273` passed full changed checks, owners (55/55) and design contract with tracked status clean. PR #20 was merged by the owner at the preceding extraction-read checkpoint; suggestion identity is published as a new draft follow-up. The owner approval record is incorporated, with its remaining data and enablement gates preserved. No live qualification call is part of this unit.

## Approval consequences and synthetic SE mapping checkpoint

Owner items 10–11 capture new approval facts in the approval transaction: actual period bounds, the existing path's known-empty dimensions, retained AUT04 VAT reasoning, exact source/posting correspondence and versioned synthetic statement mapping identity/line. Export reads the immutable capture. Historical absence and older reviews without bindings remain unknown; no history or nonempty-dimension feature is backfilled.

Two real HTTP failures reproduced missing captures before implementation. Three HTTP workflows and one separately selected mapping workflow passed afterward; changed checks passed. Retained evidence is `verification/approval-consequences/`. Controlled account/period mutations and public dimension/VAT commands are distinguished. The older-prepared compatibility branch is inspected, not exercised. Mapping is synthetic-only with no statutory qualification. The additive review output schema requires MCP checks at the clean source checkpoint.

Clean committed source `2e8aa3d` against pinned main `ff21273` passed full changed checks, owners (55/55) and design contract, with tracked status clean. Three deterministic MCP workflows and the pinned Luna eval test passed. Evidence summaries and source inventories are retained in `verification/approval-consequences/mcp/` and `mcp-eval/`. Zero measured screens is not visual parity. The initial projection lint failure is retained as a failed check; the explicit-field fix passed without suppression. No live provider, statutory mapping or nonempty-dimension qualification is claimed.

## Partial supplier hints and report populations checkpoint

Owner item 12 now classifies an explicit cited account or exact VAT disagreement as corrected before the partial-coverage gate; equal partial hints and uncited exposure remain unknown. Inventory/export counts and offline independent/corrected populations are separate; corrected cases and the mixed baseline are explicitly nonrepresentative. Owner item 13's zero-denominator boundary remains unavailable (`value:null`), not zero accuracy. AUT12 model evaluation itself remains pending.

A refined real HTTP workflow reproduces both cited disagreements as unknown before implementation, then passes alongside partial-unchanged and foreign-citation/rollback regressions (3 selected workflows). The initial account fixture had no hint and is excluded as defect proof; its failed intermediate run is retained separately. Evidence: `verification/partial-supplier-hints/`. Changed checks passed. Older optional-metadata omission is source-inspected only. The additive export schema requires MCP qualification at the clean source checkpoint.

Clean source `c69e875` against pinned main `ff21273` passed full changed checks, owners (55/55) and design contract with tracked status clean. Three deterministic MCP workflows and the pinned Luna eval test passed. MCP result/source-hash summaries are retained; full generated inventories remain reproducible under the documented `test-results/` commands. The report CLI is linted/formatted and HTTP-exercised, without a dedicated tsconfig. No model evaluation accuracy, visual parity or production qualification is claimed.

## Decision model input limits checkpoint

Owner item14 pins technical model input windows and bounds the full UTF8 request before and after AUT28 sanitisation. Oversize refuses locally with zero transport calls; reported input usage at/above the pinned window refuses the response. Hosted Clef/flash use 64000/24576, manual selfhost/Jev require explicit safe integer configuration, fixture bound is authored. No quota/billing cap, truncation or fallback is added.

Two preimplementation workflows failed with complete observations retained; all four existing/new loopback and authored-binding workflows pass afterward. Evidence: `verification/decision-state-limits/`. Focused lint passed; changed hit an existing AUT28 node:crypto type error. Current main advanced to6e2a0ae with OAuth migrations0109–0111 and two upstream-skipped MCP protocol workflows. Parent stack integration, migration renumbering and clean qualification follow; none of those are yet claimed passing.

Owner main `6e2a0ae` integrated into the follow-up stack. Main migrations0109–0111 are preserved; the unpublished suggestion registry is renumbered0112. Earlier0109 artifacts remain historical evidence. Upstream temporarily skips two MCPJam protocol workflows; they are not silently re-enabled or claimed passing on the integrated tree. Clean qualification follows integration.

Integrated clean source `935aadd` against main `6e2a0ae` passed frozen install, full changed checks, owners55/55 and design contract (two measured screens; no visual comparison). 21 selected HTTP workflows passed,13 unselected. MCP admission1 passed,2 protocol cases skipped upstream; pinned Luna eval1 passed. The old AUT28 node:crypto typing failure resolved through main/dependency integration without owner edits. Combined evidence: `verification/automation-integration/2026-10-10/`; lower branch checks are not independently repeated. Shadow migration must follow registry0112 (currently0113). No production qualification.

## Firm memory v2 checkpoint

Owner item15 adds separately pinned exact token-set recall after removing numeric/date tokens and Swedish/English month names. V1 matching and retained captures remain supported. Both reports retain the same raw eligible target population; empty v2 keys are unmatched rather than excluded. Corrected labels remain nonrepresentative.

Failure-first public recall and corpus denominator reproductions are retained in `verification/firm-memory-v2/`. Six selected workflows passed, five unselected. The synthetic public corpus has two eligible targets for each version: v1 suggests zero and v2 one; consequential accuracy remains unavailable. The legacy replay uses an explicitly authored valid append-only fixture, not a historical runtime claim. Changed checks passed; clean full/owners/design and MCP qualification follow. No live model, statutory or browser qualification.

Clean committed source d246ebf against main6e2a0ae passed frozen install, full changed checks, owners55/55 and design contract (two measured matching screens; no visual comparison), with tracked status clean. MCP admission1 passed and two upstream protocol cases skipped; pinned Luna eval1 passed, evidence run e456009b-5c77-45f3-9477-01f25959f56a. These skips remain unverified. Retained evidence is synthetic only.

## Resumed AUT-11 checkpoint

Parked4958339 rebased onto the review stack; unpublished shadow migration is0113 after main0109–0111 and registry0112. Runtime policy is operator-written off/shadow and synthetic_fixture_only. Every model input uses permitted financial facts with a separate structured release; raw document/client/line text, private IDs and whole precedents stay internal. Public quota machinery is removed.

Failure-first commit b823d62 and retained before artifacts reproduce the current port/queue failure, false local dispatch marker, option-digest mismatch, lost reported usage and incorrect uncertainty states. Ten focused workflows passed, one unselected. Actual loopback queue delivery validates once; local size/expired guard dispatch zero times. Dispatch admission, guarded intent and actual transport are distinguished; timeout after intent is uncertain without redispatch. Exact ordinary reads/receipts/queues and paired financial projections retain noninterference evidence. `verification/decision-shadow-resumed/` documents the hashes, later test-only whitespace and synthetic fixture limitations. Changed checks passed; clean qualification follows.

No MCP catalog/schema/transport changed or exposes the new HTTP jobs/catalog, so MCP/Luna are not rerun for this unit. Parent v2 MCP admission1/Luna1 passed, with2 upstream protocol cases skipped; those are historical evidence and remain unverified for protocols. No live provider, model accuracy, statutory or browser qualification.

Clean604669a full against6e2a0ae failed four type-aware lint findings, while all TypeScript projects passed: the request JSON spread, two async Node handlers and a bare sort. Explicit request projection, owned handler promises and comparator resolve them without suppression. Five final affected HTTP workflows passed, with source inventory68336fae5f8481261d0bda06681c4995d2b30e0d89263a521697e323a9b3d30b. Earlier ten-flow qualification and handler-only five are retained separately; final clean checks follow the narrow fix.

Clean committed1e3a712 against main6e2a0ae passed full changed checks, owners55/55 and design contract (two measured matching screens; no visual comparison), tracked status clean before and after. Frozen install passed on the isolated check tree. No MCP catalog/schema/transport change; MCP/Luna not rerun for this unit. Parent protocol skips remain unverified. No live, statutory, model-accuracy or browser qualification.

## AUT-06 / plan05 phase01 checkpoint

[Draft PR32](https://github.com/erik-kroon/drastic/pull/32) implements one immutable exact-calendar-month capture and a read that separates retained outcomes from owner freshness. Corrected aggregate architecture selected after two independent sketches. The judge preferred federated attestations as submitted and approved the corrected aggregate as viable; `verification/close-predicate/` retains the disagreement, grafts and code review. The required vouchers_supported and facts_complete gates remain not_established. These fixtures never establish a completed month.

Failure-first commits1bf5a86/8f831ec and design/eval commit47ae4a0 precede owner code. Unchanged routes fail; actual incomplete bank reports retain missing-member diagnostics. Worker VAT failures expose digest format/QuestionEvent metadata assumptions. Clean sourcec43d8a3 reproduces three capture500s from a present undefined optional field;614879d omits that field without weakening validation. Test-onlyff39478 preserves complete bank receipts and observed sequence assertions. Final clean three-workflow run passed with stable source inventorye00efa81a3be174085464b641dd4929728dda09fc44b48d406d85bf756dda051. Whole-key concurrent replay, immutable grants, scope/month refusal, missing coverage, open work, retained/live freshness and actual zero tax control are observed. Zero difference leaves tax coverage not_established/reconciled false.

Frozen installation passed. MCP admission1 passed on unchanged runtime/catalog614879d, with2 upstream protocol cases skipped and unverified. Pinned Luna suite1 passed atff39478, three iterations each of ledger read, approval refusal and month-close read, with persisted-state checks. Run a5a89923-8975-4ca2-806b-130092008f62 is retained with the other synthetic artifacts. Final clean full/owners/design gates against main6e2a0ae are recorded with the proof commit in PR32. No static result is assumed from an untracked or changing tree. Design contract is not visual parity. No UI, live financial provider, real books or statutory/production close qualification.

Next ready unit is AUT-33/plan05 phase02 supporting documents, then AUT-32/phase03 synthetic-month baseline before engine code. Old immutable captures and original-key replay must not be backfilled when later gates gain owners.
### AUT-11 review follow-up, policy sequence restore

Failure-first commit `7991ca4` reproduced checkpoint `UnhandledFamily` in the real synthetic rehearsal. Fix `ea033f5` declares the `book_decision_policies.sequence` owner. The same rehearsal passed and retained counter 41; a new operator off policy received 42 and superseded shadow policy 23. The original restore quarantine remained intact. Proof is retained in `verification/decision-shadow/policy-sequence/`; the complete packet is under `test-results/aut11-policy-sequence-after/`.

The working-tree changed check passed for the narrow fix. Final clean static gates for the integrated review fixes remain pending. Admission permissions, VAT discrepancy capture and the remaining review findings are still open. No live provider or production restore was exercised.

### AUT-11 review follow-up, request authority

Failure-first `cd31e39` and `0e0e9b4` reproduced agent admission/read and a requester losing the operator role before dispatch. Fix `127cf2c` requires operator authority at all three existing boundaries. All seven decision-job workflows passed at clean source `6190d6c`, including real queue delivery and the locked downgrade refusal. Proof is retained under `verification/decision-shadow/request-authority/`. The fixture lock-probe failure, controlled PostgreSQL 55P03 reproduction and persistent-lock negative control are recorded separately there. No production provider behavior changed for the test-only probe fix.

The changed check against `ea033f5` passed API/test types. Final clean integrated gates remain pending. VAT discrepancy, mixed citations, terminal admission idempotency and timeout bounds are still under review. No MCP catalog, UI or live provider was exercised by this unit.
