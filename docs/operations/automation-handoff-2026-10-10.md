# Automation handoff — layered accounting automation

Snapshot: 10 October 2026, `main` at `fd5b4b2`. Decision record:
[ADR 0021](https://github.com/erik-kroon/drastic/blob/automation/pr19-review-fixes/docs/adr/0021-layered-accounting-automation.md) (accepted direction; legal
footing and bars open). Builds on
[ADR 0017](../adr/0017-bureau-first-product-focus.md) and
[ADR 0020](../adr/0020-authorization-basis-presence-and-mandates.md).

This handoff is written to be turned into issues. Each `AUT-nn` block is one issue: its
heading is the title and its body can be pasted as is. Create one parent issue,
**Layered accounting automation (ADR 0021)**, and link every `AUT-nn` to it. Record the
`Depends on` lines as blocking relations.

Readiness labels:

- **Ready:** can start now on synthetic data.
- **Decision:** needs an owner or legal decision first.
- **Design-pending:** UI needs Paper adoption under the page 00 contract.
- **Gated:** needs a data-use or provider authorization.

The earlier issue blocks are historical scope where the evening owner update supersedes them. No live model is approved. Nothing below claims accuracy,
time saving or legal clearance.


## Evening owner update, 2026-10-10

Plans [05](../plans/05-accounting-agent/overview.md) and [06](../plans/06-rule-sources/overview.md) are approved. Their phase specifications define the new engine and source work. The owner order is PR #20 review fixes, AUT-11 shadow jobs, AUT-06 close predicate, voucher support, synthetic baseline, then run engine and deterministic month close. Models must improve the deterministic result. Rule-source work uses fixtures while the engine waits on review.

No model reads document text or client free text. Build the engine, inner loop and interpreter from the specifications without copying source. Effect AI stays behind a Drastic port. No billing, metering or managed-plan caps belong in this repository. People start and stop runs; agent tools read plan previews only. Modes remain per question and book in the operator console.

ADR 0019 blocks client delivery. ADR 0020 remains proposed. Bedrock EU hosting and live source fetching remain AUT-00 decisions. AUT-D11 and AUT-D12 are not adopted.

## Rules for every issue

- Use isolated synthetic accounts and data. Real company material, live providers and
  egress to a model provider need task-specific authorization.
- Write the issue's failure cases before the code. Prove behaviour with real-application
  E2E through the public boundary and retain a repeatable artifact. Do not add unit tests
  after implementation.
- No model or provider call inside an approval or posting transaction. Execution reads
  stored results.
- Model output is an unreviewed claim. It never posts, approves, pays, signs or files,
  and never produces an amount.
- Keep authority checks, exact approval binding, atomic receipts and immutable history.
  Authentication-basis gates go through `application/authority.ts`.
- Run these as they apply:
  - `bun run check:changed` after each coherent edit;
  - `bun run check:changed:full` before handoff;
  - `bun run check:owners` when adding a domain leaf;
  - `bun install --frozen-lockfile` after dependency changes;
  - `bun run test:mcp` and `bun run test:mcp:eval` for any MCP catalog change.
- UI issues use the [UI issue template](../design/ui-issue-template.md) and stay
  design-pending until a board is adopted.
- Separate three claims: the implementation works on synthetic data, a model performs
  on a qualified corpus, and real books benefit.

## Lanes and order

| Lane | Issues | Start |
| --- | --- | --- |
| A. Clean labels and memory | AUT-01, 02, 03, 04, 05 | **Now.** AUT-01 first: provenance cannot be recovered later. |
| B. Verification | AUT-06, 07 | Now, in parallel with A |
| C. Ratified rules | AUT-08 | After AUT-02, 03 and 05 |
| D. Decision-model layer | AUT-09 to 13 | AUT-09 to 12 now on a fixture provider. AUT-13 is gated. |
| E. Suggest in product | AUT-14, 15 | Design-pending; after D shows shadow results |
| F. Firm learning | AUT-16 to 21 | AUT-16 after AUT-00. The rest in order. |
| G. Autonomy | AUT-22 to 25 | After B, D and F evidence |
| H. Orchestration agents | AUT-26 | After AUT-01; needs an MCP evaluation |
| I. Design (page 00 boards) | AUT-D01 to D10 | D01, D02, D04, D05 can be drawn now. Each blocks its UI issue. |
| J. Canon alignment | AUT-27 | Ready: mandates need two approvers per M-01 |
| Decisions | AUT-00 | Owner and counsel; in parallel |

```text
AUT-00 ─────────────────────────────┬──► AUT-16 ─► AUT-17 ─► AUT-18 ─► AUT-19 ─► AUT-20 ─► AUT-21
AUT-01 ─► AUT-02 ─┬─► AUT-05 ─┬─► AUT-08                                     ▲
AUT-03 ───────────┤           └─► AUT-11 (precedent in state) ──────────────┘
AUT-04 ───────────┘
AUT-09 ─► AUT-10 ─► AUT-11 ─► AUT-12 ─► AUT-13 (gated) ─► AUT-14/15 (design)
AUT-06, AUT-07 ─────────────────────────────────────────► AUT-22 ◄─ AUT-23 ◄─ AUT-12, AUT-02
AUT-24 ◄─ AUT-12        AUT-25 ◄─ AUT-01        AUT-26 ◄─ AUT-01
```

---

## AUT-00 Decide the automation basis and firm-learning legal footing

Open evening decisions include Claude on Bedrock through an EU geographic inference profile, proposed ADR 0019 client roles, proposed ADR 0020 mandates, and live public-source fetching. Plan approval resolves none of these. AUT-D11 and AUT-D12 await adoption.

**Readiness:** Decision · **Owner:** founder, with counsel · **Size:** not engineering

Accept or amend ADR 0021, and get the legal answers the firm-learning lanes need.

- [x] Layered approach accepted by the owner, 2026-10-10 (ADR 0021 accepted direction).
- [ ] Counsel confirms or corrects the GDPR roles (client controller, bureau processor,
      Drastic sub-processor). Counsel also confirms the basis for same-book precedent
      and for same-firm learning across clients.
- [ ] Firm-model data addendum v1 drafted: contribute and use authorizations,
      exclusions, retention, retirement window and revocation.
- [ ] Data-use decision per provider: Workers AI (Clef, Clef-flash, Clef-omni),
      TypeSafe (Jev), self-hosted Clef. State which of these may receive what, and from
      which books. Audio and video stay out of every state, as free-text client
      messages do.
- [ ] Bars set for suggest mode and for mandate conditions, for example a minimum
      number of independent labels and a maximum consequential error at a stated
      confidence.
- [ ] Who may switch suggest mode or mandates on in the product (K-95 shows
      firm-wide toggles). The proposal is two approvers plus presence for loosening.
      Tightening can be one person. Only the operator console can switch presence off.

Blocks AUT-13, AUT-16 and every real-data run.

## AUT-01 Record decision provenance for every human treatment decision

**Readiness:** Ready · **Size:** M · **Depends on:** none

