# Verification plan

Status: acceptance scenarios designed; partial implementation, existing synthetic suites and bounded runtime evidence exist, but complete phase gates remain open. This file is a reviewable plan, not test code. [ADR 0010](adr/0010-application-owned-accounting-replacement.md) adds the clean-baseline, application-transaction, caller-cutover and effect-mq proof gates without changing the financial scenario IDs. [AGENTS.md](../AGENTS.md) requires explicit approval for test additions ([D-09](open-decisions.md)); inspect the relevant implementation task's actual authorization before changing tests. Examples alone do not establish acceptance.

The [seven-area acceptance plan](plans/09-acceptance.md) adds concrete fixture outcomes, packet traceability and required artifacts without adding test code or claiming an existing suite covers every scenario.

Prefer E2E through the public operation, real PostgreSQL and the actual runtime. Drive the human flow in a browser where identity, rendering and interaction matter. Define independently expected outcomes before implementation and before writing approved tests. Do not calculate expected journal results with the production calculator. No unit tests are to be added after code.

The [verification strategy](verification-strategy.md) defines runner ownership, fixtures, runtime isolation, CI gates and evidence artifacts. The scenarios below remain the acceptance criteria; detailed [failure cases](plans/09-acceptance.md#additional-failure-cases) refine them.

## Foundation and posting scenarios

| ID   | Given / action                                                                                                                  | Observable outcome                                                                                                                        | Guards                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| E-01 | Missing identity, another entity's book/account/evidence/approval, or an ordinary agent attempting human approval.              | Refused before any read leakage or financial effect; database boundary also rejects cross-scope references.                               | R-01, R-05; I-01, I-05 |
| E-02 | Zero/same-sided lines, an imbalance, fractional minor units, exponent strings or amounts beyond supported precision.            | Explicit rejection; no coercion, balancing plug or committed rows. A valid exact large amount survives roundtrip.                         | R-04; I-02             |
| E-03 | A complete synthetic evidence-backed plan is reviewed, approved and executed.                                                   | Exact expected lines, consumed approval, unique voucher/commit sequence, receipt and outbox are durable and agree with ledger reads.      | R-05, R-06; I-05, I-07 |
| E-04 | Same execution requested concurrently or retried after a lost response; same key reused with different input.                   | One effect and recoverable receipt for equal requests; explicit conflict for changed request.                                             | R-06; I-07, I-08       |
| E-05 | Same economic recognition submitted under a new job/key or revised source; separately, two equal legitimate source occurrences. | Rebooking refused; distinct legitimate events remain representable.                                                                       | R-02, R-03; I-04       |
| E-06 | Evidence/rule/profile/account/period changes after approval; separately, an unrelated voucher posts.                            | Relevant plan becomes stale; unrelated posting does not invalidate a local plan without a dependency on it.                               | R-05; I-06             |
| E-07 | New relevant unresolved source arrives after an aggregate readiness check; posting races with period close.                     | Collection change invalidates readiness; one consistent ordered close/post result, no late unauthorized write.                            | R-07; I-06, I-10       |
| E-08 | Failure before commit, during commit response, after commit before response, or during outbox publication.                      | Rollback leaves no partial group; uncertain outcome is recovered by identity; committed books survive delivery failure without reposting. | R-06; I-07, I-08       |
| E-09 | Attempt to update/delete posted content; then approve reversal plus replacement, including period/account edge cases.           | Direct mutation refused; all correcting effects or none, original retained, exact intended net result and linked history.                 | R-06; I-03             |
| E-10 | Read snapshots while two transactions commit in competing order; rollback after number allocation.                              | Cutoffs include a complete committed prefix; rolled-back numbers not consumed; no `MAX(sequence)` assumption.                             | R-08; I-07, I-10       |
| E-11 | Equivalent lifecycle calls through REST/MCP and real human controls; failed/stale/pending states.                               | Same business authorization, effects and receipts; UI never shows a financial commit before receipt.                                      | R-09, R-11; I-05, I-12 |

## Period, automation and release scenarios

| ID   | Given / action                                                                                                             | Observable outcome                                                                                                                       | Guards                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| E-12 | Repeat import of matched history; overlapping files, inline corrections, missing metadata and equal rows.                  | Existing matches/IDs/bytes survive, no collapsed legitimate rows, no fabricated history or duplicate ledger import.                      | R-02, R-03; I-04             |
| E-13 | Invoice with partial payments; owner reimbursement; foreign principal plus fee; some schedule installments already posted. | Recognition occurs under the selected method once; principal, fee, FX and residuals conserve exact amounts; posted installments persist. | R-03, R-04; I-09             |
| E-14 | Year transition, prior-close adjustment, cash-method year-end recognition and mechanical result transfer.                  | Opening basis used once, subsequent settlement not re-recognized, activity report remains correct and prior snapshots unchanged.         | R-03, R-08; I-10             |
| E-15 | Statement totals match but two offsetting items or a source account are absent.                                            | Coverage remains incomplete; missing items/account visible; period not labeled reconciled.                                               | R-07; I-11                   |
| E-16 | Previously filed return, new corrections, changed mapping, missing disclosure and stale report.                            | Box/fact lineage retained; old artifact immutable and labeled by snapshot; new readiness blocked or versioned honestly.                  | R-08; I-12                   |
| E-17 | Duplicate delivery, failed middle group, expired approval and changed supplier identity under a recurring rule.            | Applied groups remain applied; pending groups resume only with current authority; stale treatment cannot silently broaden.               | R-06, R-10; I-05–I-08        |
| E-18 | Unsupported SIE correction/encoding/dimension record; iXBRL that parses but has wrong semantic facts.                      | Explicit diagnostic or correct preservation; structural parse alone cannot pass the artifact gate.                                       | R-02, R-08; I-12             |
| E-19 | Provider accepts upload then times out, or still awaits required signature.                                                | Unknown/pending state; provider lookup precedes resubmission; no false accepted/fulfilled status.                                        | R-08; I-12                   |
| E-20 | Worker/Bun success, connection failure, cancellation and restart; the clean baseline is rerun, a recorded checksum drifts, or an old installation is presented. | Consistent operation semantics, scoped cleanup, honest commit uncertainty, effective grants, safe clean-baseline rerun and refusal of the old installation without modification. | R-12; I-07, I-08             |
| E-21 | Restore database and evidence archive; old writer wakes after cutover.                                                     | Original links, balances, approvals, rules and receipts reconstruct; obsolete writer is refused.                                         | R-01, R-12; I-01, I-10, I-12 |

## Book Zero acceptance

The [Book Zero plan](plans/15-book-zero-workflow-cash.md) adds the source PRD's AT-01–AT-45 as unexecuted acceptance obligations. These identifiers refer to the [preserved Book Zero source, section 14](specs/book-zero-v1/PRD_openERP_Book_Zero_Workflow_Drastic_Cash_v1.md); they are not the broader platform's ES-AT cases. The source retains each setup, independent expectation and requirement reference. Its inline requirement acceptance and priority journeys also apply; importing the list does not execute it or change E-01–E-21 status.

| Book Zero cases | Real boundary and decisive result | Existing owner/scenarios |
| --- | --- | --- |
| AT-01–AT-06 | Reimport, overlap, missing period, raw reconstruction and migrated opening: preserve source occurrences and links, expose coverage gaps, recognize history once, use independent expectations. | IMP/COM; E-05/E-12/E-14/E-15 |
| AT-07–AT-09 | Owner expense and reimbursement, owner transfer, partial invoice payment: one cost/transfer, correct remaining capacity; 10,000 less 4,000 leaves 6,000 SEK. | COM; E-13 |
| AT-10–AT-15 | Agent self-approval, stale input, concurrent execute, lost response, partial batch and revocation: refusal or one durable effect, ordinary UI recovery, honest per-group results. | FND/PST/FE; E-01/E-04/E-06/E-08/E-11/E-17 |
| AT-16, AT-17 | Two issues on one case stay one principal task; failed work-list read is an error, not zero remaining work. | Workspace/FE-02 |
| AT-18–AT-20 | Reviewer imports the complete SIE and follows original evidence; isolated restore stays quarantined; an applicable unsupported family blocks its company outcome. | END/OPS/profile owners; E-18/E-20/E-21; D-04/D-08 |
| AT-21–AT-24 | Opening inclusion and owned payment identity: 50,000 invoiced less 20,000 already in bank leaves 30,000 future inflow; verified internal transfer nets to zero; unrelated equal/opposite payments remain separate. | Cash with IMP/COM |
| AT-25–AT-28 | Tax-account funding, multiple representations, amendments and salary: 30,000 tax-account funds against 50,000 debits needs 20,000 bank funding; net pay 40,000 plus tax positions 25,000 does not add gross pay again. | Cash with VAT/PAY |
| AT-29–AT-33 | Noncash depreciation, owner reimbursement, recurring estimate replacement, undated overdue AR and unsupported FX: no invented payment, duplicate occurrence, lost amount or default conversion. | Cash with COM/AST/FX |
| AT-34–AT-37 | Mismatched opening dates, same-day included payment, reservation semantics and later knowledge: qualify bridge/inclusion or mark incomplete; preserve the original snapshot. | Cash with bank/source owners |
| AT-38–AT-42 | Delayed-customer scenario, negative minimum despite positive close, zero denominator, finite horizon and missing future salary/tax: honest exact results, unchanged books and visible gaps. | Cash application/domain and UI |
| AT-43–AT-45 | Older job finishing last, cross-company snapshot export and repeated identical inputs: no stale overwrite or data leak; reproducible exact contributions and totals. | Cash/PST/FND |

### Independent Cash example

The source's 30-day example is synthetic, not Drastic's balance or a qualified tax rule. Assume common opening bank 100,000 SEK, separate tax account 30,000 SEK, 50,000 SEK tax debits, buffer 10,000 SEK and no other payments. Day 11 funding is a supplied date in this example, not a universal bank-day rule. Cash receives only the extra 20,000 SEK bank outflow; the day 12 tax debit does not deduct bank cash again.

| Day | Bank contribution, SEK | Base end-of-day bank, SEK | Customer A delayed to day 22, SEK |
| --- | ---: | ---: | ---: |
| 0 | Opening 100,000 | 100,000 | 100,000 |
| 5 | Supplier −40,000 | 60,000 | 60,000 |
| 8 | Customer A +30,000 in base only | 90,000 | 60,000 |
| 10 | Net payroll −40,000 | 50,000 | 20,000 |
| 11 | Additional tax-account funding −20,000 | 30,000 | 0 |
| 12 | Tax-account debit; no bank contribution | 30,000 | 0 |
| 20 | Customer B +60,000 | 90,000 | 60,000 |
| 22 | Customer A +30,000 in delayed case only | 90,000 | 90,000 |
| 30 | No further payment | 90,000 | 90,000 |

Both scenarios close at 90,000 SEK. The base minimum is 30,000 and headroom is 20,000; the delayed minimum is zero and headroom is **−10,000**. These expected values are fixed before implementation; they must not be recomputed by the production calculator as their own oracle. The documentation's arithmetic check does not prove the application.

G1/G4 require a named independent reviewer and actual sources; G2/G3 require the applicable public runtime and browser journeys; G5 requires a real new period; G6 requires restore and the authorized single writer. Reuse existing E2E infrastructure within the implementing task's authority, define failure cases before implementation and leave a verifiable, repeatable artifact. Include exact revision/dirty state, migration and rule versions, environment, permitted input/source hashes, replay steps, independent expected/observed results, receipts, reviewer and limitations. Do not add unit tests after code or mark company/provider gates passed from synthetic checks.

## Evidence artifact for every E2E run

Record scenario IDs, independently specified expected outcomes, code/schema/rule versions, runtime/database versions, fixture source and synthetic/real-copy status. Include exact launch/drive/cleanup commands, assertions observed at the public boundary, persisted receipts and relevant database observations. Capture only non-sensitive screenshots or logs. Report failures and checks not run beside the result.

The artifact must let another developer repeat the scenario from a known starting state. For UI work, capture the action and durable result as well as meaningful screen states. Record actual keyboard, narrow-width, 200% browser zoom, contrast and reduced-motion checks separately; viewport emulation does not establish browser zoom or screen-reader coverage.

Use the lowest-cost real surface that proves the claim. A mocked store cannot prove database atomicity; Bun alone cannot prove workerd; a passing schema cannot prove legal treatment; a screenshot cannot prove a committed voucher. Existing repository checks remain necessary but cannot replace these gates.