Record, in the same transaction as each decision, what the person was shown. Suggestions
already exist, so today's labels are not all independent:

- supplier account history (`supplierAccountSuggestions`);
- extraction field proposals;
- bank candidate ranking.

**Entry points**

- `apps/api/src/application/purchases/drafts.ts` (`supplierAccountSuggestions`)
- `apps/api/src/application/purchases/acceptance.ts` (approve)
- `apps/api/src/application/purchases/extraction.ts`
- `apps/api/src/application/banking/candidates.ts` and `banking/matches.ts`
- `apps/api/src/application/period-work.ts` (batch approval)
- `apps/web/src/components/commerce/supplier-acceptance.tsx`

**Shape**

- Every suggestion the server serves becomes an immutable `suggestion_record` with: id,
  book, subject, actor, session, option-set digest, ranked options, source
  (`firm_memory_v0`, `extraction`, `bank_ranking_v2`, …) and timestamp.
- Decision commands may cite `presentedSuggestionIds`. The server derives the class
  (`independent`, `accepted_unchanged`, `corrected`, `batch_approved`,
  `unknown_exposure`, `historical_import`) by comparing the chosen treatment with what
  was served.
- The result is written to an append-only `decision_provenance` row in the decision's
  transaction.

**Failure cases**

- A client claims no suggestion, but the server served one for this subject to this
  actor. The class is `unknown_exposure`, never `independent`.
- A citation names a suggestion served to another actor or book, or for another subject.
  It is refused.
- A replay of the decision creates no second row.
- Batch approval marks every item `batch_approved`.
- The decision rolls back. The provenance row rolls back with it.
- A historical SIE import is marked `historical_import`.

**Acceptance**

- [ ] Every decision in supplier acceptance, bank matching and batch approval writes
      exactly one provenance row.
- [ ] E2E covers every failure case.
- [ ] The artifact lists counts per class for a synthetic journey.
- [ ] The web client cites the suggestions it rendered. This changes the request only,
      not the visuals.

## AUT-02 Derive the decision-example ledger from immutable history

**Readiness:** Ready · **Size:** M · **Depends on:** AUT-01

Build a read model that turns each past human decision into an example rebuilt as it was
when the decision was made. It is the input to evaluation and later training. It
involves no model.

**Shape**

- An example contains: subject, commit-sequence cutoff, state-builder version,
  option-builder version, chosen treatment, provenance, and its relabel and exclusion
  lineage.
- Corrections (`posting-corrections.ts`) relabel an example to the replacement
  treatment. A reversal with no replacement excludes it.
- An operator script exports JSONL with per-example digests and a manifest of
  exclusions with counts.

**Failure cases**

- A fact recorded after the cutoff appears in the state. The canary must be absent.
- A reversed decision with no replacement is exported. It must be excluded and counted.
- Payroll or employee-claim data is present. It must be excluded.
- A personal identity number appears in document text. It must be redacted, checked
  with synthetic canaries.
- An `accepted_unchanged` example lands in an evaluation split. It must be refused.

**Acceptance**

- [ ] The export can be rebuilt from the same revision with identical digests.
- [ ] Every failure case is demonstrated with canaries.
- [ ] The manifest reports denominators.

## AUT-03 Define accounting-consequence equivalence

**Readiness:** Ready · **Size:** M · **Depends on:** none

Add a pure domain leaf, `packages/domain/src/treatment-consequence`, declared in
`docs/plans/domain-leaf-integration.json`. It computes a treatment's consequence class
from:

- the report line under the book's statement mapping (`report-statements.ts`);
- VAT category and deductible share;
- accounting period;
- balance-sheet or income-statement placement;
- required dimensions.

Its consumers are evaluation (AUT-02, AUT-12), firm memory (AUT-05) and mandate terms
(AUT-22).

**Failure cases**

- Two accounts on the same K2 line, with the same VAT and period, must be equivalent.
- Different deductibility must not be equivalent. Representation is never equivalent to
  fully deductible.
- An asset account and an expense account must not be equivalent.
- An unmapped account must be unknown, never equivalent.
- A changed statement mapping version yields a different class identity.

**Acceptance**

- [ ] Independently written expected vectors, done before inspecting results (ADR 0015).
- [ ] A real application consumer is wired, and `bun run check:owners` passes.

## AUT-04 Treat VAT as categories resolved by the rule profile

**Readiness:** Ready (investigation first) · **Size:** M–L · **Depends on:** none

Today `ReviewedTreatment` (`packages/contracts/src/supplier-recognition.ts`) and supplier
suggestions store a rate and a deduction. Introduce VAT treatment categories that the
Swedish rule profile (`jurisdictions/se/src/vat`) resolves into a rate and a deduction at
the tax point. Suggestions and examples carry categories. Approved treatments keep the
exact resolved rate and deduction, so posted history is unchanged.

**Failure cases**

- A category resolved across a rate-change date yields the rate in force at the tax
  point.
- An unknown category, or no rule in force, blocks; it is never defaulted.
- Already-posted treatments are unchanged.
- A category and an explicit rate that disagree are refused.

**Acceptance**

- [ ] Written investigation of the current treatment owners.
- [ ] Proposal reconciled with the
      [VAT profile boundary](../adr/0002-swedish-vat-profile-boundary.md).
- [ ] Then implementation with E2E.

## AUT-05 Firm memory v1: deterministic, versioned precedent

**Readiness:** Ready · **Size:** M · **Depends on:** AUT-01, AUT-02, AUT-03

Replace the last-five-accounts query with a versioned precedent owner. For a subject it
returns ranked precedents from the **same book**, matched on:

- counterparty;
- normalized line description;
- amount band;
- document kind.

Each precedent carries its consequence class, the source decision ids, provenance and
the algorithm version. Results are served as suggestion records (AUT-01). Firm memory is
both a product feature and the baseline every model must beat.

**Failure cases**

- A decision that was later corrected must surface the correction, not the original.
- No precedent returns an empty result, never a guess.
- Precedent from another book is never returned.
- Ranking is deterministic for the same history revision.

**Acceptance**

- [ ] E2E covers the failure cases.
- [ ] An offline report over AUT-02 examples records consequence accuracy and coverage
      for firm memory alone. This is the baseline artifact.

## AUT-06 Close predicate and verification coverage

## Phase specification

[phase-01-close-predicate.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-01-close-predicate.md)

One read operation answers "is this book and period done?" as typed check results. Every later phase uses it as its exit predicate. This is the riskiest unknown. If "done" cannot be expressed in code, no run can be verified.

This phase is the AUT-06 implementation. Its independent expectations already exist in `docs/operations/automation-coverage-vectors.md` and are not rewritten here.

## Dependencies

None.

## Failure cases to write first

The AUT-06 vectors, plus these:

- [ ] A check outside the gated set changes the verdict.
- [ ] An old passing record counts after its dependencies changed.
- [ ] A read through MCP writes anything. Row counts must be unchanged.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

The original coverage scope remains below.


**Readiness:** Ready · **Size:** M · **Depends on:** none

Add an immutable verification-coverage record per book and period. It states which
independent checks hold, building on the existing reconciliation, close and coverage
owners (`banking/reconciliations.ts`, `banking/coverage.ts`, `closing/`):

- bank reconciled through the period with item coverage;
- tax account reconciled;
- supplier and customer ledgers against statements where present.

Coverage that is missing or stale is reported as such, never as a pass (I-11).

**Failure cases**

- A zero difference with missing items is incomplete, not passed.
- A later source revision makes the record stale.
- A check that did not run is not a pass.

**Acceptance**

- [ ] E2E covers the failure cases.
- [ ] The record is readable by the mandate owner (AUT-22).

## AUT-07 Deterministic anomaly flags on prepared supplier work

**Readiness:** Ready (backend); UI design-pending · **Size:** M · **Depends on:** none

Compute warnings on supplier reviews before approval:

- bank details changed since the counterparty revision last paid;
- amount outlier versus precedent (after AUT-05);
- VAT-to-gross ratio implausible for the category;
- duplicate supplier document number;
- new supplier with an urgent due date;
- directory-listing solicitation patterns.

Flags add friction only and never block on their own.

**Failure cases**

- Every flag has a positive and a negative synthetic vector.
- Flags are recomputed when the review is sealed again.
- Flags never alter amounts or treatment.

**Acceptance**

- [ ] Flags appear in the review read model with their evidence.
- [ ] A UI issue is opened from the template.

## AUT-08 Learned, then ratified: propose explicit rules from stable precedent

**Readiness:** Ready after dependencies · **Size:** M · **Depends on:** AUT-02, AUT-03, AUT-05

When precedent for a pattern meets support and consistency thresholds within one
consequence class, propose a recurring rule through the existing rule owner
(`recurring-rules.ts`, `evidence-work.ts` `activateRecurringRule`). The proposal cites
its supporting decisions and its counterexamples. A person activates it. An active rule
proposes deterministically. Nothing activates automatically (R-10).

**Failure cases**

- A counterexample after the proposal invalidates it.
- Activation by an agent credential is refused.
- A rule revision does not rewrite already-admitted work.

**Acceptance**

- [ ] E2E covers proposal, activation, use and invalidation.
- [ ] The rule records its proposal evidence.

## AUT-09 Decision question catalog and contracts

**Readiness:** Ready · **Size:** M · **Depends on:** none

Add a domain leaf, `packages/domain/src/decisions`, and the contracts in
`packages/contracts/src/decisions.ts`:

- question releases: id, version, kind (choice, score or yes/no), criteria, and
  option-builder and state-builder ids, all digested;
- confidence statistics: TypeSafe's formula, top probability and margin;
- strict SystemOne request and response schemas;
- the decision-result view.

There are no provider calls in this issue. Declare the domain leaf's consumer.

**Acceptance**

- [ ] Option sets over 255 entries are an explicit skip.
- [ ] Unknown response options are refused by schema.
- [ ] `check:owners` passes.

## AUT-10 SystemOne adapter and fixture provider

**Readiness:** Ready · **Size:** M · **Depends on:** AUT-09

Add `apps/api/src/adapters/decision-models/systemone.ts` and
`apps/api/src/runtime/decision-model.ts`, mirroring `configuredDocumentReader`:

- `OPENERP_DECISION_MODEL=disabled|local-systemone-fixture|workers-ai-clef|typesafe-jev|self-hosted-clef`;
- a required pinned `OPENERP_DECISION_MODEL_RELEASE`;
- live use only over HTTPS with a credential, and credentials alone never enable it;
- bounded JSON, unique keys, and a refusal on any unexpected model version;
- each pinned release records its input-token limit, media limits and price. A
  provider-side change to any of them counts as a version change. On 9 October 2026
  Workers AI cut hosted Clef-flash from 64k to 24k input tokens without new weights.

Add a loopback fixture provider under `apps/api/tests/support/` that returns authored
distributions. Add the dependency only if needed, and verify the lockfile.

**Failure cases**

- Timeout.
- 429.
- Oversized body.
- Duplicate keys.
- Version mismatch.
- An option outside the declared set.
- Credentials present while the mode is `disabled`.
- A state larger than the release's input limit. It is refused locally and never sent:
  Workers AI truncates `state` silently to fit, which would drop precedent unseen.

**Acceptance**

- [ ] E2E against the fixture covers every failure case.

## AUT-11 Decision persistence, jobs, per-book policy, and precedent in state

**Readiness:** Ready · **Size:** L · **Depends on:** AUT-10, AUT-05

**Shape**

- Migration with `decision_requests`, `decision_attempts`, `decision_results` and
  `book_decision_policies`. The runtime has read-only access to policies; the operator
  console writes them, as in ADR 0020.
- An effect-mq `decision-queue` run by the preparation runner. Requests are admitted in a
  short transaction, the provider is called outside any transaction, and the result is
  finalized under a fenced lease.
- State builders take a frozen cutoff and include firm-memory precedents (AUT-05). Option
  builders read the book's records.

**Failure cases**

- A retry makes no second provider call. A changed payload under the same key is
  refused.
- A stale lease cannot finalize.
- Authority revoked, or the subject revised, in flight makes the result stale.
- Policy `off` enqueues nothing.
- Shadow mode leaves every product read and queue identical, shown by comparing
  persisted state with shadow on and off.
- Oversized model state is refused locally. Provider usage is diagnostic evidence only; managed billing and plan caps stay outside this repository.
- Document text and client free text never enter decision-model state. An attempted disclosure is refused before dispatch.

**Acceptance**

- [ ] E2E covers every failure case against the fixture.
- [ ] A non-interference artifact is retained.

## AUT-12 Shadow questions v1 and evaluation harness

**Readiness:** Ready (synthetic) · **Size:** L · **Depends on:** AUT-11, AUT-02, AUT-03

**Questions**

- Document kind (port TRI-SH-1.0 from the private triage package).
- Expense account.
- VAT category.
- Bank-match tie-break, with `none` and `split` options.
- Field-candidate selection over exact spans.

**Harness**

- Blind labels with an exposure flag.
- Per-question reports with full denominators, consequence accuracy, exact-account
  accuracy, Brier score and reliability, and grouped uncertainty.
- Comparison against firm memory.
- Artifacts written to `verification/decision-models/`.

**Acceptance**

- [ ] The harness runs on synthetic examples with fixture distributions.
- [ ] Zero denominators are reported as not applicable.
- [ ] Retries are never counted as new examples.

## AUT-13 Qualify Clef-flash and Jev in shadow

**Readiness:** Gated (AUT-00 data-use and AUT-28 egress) · **Size:** M · **Depends on:** AUT-12, AUT-28

Run both providers through the same adapter on a synthetic corpus first. Clef-omni
(9 October 2026) is an optional third candidate for the document-kind question with
page images only. Cloudflare's own invoice-processing figure puts it below Clef (60.2
against 64.7), and its audio and video input has no use here. If authorized,
run them on Drastic AB's own material. Report results per question against firm memory.
Record the provider data terms and the pinned releases.

**Acceptance**

- [ ] Evidence packet with revision, corpus manifest, releases, usage and limitations.
- [ ] No suggestion is shown to users.

## AUT-14 Suggestions with provenance in supplier and bank review

**Readiness:** Design-pending · **Size:** L · **Depends on:** AUT-12, AUT-01

Show suggestions in review: firm memory first, model suggestions only where suggest
mode is on. Each shows its source, version and consequence class. Accepting a suggestion
still goes through the ordinary approval, and every decision cites what it was shown.
Add the per-book exploration share, where no suggestion is shown.

Follow the UI issue template. Browser E2E runs with Luna.

## AUT-15 Order Att göra by materiality and unusualness

**Readiness:** Design-pending · **Size:** M · **Depends on:** AUT-05, AUT-07

Add a deterministic ordering score, optionally with a model score in suggest mode. It
must be explainable. Ordering never hides items. A batch-eligibility policy stays
human-written (ADR 0017).

## AUT-16 Firm-learning consent model

**Readiness:** Decision (AUT-00) · **Size:** L · **Depends on:** AUT-00

**Shape**

- Firm enrolment by a firm admin with presence proof (a new ADR 0020 gesture), accepting
  an addendum version.
- Per-book *contribute* and *use* authorizations citing retained evidence of the client
  company's instruction.
- Client-audience visibility and revocation.
- Append-only records.

**Failure cases**

- Enrolment by an accountant (not an admin), or with an API credential, is refused.
- A book without authorization never contributes.
- Revocation takes effect on the next manifest build and on retrieval immediately.
- An addendum version change requires accepting the addendum again.

## AUT-17 Cross-book precedent within a firm

**Readiness:** Decision · **Size:** M · **Depends on:** AUT-16, AUT-05

Extend firm memory and state precedent to *contributing* books of the same firm, served
only to books with *use*. Firm memory reports which books contributed.

**Failure case**

- A non-contributing or revoked book's decisions appear anywhere. They must not.

## AUT-18 Training manifest and encrypted export

**Readiness:** Decision · **Size:** M · **Depends on:** AUT-16, AUT-02

The manifest is immutable. It records:

- example digests;
- each book's authorization revision;
- exclusions with counts;
- a time-based split grouped by counterparty;
- builder versions.

It is exported as a bundle encrypted under per-firm and per-book keys. The bundle is
readable only by the training service. Revocation destroys the keys (crypto-shredding).

**Failure cases**

- An unauthorized or revoked book is in the manifest. It is refused at build time and
  again at bundle validation.
- Keys for revoked data still decrypt after shredding. They must not.

## AUT-19 Firm adapter training service

**Readiness:** Decision (stack and hosting) · **Size:** L · **Depends on:** AUT-18

A separate Python deployable that:

- trains a LoRA adapter on pinned Clef-flash weights with a calibration (Brier) term
  (Cloudflare trains Clef-omni the same way, on a frozen backbone; Clef-omni itself
  needs about 64 GB of GPU memory and is not the adapter base);
- uses deterministic seeds and records its environment;
- reads only the bundle;
- emits the adapter, its digest and an evaluation report.

EU hosting must be chosen. Dogfood on Drastic AB's own books first, with the owner's
consent.

## AUT-20 Firm-model release registry, promotion and retirement

**Readiness:** Decision · **Size:** M · **Depends on:** AUT-19, AUT-12

**Promotion** requires all of the following on held-out `independent` and `corrected`
labels:

- beats firm memory and the base model on consequence accuracy;
- meets the calibration bar;
- no regression on new counterparties;
- passes membership canaries.

Promotion and rollback are presence-gated firm-admin gestures.

**Retirement:** releases trained on revoked data are retired within the addendum's
window.

## AUT-21 Serve firm adapters

**Readiness:** Decision · **Size:** M · **Depends on:** AUT-20

Add a SystemOne-compatible endpoint that selects the firm adapter on the pinned base.
Decision requests pin the release. A cross-firm adapter request is refused.

## AUT-22 Mandate terms over consequence classes and decision conditions

**Readiness:** Ready after dependencies · **Size:** L · **Depends on:** AUT-03, AUT-06, AUT-12, AUT-23

Extend the ADR 0020 mandates with:

- consequence-class terms, so any account within the class is allowed;
- decision conditions: question release, model release, and a threshold or a
  single-option prediction set, plus a calibration record id;
- a required verification coverage for the book.

Execution reads **stored** results for the same subject revision and state digest.

**Failure cases**

- A stored result is stale or from another release.
- The calibration record is missing or does not meet the bar.
- Verification coverage is stale.
- A treatment falls outside the class.
- The model release changes after the grant.
- The review has an open AUT-07 flag. Proposed in A-04b: it must not execute under
  the mandate. Decide before building.

**Acceptance**

- [ ] E2E covers every failure case.

## AUT-23 Conformal calibration records

**Readiness:** Ready after dependencies · **Size:** M · **Depends on:** AUT-12, AUT-02

Compute an immutable record per question, model release and book (or firm) from
independent labels: thresholds for single-option prediction sets at a stated error level,
with n, the error bound and the label-set digest. Records are re-derived on new labels;
an existing record is never edited.

## AUT-24 Agent watchdog questions and mandate suspension

**Readiness:** Ready after dependencies · **Size:** M · **Depends on:** AUT-12, AUT-28

Add decision questions over agent action traces:

- Does this action match the mandate?
- Does the source text contain instructions to the agent?

A trip writes a suspension record that stops mandate execution. A person revokes or
resumes.

**Failure case**

- An injected "pay this account" instruction in a synthetic document trips the
  suspension.

## AUT-25 Measure firm learning per book

**Readiness:** Ready after AUT-01 · **Size:** M · **Depends on:** AUT-01

Report per book and per period:

- unchanged-approval share;
- human touches per transaction;
- consequential error, from corrections;
- time to close where it is observable.

Report each before and after every promotion, with denominators. Link to the bureau
value measurements (DRA-183). Report observations, not targets.

## AUT-26 Completeness-chasing agent

**Readiness:** Ready after dependencies · **Size:** M · **Depends on:** AUT-01, AUT-28

Expose templated work-question creation (`work-questions.ts`) to agents, covering
missing receipts and private-or-business clarifications. Agents create questions and
claims; they never post. The MCP catalog changes, so `test:mcp` and `test:mcp:eval` are
required.

## AUT-28 AI egress boundary

Linear [DRA-256](https://linear.app/drastic-dev/issue/DRA-256/aut-28-enforce-the-ai-egress-boundary). PR #21 is merged into PR #20; live authorization remains open.

**Readiness:** Implementation and synthetic verification tracked in [the AUT-28 record](https://github.com/erik-kroon/drastic/blob/automation/pr19-review-fixes/docs/operations/ai-egress-implementation.md). Live-provider qualification remains gated by AUT-00.

Every product model call uses one boundary. The boundary loads stored identities under book authority, assigns stable book tokens and retains disclosure admissions before dispatch. Client names, owners, employees and private or unclassified counterparties are masked. Evidence-backed company counterparties keep their names. Sole-trader names are masked, while separately typed industry and tax attributes remain usable.

Typed financial facts retain exact values. Free text uses known aliases and Swedish personal-number patterns. Typed identity slots and message-template slots can restore tokens. Narrative text keeps tokens. Unknown tokens refuse the output.

Raw document reading is a separate disclosure mode. Originals require an explicitly approved provider policy and a retained admission. The boundary cannot hide identities inside an original invoice. Deterministic name comparisons stay inside Drastic and can provide their result to a model.

AUT-28 is a prerequisite for AUT-13, AUT-24 and AUT-26, and applies to the existing document reader. It reduces disclosure risk but does not guarantee anonymity. The proposed claim that names never reach a provider remains unavailable for raw documents and requires qualified outbound evidence.

---

## Design: what the boards must carry

Reviewed against page 00 on 10 October 2026: K-04, K-09, K-10, K-11, K-21, K-95, M-01
and M-02. The canon already has the right instincts:

- explanation by evidence ("Varför förslaget visas", why the suggestion is shown, in K-21);
- a per-field diff showing who changed what and why (M-02);
- two people for risky changes, where the preparer never counts (M-01);
- eight statuses for the whole product (K-04);
- an assistant that never posts on its own (K-95);
- firm-level "Regler och mandat" (rules and mandates) in K-09.

Automation must extend these patterns, not add a separate "AI" layer.

**Design rules for automation**

1. **No new statuses.**
   - Executed under a mandate: *Klart* (done).
   - The model is unsure or abstains: *Behöver dig* (needs you).
   - A suspended mandate: *Behöver dig*.
   - Shadow mode is never visible.
2. **Show evidence, not probability.** No percentages in work screens. A suggestion
   says *why* in accounting terms: "Som de 7 senaste fakturorna från Telia" (same as the
   last 7 Telia invoices), "Regel: Telia → telefoni, aktiverad av Sara 3 sep" (rule
   activated by Sara on 3 Sep), "Avläst från fakturan" (read from the invoice).
   Numbers belong only on the firm-model quality page.
3. **One provenance line in a fixed place.** Use the K-04 check-row pattern: an icon
   plus one sentence, in the same position in every panel. The source is one of firm
   memory, rule, firm model or extraction. The assistant appears as a colleague in the
   activity log (as in K-11), never as sparkles or gradients.
4. **Consequence first.** Under the posting lines, say what changes in the books and
   tax: report line, VAT and deductibility. When an alternative account is
   consequence-equivalent, say "samma rad i resultaträkningen" (same line in the income
   statement) and don't ask.
5. **Diff against what is normal.** Reuse the M-02 diff to show only what deviates
   from precedent, for example "3× vanligt belopp" (three times the usual amount) or
   "Nytt bankgiro" (new bankgiro number). Changed bank details open the M-01
   confirmation.
6. **A correction teaches once.** When an accountant changes a suggestion, ask inline:
   "Bara denna" (just this one) or "Alltid för Telia → föreslå regel" (always for
   Telia, propose a rule). The proposal lands in "Regler och mandat". This is AUT-08
   inside the work.
7. **Spot checks: judge first, then reveal.** The exploration share appears as
   *Stickprov* (spot check), a term auditors already know. The accountant decides
   without the suggestion, then sees it and whether they agreed. This produces
   independent labels and builds trust: "Ni var överens 19 av 20 gånger" (you agreed
   19 times out of 20).
8. **Correct, don't undo.** Work done under a mandate appears in *Klart* with a receipt
   and a single "Rätta" (correct) action that opens a correction bundle. Posting has no
   "Ångra" (undo).
9. **Autonomy is a scoped grant you can watch.** A mandate reads like a sentence:
   suppliers, class, per-invoice limit and monthly limit. It shows its evidence base,
   a live usage meter, and one-step suspension.
10. **Promote a model by showing what would change.** A new firm-model release is
    reviewed as "v8 hade bokfört 12 av septembers 900 beslut annorlunda" (v8 would have
    booked 12 of September's 900 decisions differently), listing those 12, not a metric
    table.
11. **Calm completion.** Empty and done states state counts, never claimed time saved:
    "September klart. 214 händelser, 9 behövde dig" (September done: 214 events, 9
    needed you).
12. **Keyboard-first batch review,** consistent with K-10's "Granska alla" (review
    all).

**Candidate boards**

Paper page "21 Automation, kandidater" holds one candidate board per issue below,
drawn on 10 October 2026 from copies of the page 00 screens. They are candidates,
not adopted design. They do not change `verification/paper/kanon-manifest.json` or
any baseline until a design adoption names them.

| Issue | Boards |
| --- | --- |
| AUT-D01 | A-01 Varför förslaget (K-11), A-01b states |
| AUT-D02 | A-02 Ändring blir regel (K-11) |
| AUT-D03 | A-03 Granska i klump (K-10) |
| AUT-D04 | A-04 Nytt bankgiro (K-11), A-04b anomaly rows and the M-01 confirmation |
| AUT-D05 | A-05 Stickprov, bedöm först (K-11), A-05b reveal states |
| AUT-D06 | A-06 Regler och mandat (K-09), A-06b two-approver grant (M-01) |
| AUT-D07 | A-07 Säkerhetsnyckel |
| AUT-D08 | A-08 Klart under mandat (K-10) |
| AUT-D09 | A-09 Byråns modell (K-09) |
| AUT-D10 | A-10 Samtycke via klientfråga (K-13), A-10b consent after the answer |

Decisions the boards surfaced:

- **A flag under a mandate.** A-04b proposes that an open AUT-07 flag takes that one
  invoice out of the mandate, as A-06b rule 5 does for the guard. This needs an
  AUT-22 decision.
- **Revocation wording.** A-10 promises that revocation stops use "direkt"
  (immediately). That holds for precedent retrieval. A trained firm adapter needs the
  AUT-00 retirement window before the copy can promise anything.
- **A presence key for a supplier bank-detail change.** A-04b requires two people
  (M-01) but no security key, because ADR 0020 marks only `verify_employee_payee` as a
  presence gesture. Decide whether supplier bank details join it.
- **Who can be asked.** A-10 asks the client owner. AUT-16 must say which client
  roles can answer for the company.

### AUT-D01 Explanation and provenance in review (K-11)

**Design-pending** · blocks AUT-14 · from AUT-01, 03, 05

Add to K-11's panel:

- a "Varför förslaget" (why the suggestion) section in the K-21 style, with the source
  line;
- a consequence summary under "Bokförs" (to be posted);
- the abstain state: "Första fakturan från leverantören, ingen säker gissning" (first
  invoice from this supplier, no confident guess).

States: firm memory, rule, model, no precedent, conflicting precedent.

### AUT-D02 Correction-to-rule prompt (K-11)

**Design-pending** · blocks AUT-08 UI

The inline prompt after an edit, and the resulting proposal row in "Regler och mandat".

### AUT-D03 Batch review with deviation highlighting (K-10 "Granska alla")

**Design-pending** · blocks AUT-14, 15

A dense table of familiar work in which only deviations from precedent are emphasised.
It needs a keyboard map, an explanation of the order ("Sortera: Viktigast") and a
bounded-batch approval summary (ADR 0017).

### AUT-D04 Anomaly rows and bank-detail change (K-11 and M-01)

**Design-pending** · blocks AUT-07 UI

Each AUT-07 flag is a K-04 check row. A box appears only when the flag blocks.
"Nytt bankgiro" (new bankgiro) links to the M-01 confirmation dialog.

### AUT-D05 Stickprov, judge then reveal (K-11 variant)

**Design-pending** · blocks the AUT-14 exploration share

States:

- the decision made with the suggestion hidden;
- the reveal when you agreed;
- the reveal when you disagreed, with consequence-equivalent and different variants.

### AUT-D06 Regler och mandat (K-09 firm level and book level)

**Design-pending** · blocks AUT-08, AUT-22 and the ADR 0020 mandate UI

- **Rule proposals:** evidence, counterexamples, activate.
- **Mandate list.**
- **Mandate detail:** scope sentence, evidence base, usage meter, suspend and revoke.
- **Grant flow:** two approvers (M-01), presence step-up and the consequence-class
  picker.

### AUT-D07 Presence step-up and enrolment (K-05 dialog family)

**Design-pending** · blocks the ADR 0020 presence UI

- The security-key prompt bound to the exact action, showing what is being confirmed.
- First enrolment with a one-time ticket.
- Failure and retry states.
- Explaining that an API key can never do this.

### AUT-D08 What was handled automatically (K-10 Klart, K-09 rows)

**Design-pending** · blocks AUT-22 UI and AUT-25

- A per-client digest of mandate-executed work with receipts.
- "Rätta" (correct).
- A spot-check entry.
- Portfolio row counts.

### AUT-D09 Byråns modell, the firm model page (K-95 family)

**Design-pending** · blocks AUT-16, 20

- Enrolment.
- Contributing and using books.
- Quality per decision class against your team on spot checks.
- The release diff ("what v8 would change") with promote and rollback (two approvers
  and a key).
- Revoke and retire.

### AUT-D10 Client consent through a client question (K-12, K-13, client audience)

**Design-pending** · blocks AUT-16

The bureau asks for consent through the existing question and reply flow, in plain
Swedish: "Får Byrå Nordlund använda era bokföringsbeslut för att bokföra snabbare åt
er? Uppgifterna delas inte med andra företag." (May Byrå Nordlund use your bookkeeping
decisions to book faster for you? The data is not shared with other companies.)

The client's own view shows contribute and use, with revoke. A BankID signature is a
later option.

## AUT-27 Require two approvers to grant a mandate

**Readiness:** Ready · **Size:** M · **Depends on:** none

Page 00 M-01 states that payments above a limit, changed bank details and mandates
require two people, and that the preparer never counts. The ADR 0020 implementation
grants a mandate with one operator.

Add a second-approver step:

- a pending grant that is not usable until a second, different operator confirms the
  same digest;
- presence proof on both gestures when the book requires it;
- either approver may withdraw before the second confirmation.

**Failure cases**

- The same person confirms twice.
- The grantee is one of the approvers.
- The terms changed between the two approvals; this resets both (M-02).
- Execution against a mandate that is pending only.
- A confirmation after a withdrawal.

**Acceptance**

- [ ] E2E covers every failure case.
- [ ] The posting-mandates journey is updated.

## Not in this handoff

- Pooled cross-firm models: a later decision with its own addendum.
- Generative bookkeeping.
- Automatic posting outside mandates.
- A new OCR dependency.
- Payroll learning.
- Investor claims of accuracy or time saving.

## Approved plan phase issues


## AUT-33 Supporting document per voucher

## Phase specification

[phase-02-voucher-support.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-02-voucher-support.md)

Every voucher in a period either cites a supporting document or carries an explicit reason why none exists. This is the most common missing fact in small-company books, and today nothing checks it. `evidenceRefs` may be empty and posting only verifies hashes (`domain/ledger.ts:110`, `posting.ts:531-534`).

## Dependencies

AUT-06

## Failure cases to write first

- [ ] A voucher whose only reference points at a missing or replaced document passes. It must fail.
- [ ] An agent credential records a no-document reason. It must be refused.
- [ ] A corrected voucher inherits the original's support without saying so.
- [ ] The check counts vouchers outside the period or after the cutoff.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

## AUT-32 Synthetic bureau month and deterministic baseline

## Phase specification

[phase-03-synthetic-month.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-03-synthetic-month.md)

Build the lever every later phase is measured with. A script creates a synthetic bureau month. A scorer compares any end state with independently authored gold expectations. The baseline is captured before any run exists, so later results read as "old value against new value".

## Dependencies

AUT-06, AUT-33

## Failure cases to write first

- [ ] The generator writes to PostgreSQL outside the operator seeding step.
- [ ] Two runs with the same seed produce different projection digests.
- [ ] The scorer passes when the predicate is `inconclusive`.
- [ ] Gold expectations are edited after implementation starts without a recorded reason.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

## AUT-29 Run engine and deterministic playbooks

## Phase specification

[phase-04-run-model.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-04-run-model.md), [phase-05-step-executor.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-05-step-executor.md), [phase-06-supplier-playbook.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-06-supplier-playbook.md), [phase-07-att-gora.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-07-att-gora.md), [phase-10-month-close.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-10-month-close.md)

Choose and land the data shape of a playbook run. This is a one-way door. Every later phase reads and writes it. Run the `architect` skill with an arena and a judge from a different model family before writing the migration. Use the harness research in [harness-research.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/harness-research.md) as input.

The preparation runner advances runs one step at a time. A kill at any step boundary followed by a restart reaches the same end state.

Playbooks are data, not code branches. The first playbook prepares a period's supplier invoices using only existing owners, firm memory and rules. No model runs. This proves the orchestration value on its own.

A person sees exactly one Att göra item per step that waits on them, with its cause. A run can be paused, resumed and handed to a colleague.

"Gör september klart för Fjällby" runs end to end on the synthetic month and meets the program definition of done in the overview. It uses code, rules, firm memory and people only. Models come afterwards, in Phases 11 and 12, as measured improvements on this result.

## Dependencies

AUT-06, AUT-32

## Failure cases to write first

- [ ] Two runners advance the same step. The fence must refuse the second.
- [ ] A stopped run advances.
- [ ] A step result from an older playbook version finalises a newer run.
- [ ] An agent credential starts or stops a run.
- [ ] A pending approval is lost or expires because the runner restarted.
- [ ] An approval resolves for records whose digest changed after it was requested.
- [ ] One inbox entry is consumed twice.

- [ ] A crash after the owner commits and before the step finalises produces a second owner effect. Replay must return the first.
- [ ] A lease expires mid-step and a second runner finalises a stale result.
- [ ] A permanent failure is retried.
- [ ] Budget exhaustion is reported as success.

- [ ] A skipped step is missing from the preview. Every skip must carry a reason.
- [ ] The playbook posts anything without approval or a valid mandate.
- [ ] The builder reads sources twice and the selection differs from the capture.
- [ ] Rerunning the playbook on a finished period creates duplicate reviews.

- [ ] One waiting step yields two items, or none.
- [ ] A resolved step leaves its item open.
- [ ] Hand-over loses the decision trail.
- [ ] A paused run advances when the runner restarts.

- [ ] The run reports done while any gated check is not a fresh `pass`.
- [ ] Filing, payment or signing happens without a presence gesture.
- [ ] A kill at any step boundary changes the canonical projection.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

## AUT-29-P4 Run model and architect arena

## Phase specification

[phase-04-run-model.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-04-run-model.md)

Choose and land the data shape of a playbook run. This is a one-way door. Every later phase reads and writes it. Run the `architect` skill with an arena and a judge from a different model family before writing the migration. Use the harness research in [harness-research.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/harness-research.md) as input.

## Dependencies

AUT-06, AUT-32

## Failure cases to write first

- [ ] Two runners advance the same step. The fence must refuse the second.
- [ ] A stopped run advances.
- [ ] A step result from an older playbook version finalises a newer run.
- [ ] An agent credential starts or stops a run.
- [ ] A pending approval is lost or expires because the runner restarted.
- [ ] An approval resolves for records whose digest changed after it was requested.
- [ ] One inbox entry is consumed twice.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

Compare candidates A, B and D in an architect arena. Use a judge from a different model family. Retain the verdict in `verification/agent-mode/` for owner review.

## AUT-29-P5 Fenced step executor and recovery

## Phase specification

[phase-05-step-executor.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-05-step-executor.md)

The preparation runner advances runs one step at a time. A kill at any step boundary followed by a restart reaches the same end state.

## Dependencies

AUT-29-P4

## Failure cases to write first

- [ ] A crash after the owner commits and before the step finalises produces a second owner effect. Replay must return the first.
- [ ] A lease expires mid-step and a second runner finalises a stale result.
- [ ] A permanent failure is retried.
- [ ] Budget exhaustion is reported as success.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

## AUT-29-P6 Playbook registry and supplier invoices

## Phase specification

[phase-06-supplier-playbook.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-06-supplier-playbook.md)

Playbooks are data, not code branches. The first playbook prepares a period's supplier invoices using only existing owners, firm memory and rules. No model runs. This proves the orchestration value on its own.

## Dependencies

AUT-32, AUT-29-P5

## Failure cases to write first

- [ ] A skipped step is missing from the preview. Every skip must carry a reason.
- [ ] The playbook posts anything without approval or a valid mandate.
- [ ] The builder reads sources twice and the selection differs from the capture.
- [ ] Rerunning the playbook on a finished period creates duplicate reviews.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

## AUT-29-P7 Att göra read model, pause and hand-over

## Phase specification

[phase-07-att-gora.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-07-att-gora.md)

A person sees exactly one Att göra item per step that waits on them, with its cause. A run can be paused, resumed and handed to a colleague.

## Dependencies

AUT-29-P6

## Failure cases to write first

- [ ] One waiting step yields two items, or none.
- [ ] A resolved step leaves its item open.
- [ ] Hand-over loses the decision trail.
- [ ] A paused run advances when the runner restarts.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

## AUT-31 Completeness and batched questions

## Phase specification

[phase-08-missing-facts.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-08-missing-facts.md), [phase-09-client-question.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-09-client-question.md)

The system can say, deterministically, which facts are missing for a book and period. This is the largest lever on accountant time. A model cannot book a receipt nobody sent.

A run asks each client once, with every askable fact in one question, and turns the answers back into facts. Today a question targets one record and can only be addressed to a book operator (`work-questions.ts:519-525`).

## Dependencies

AUT-06, AUT-33, AUT-32

## Failure cases to write first

- [ ] A fully allocated bank row is reported missing.
- [ ] A fact resolved after the observed cutoff counts as resolved at that cutoff.
- [ ] The same gap appears twice under two kinds.
- [ ] An unknown read is reported as "nothing missing". It must be `not_established`.

- [ ] Two runs ask the same client about the same fact.
- [ ] An answer to one slot resolves a different fact.
- [ ] An agent answers or closes a bundle.
- [ ] An attachment that is not an already retained original is accepted.
- [ ] Client free text reaches any model call.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

## AUT-31-P8 Missing-fact model

## Phase specification

[phase-08-missing-facts.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-08-missing-facts.md)

The system can say, deterministically, which facts are missing for a book and period. This is the largest lever on accountant time. A model cannot book a receipt nobody sent.

## Dependencies

AUT-06, AUT-33, AUT-32

## Failure cases to write first

- [ ] A fully allocated bank row is reported missing.
- [ ] A fact resolved after the observed cutoff counts as resolved at that cutoff.
- [ ] The same gap appears twice under two kinds.
- [ ] An unknown read is reported as "nothing missing". It must be `not_established`.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

## AUT-31-P9 Batched question with typed answers

## Phase specification

[phase-09-client-question.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-09-client-question.md)

A run asks each client once, with every askable fact in one question, and turns the answers back into facts. Today a question targets one record and can only be addressed to a book operator (`work-questions.ts:519-525`).

## Dependencies

AUT-31-P8

## Failure cases to write first

- [ ] Two runs ask the same client about the same fact.
- [ ] An answer to one slot resolves a different fact.
- [ ] An agent answers or closes a bundle.
- [ ] An attachment that is not an already retained original is accepted.
- [ ] Client free text reaches any model call.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

Client delivery is blocked by proposed ADR 0019. The ready implementation may address a bureau operator only. Client UI also waits for AUT-D12 adoption.

## AUT-29-P10 Deterministic month-close playbook

## Phase specification

[phase-10-month-close.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-10-month-close.md)

"Gör september klart för Fjällby" runs end to end on the synthetic month and meets the program definition of done in the overview. It uses code, rules, firm memory and people only. Models come afterwards, in Phases 11 and 12, as measured improvements on this result.

## Dependencies

AUT-29-P7, AUT-31-P9

## Failure cases to write first

- [ ] The run reports done while any gated check is not a fresh `pass`.
- [ ] Filing, payment or signing happens without a presence gesture.
- [ ] A kill at any step boundary changes the canonical projection.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

## AUT-34 Decision-model steps evaluated against deterministic close

## Phase specification

[phase-11-decision-steps.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-11-decision-steps.md)

Decision models enter runs as a measured improvement on the Phase 10 result. Each closed choice goes to the cheapest role that decides it with known reliability.

## Dependencies

AUT-29-P10, AUT-11, AUT-12, AUT-28

## Failure cases to write first

- [ ] A model decides where a ratified rule applies.
- [ ] Shadow output reaches any product read. Compare persisted state with shadow on and off.
- [ ] A provider call bypasses the egress boundary.
- [ ] An abstention is treated as a decision. It must become a person step.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

## AUT-35 LLM steps and code-mode investigation

## Phase specification

[phase-12-llm-steps.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-12-llm-steps.md)

Add an LLM only where judgement or language is needed, and keep it only if it measurably beats the Phase 11 result. An LLM never makes a closed accounting choice and never posts.

## Dependencies

AUT-34, AUT-24, AUT-00

## Failure cases to write first

- [ ] An LLM output names an account or VAT treatment that is then used without a decision step or a person.
- [ ] Instructions inside source data change the agent's tools or targets. The AUT-24 watchdog question must trip.
- [ ] An unknown token appears in output and is restored.
- [ ] The budget is exceeded and the step reports success.
- [ ] A program reaches the network, a `prepare` capability, or a capability added after the run started.
- [ ] A replay of a stored program at its as-of snapshot produces a different finding.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

Effect AI is behind a Drastic port. Build our own inner loop and interpreter from the specification without copying source. Bedrock EU is an unapproved AUT-00 candidate. Deterministic technical execution limits remain separate from managed billing or plan caps.

## AUT-D11 Design the run view

## Phase specification

[phase-13-surface.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-13-surface.md)

People can start, watch, pause and hand over a run, and answer its questions. Bureaus' own agents can follow the same playbooks over MCP.

## Dependencies

None.

## Failure cases to write first

- [ ] A screen introduces a ninth status, or a percentage in a work screen.
- [ ] A baseline is regenerated from candidate code.
- [ ] An MCP prompt lists a step whose tool the agent policy withholds.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

Readiness is design-pending. These boards are not adopted. No implementation or baseline regeneration is authorized by this issue.

## AUT-D12 Design the batched client question

## Phase specification

[phase-13-surface.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-13-surface.md)

People can start, watch, pause and hand over a run, and answer its questions. Bureaus' own agents can follow the same playbooks over MCP.

## Dependencies

None.

## Failure cases to write first

- [ ] A screen introduces a ninth status, or a percentage in a work screen.
- [ ] A baseline is regenerated from candidate code.
- [ ] An MCP prompt lists a step whose tool the agent policy withholds.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

Readiness is design-pending. These boards are not adopted. No implementation or baseline regeneration is authorized by this issue.

## AUT-36 MCP playbook prompts and resources

## Phase specification

[phase-13-surface.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/05-accounting-agent/phase-13-surface.md)

People can start, watch, pause and hand over a run, and answer its questions. Bureaus' own agents can follow the same playbooks over MCP.

## Dependencies

AUT-29-P7

## Failure cases to write first

- [ ] A screen introduces a ninth status, or a percentage in a work screen.
- [ ] A baseline is regenerated from candidate code.
- [ ] An MCP prompt lists a step whose tool the agent policy withholds.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

## AUT-30 Fixture-backed rule sources

## Phase specification

[phase-01-corpus.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/06-rule-sources/phase-01-corpus.md), [phase-02-lookup.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/06-rule-sources/phase-02-lookup.md), [phase-03-monitor.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/06-rule-sources/phase-03-monitor.md)

Drastic keeps its own versioned copy of public Swedish sources, so it can answer "what applied on this date". Today it stores no sources, has no fetcher, and has no search.

One operation answers a question for a given date with ranked passages, their authority and their validity. The same operation serves the app, MCP and run steps. Explanations may cite it. Treatments never come from it.

When a source changes, Drastic proposes a release dossier with citations and names the books it affects. An operator reviews and installs it. Today `rule_change_notices` are entered by hand with free-text evidence (`migrations/0010-next-49.sql:18-75`).

## Dependencies

None.

## Failure cases to write first

- [ ] A snapshot is overwritten instead of appended.
- [ ] A section is returned for a date outside its effective interval.
- [ ] A date before the first snapshot returns text instead of `unknown`.
- [ ] A citation that does not parse is dropped silently. It must be counted.
- [ ] A fetch failure leaves the corpus marked current.

- [ ] A passage valid only after the asked date is returned.
- [ ] A weaker source outranks a stronger one on the same point.
- [ ] An official position is presented as law.
- [ ] The query text reaches any external service. Queries reveal client situations.

- [ ] A dossier is selectable for any treatment before installation.
- [ ] The author installs their own dossier.
- [ ] A checksum that differs from the canonical body is accepted.
- [ ] A change reaches books that never used the affected rule.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

Start only while the engine track waits on review. Use fixtures; live public-source fetching remains an AUT-00 decision.

## AUT-30-P1 Point-in-time source corpus

## Phase specification

[phase-01-corpus.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/06-rule-sources/phase-01-corpus.md)

Drastic keeps its own versioned copy of public Swedish sources, so it can answer "what applied on this date". Today it stores no sources, has no fetcher, and has no search.

## Dependencies

None.

## Failure cases to write first

- [ ] A snapshot is overwritten instead of appended.
- [ ] A section is returned for a date outside its effective interval.
- [ ] A date before the first snapshot returns text instead of `unknown`.
- [ ] A citation that does not parse is dropped silently. It must be counted.
- [ ] A fetch failure leaves the corpus marked current.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

Start only while the engine track waits on review. Use fixtures; live public-source fetching remains an AUT-00 decision.

## AUT-30-P2 Deterministic rule lookup over HTTP and MCP

## Phase specification

[phase-02-lookup.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/06-rule-sources/phase-02-lookup.md)

One operation answers a question for a given date with ranked passages, their authority and their validity. The same operation serves the app, MCP and run steps. Explanations may cite it. Treatments never come from it.

## Dependencies

AUT-30-P1

## Failure cases to write first

- [ ] A passage valid only after the asked date is returned.
- [ ] A weaker source outranks a stronger one on the same point.
- [ ] An official position is presented as law.
- [ ] The query text reaches any external service. Queries reveal client situations.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

Start only while the engine track waits on review. Use fixtures; live public-source fetching remains an AUT-00 decision.

## AUT-30-P3 Source change monitor and reviewed dossiers

## Phase specification

[phase-03-monitor.md](https://github.com/erik-kroon/drastic/blob/eee5faa/docs/plans/06-rule-sources/phase-03-monitor.md)

When a source changes, Drastic proposes a release dossier with citations and names the books it affects. An operator reviews and installs it. Today `rule_change_notices` are entered by hand with free-text evidence (`migrations/0010-next-49.sql:18-75`).

## Dependencies

AUT-30-P1

## Failure cases to write first

- [ ] A dossier is selectable for any treatment before installation.
- [ ] The author installs their own dossier.
- [ ] A checksum that differs from the canonical body is accepted.
- [ ] A change reaches books that never used the affected rule.

## Delivery

Synthetic data and fixture providers only. Write reproducing E2E failure cases before implementation and retain artifacts under `test-results/`. Claim checks only from a clean worktree. No model reads client free text or document text. No runtime harness dependency, billing, metering or managed-plan caps. People start and stop runs. Per-question/book modes are operator-controlled. ADR 0020 remains proposed; deterministic playbooks work without mandates.

Start only while the engine track waits on review. Use fixtures; live public-source fetching remains an AUT-00 decision.
