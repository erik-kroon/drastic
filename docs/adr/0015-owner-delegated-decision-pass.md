# 0015 — owner-delegated decision pass: operating mode, test permission and product-scope disposition

Status: accepted planning and process decision, 2026-09-28. Selected by the repository owner/operator under explicit delegation to the analysis and decision role; integrated by the coding agent. This record resolves **process, sequencing, test permission and product-scope disposition**. It does **not** change the settled application-owned architecture ([ADR 0010](0010-application-owned-accounting-replacement.md)), the exact posting and approval contracts ([ADR 0002](0002-exact-posting-and-approval.md)), the delivery contract ([ADR 0004](0004-complete-accounting-delivery-contract.md)), the AGPL-3.0-only licensing position ([ADR 0005](0005-open-accounting-and-managed-services.md)), or the vendoring rule for the NEXT dossiers ([ADR 0012](0012-next-implementation-dossier.md)). No company fact, credential, provider outcome, legal qualification or runtime verification is created by this decision.

## Context

The repository had accumulated a large body of unresolved planning input without a mechanism to resolve it. Five externally produced NEXT dossiers ([ADR 0012](0012-next-implementation-dossier.md)) supplied implementation-level design for 125 work items. Two externally produced plan reviews proposed replacements for the accepted parity backlog and test plan, and [14-plan-review-adoption.md](../plans/14-plan-review-adoption.md) recorded five adoption questions as pending. The D-register carried ten rows whose framing assumed a standing maintainer, accounting department and security team who would resolve them later.

That model was wrong for this repository. There is one owner/operator. Questions addressed to an accounting department or security team were not pending decisions; they were decisions that had not been made, and no amount of additional planning would settle them. The unresolved register grew to 34 product-scope items and 10 process rows, and its growth was itself a risk: an unowned item list becomes an unowned product.

The owner/operator has now made those decisions. The decision pass is recorded in [the vendored decision record](../specs/decision-pass-2026-09-28/README.md), and [the open-decisions register](../open-decisions.md) is the authority after this integration. This ADR records what was decided, what was deliberately not decided, and the boundaries that hold regardless.

Four properties of the incoming decision pass shaped how it was integrated, and each is recorded because it changes what the decisions mean:

1. **It is a decision, not evidence.** Every gate in it carries `independently_verified_by_this_pass: false`. It changes permissions and sequencing. It proves no runtime behaviour, no monetary result and no company fact.
2. **Its scope register was one wave behind.** It dispositions 23 product-scope capabilities covering 24 `NEXT-nn` identifiers. The fifth dossier, vendored the same day, introduced 11 further unowned lifecycles that the pass does not mention. Those 11 are carried forward as open in [the dossier plan](../plans/12-next-implementation-dossier.md); they are **not** closed by this ADR.
3. **It is partly redundant with decisions this repository already made.** NEXT-121, bounded standing posting mandates, is design for a contract [the operations plan](../operations.md) had already adopted, including the rule that a mandate never implicitly authorizes payment, closure, signature or filing. And ADOPT-5, the register validator, is substantially already satisfied by `docs/plans/check-plan.py`, which validates known identifiers, owners, dependency cycles, conditional-gate references, traceability coverage, counters and link/anchor integrity. Neither was built again.
4. **Its strongest claims are about authority, not engineering.** The release-gate change and the test permission are the parts that unblock the most work. They are also the parts where a careless integration could quietly weaken a control, so each is bounded explicitly below.

## Decision

### The first release is owner-operated, and that changes the engineering release gate

The first operating mode is **private single-operator use** with owner-reviewed bookkeeping and independently derived checks. An outside accountant is not a universal engineering release gate.

This replaces "wait for a named external reviewer" — an unachievable requirement in a one-operator repository — with a substantive standard that is achievable and still means something:

```text
Actual original documents
→ explicit applicable rules
→ exact expected accounting effects
→ working application transactions
→ independently reconciled balances
→ explicit owner approval of real actions
```

Three limits are part of the decision, not caveats added to it:

- **This is an engineering gate, not a legal one.** Statutory audit and reporting obligations, where they apply to the company, are unaffected. Nothing in this repository states, implies or is permitted to imply that a product decision waives them. [docs/compliance.md](../docs/compliance.md) is unchanged and remains the compliance authority.
- **"Independent" is redefined for acceptance, and only for acceptance.** It means independent inputs and independently derived expectations — computed from primary rule sources and the source documents, not by calling the production function or a second model. It does not mean professional certification, and the word must not be used interchangeably with certification anywhere in the maintained documents.
- **Owner approval is a real human act.** The owner remains the person who confirms business facts and authorizes real company actions. A guessed registration, a synthesized signature or a simulated bank payment is not evidence, and the product must keep refusing to treat it as such.

### D-09 is resolved as a bounded standing test permission

Focused unit, property/conformance, regression and integration/E2E tests for existing or explicitly adopted workflows are authorised. Synthetic fixtures and disposable isolated local/CI systems. Real local PostgreSQL, workerd, Bun and selected browser/REST/MCP journeys are in scope.

The permission is bounded on purpose, and the boundary is the same as the existing forbidden-actions list: **no real company data, no live provider credentials, no customer or third-party contact, no production migration or reset, no deployment, no payment or bank instruction, no signature or statutory filing, and no invented company records or professional certification.** Stricter task-specific restrictions still govern where they exist — the dated document-intelligence authorisation and its no-live-provider limit are retained unchanged. Weakening an expectation to obtain green output remains forbidden, and production functions may not serve as their own expected-result oracle.

This is a policy change and it is deliberate, not an oversight: the previous blanket prohibition is replaced in `AGENTS.md` rather than ignored alongside it.

**HARNESS-1 is rejected.** The trusted application runtime must hold the scoped table writes its architecture requires. Tests establish that unauthorised callers cannot misuse those operations at their real boundary; they do not require the intended installation to be incapable of functioning. This agrees with [ADR 0010](0010-application-owned-accounting-replacement.md) and removes a contradiction the accepted test plan contained.

### The operating path is local and self-hosted first

| Row | Selection |
| --- | --- |
| D-01 | Existing loopback Better Auth password path, verified present in `apps/api/src/adapters/auth/configuration.ts`. Eight-hour sessions and disabled public signup retained. Hosted mode keeps its real OIDC requirement, which is a **hosted-access** gate, not a development or private-use gate. Local authentication is not to be exposed remotely. |
| D-02 | ADR 0010's narrow database boundary is retained unchanged. Evidence is requalified per affected revision against real PostgreSQL, workerd and Bun, rather than treated as universally current. |
| D-03 | Independently specified expected amounts, byte vectors and finite laws, in addition to end-to-end tests. Expected values are written before production results are inspected. |
| D-04 | Two native accounting-method profiles — accrual and cash method — as explicit profiles, with independent VAT-method configuration. K2 is the first annual-report target **for actually eligible companies**; it is not a claim that any particular company qualifies. |
| D-05 | The current stateless JSON MCP contract is retained. No SSE or tasks redesign. Capabilities are generated from source metadata and qualified individually; a planned tool is not a supported transport. |
| D-06 | File-first full-history import where an authoritative prior ledger and complete material exist; otherwise an explicitly identified original-source reconstruction with an evidenced opening. No invented previous system, no duplicated history alongside an opening balance. |
| D-07 | Existing self-host Bun API, PostgreSQL and filesystem original store as the first private operating profile, on encrypted operator-controlled storage outside the repository. Worker/Cloudflare and R2 ports are retained for hosted operation. Engineering targets: **RPO ≤ 24 hours, RTO ≤ 4 hours** — targets to demonstrate, not results. An independent encrypted backup and an observed restore are required before this is relied on as the sole live ledger. A second folder on the same disk is not a backup. |
| D-08 | Primary-source rule research and specification review are performed by AI and coding agents. No nonexistent outside accountant is the default engineering prerequisite. Specific rule releases remain unqualified until evidenced. |
| D-10 | File and manual official-channel handoffs first, with connected provider actions disabled. Offline parsers, artifacts and documented adapter contracts are buildable without credentials. The user performs any real bank, signing or filing gesture; the application records the exact resulting evidence. |

**D-04 does not decide the company's method.** The reported company name, fiscal dates and bank remain reported facts. A method, registration or effective date is established from original registration and change records, not chosen by preference and not defaulted. Missing facts block the affected financial action; they do not block source retention, review, synthetic implementation, or testing both supported methods.

### Accounted is a pinned reference, not the authority

The reference is pinned at `erp-mafia/accounted` `7ebea94fb3968c126e67e6cfe7efab695cc65b2f`. It is used actively and is a genuine source of counterexamples. It is never the sole acceptance criterion, and "Accounted returned the same number" does not close a question.

The verification hierarchy is: actual source documents and independent balances establish what happened; applicable primary rules and explicit expected cases establish what should result; pinned Accounted code, tests or an isolated run provide concrete comparison; actual openERP runtime observations establish whether this implementation performs and recovers correctly. When openERP and Accounted disagree, the difference is investigated against the source facts and the applicable rule — neither implementation is automatically changed to match the other, and neither is assumed superior.

Licensing is preserved. The inspected reference licence is AGPL-3.0-or-later with a limited extension exception. Material carried across must retain its provenance, must not be presented as original openERP code, and must not be treated as unconditionally licensed data. The repository's AGPL-3.0-only position is unchanged. A reference runtime stays isolated and nonauthoritative; no service purchase and no upload of company originals to a hosted application.

### Product scope: 23 capabilities dispositioned, 11 carried forward

The 23 capabilities the pass covers — loans, late FX repair, impairment reversal, foreign cash, paid-payroll recovery, EU sales reporting, receivable loss and recovery, unbilled revenue, supplier payment holds, direct cash flow, purchase commitments, budgets, accounting-method change, project and milestone billing, operating rentals, tax depreciation, tax allocation reserves, pension reconciliation, dividends, grants, setoff and counterparty confirmations, plus multi-reviewer quorum — are dispositioned as **adopted bounded accounting capabilities**, **adopted optional product work**, **adopted limited profiles** or **deferred**, per the vendored record.

The distinctions that matter are preserved rather than flattened:

- *Adopted conditional accounting* means the company case decides whether it is required for that release. It is not optional forever, and the decision is no longer an unanswered question about whether the product should support it.
- *Adopted optional* means sequenced later. It does not all precede the first usable accounting period.
- *Deferred* — grants and multi-reviewer quorum — means beyond the first release. It is not permission to ignore a real transaction or to invent another human signature, and an actual unsupported case stays visible.
- Adopting operating-rental support does **not** adopt finance-lease or right-of-use scope. That broader engine is excluded from this first-release decision.
- Adopting a positive workflow without a supported correction boundary is not permitted. The rule is explicit: do not advertise a positive workflow without a clearly supported correction boundary and a truthful refusal and recovery path outside it. Corrections attach to the existing FX, asset and payroll owners; no second generic correction engine and no second financial register is created.

**The 11 capabilities the pass does not reach are carried forward open**, because the pass was written against a register one wave behind. They are onerous and warranty provisions, insurance loss and recovery, common-cost VAT deduction true-up, EU B2C destination VAT and Union OSS, EU foreign input-VAT recovery, car-benefit valuation, interest-statement identities, share subscriptions, direct debit, balance-sheet substantiation, and the authorisation question for bounded standing posting mandates. They keep their existing identifiers and owners. This ADR does not decide them, and no agent may read its silence as a decision.

### The five review-adoption questions are taken

| Question | Decision |
| --- | --- |
| Revised parity backlog | Adopt the corrected ownership, evidence and per-rule safety model. Reconcile against current source; preserve later valid requirements and stable `PRY-nn` identifiers. No wholesale old-file overwrite, no verbatim unsafe recipe. |
| Revised ADR 0011 | Adopt the separation of design coverage, implementation, observed evidence and selected-release readiness. Retain the core historical denominator; derive a separate selected-scope release result. |
| Revised test plan | Adopt the corrected observable-business cases and bounded conformance testing, retain real-PostgreSQL/workerd integration, reject HARNESS-1. Derive current expected behaviour from accepted contracts and primary-source facts rather than copying an older patch. |
| Companion D-register edits | Applied through this ADR and the rewritten [open-decisions register](../open-decisions.md). No parallel authoritative register. |
| Register validator | **Already substantially satisfied** by `docs/plans/check-plan.py`. No second validator is built. |

Adoption of a decision is not adoption of the old file's bytes. A 1,503-line plan replaced by a 235-line document is a rewrite, not an import, and [14-plan-review-adoption.md](../plans/14-plan-review-adoption.md) records the textual reconciliation as remaining integration work. A test-plan error is not a proven runtime defect, and a planning defect is not automatically a code defect.

## Boundaries that hold regardless of this decision

- No production migration or reset.
- No real-company data processing inferred from the test permission.
- No live provider use.
- No payment or bank instruction.
- No signature or statutory filing.
- No customer or third-party contact.
- No invented company records and no professional certification.
- No removal of lint, type, frozen-lockfile, failure-reporting, process-ownership or concurrency rules. A timed-out or skipped check is unobserved or failed, never a pass.
- No new generic financial interpreter, rules engine, correction engine, financial register, job runtime or test platform. Prefer the platform and the tools this repository already has.
- **A planning packet marked adopted is not implemented, and an implemented source path is not a qualified financial result.** Design, implementation, runtime observation, company qualification and external acceptance remain five separate states.

## Alternatives

| Alternative | Reason it was not taken |
| --- | --- |
| Keep the questions open pending an accountant, security team or maintainer | There is no such party. The questions were not waiting; they were unmade, and leaving them open grew the register to 34 items without moving any work. |
| Wait for external professional review before accepting any release | Unachievable in a one-operator repository, and it would have blocked all acceptance. Replaced with owner acceptance plus independently derived source, rule and runtime evidence. |
| Keep the blanket test prohibition and request approval per test | Every ordinary regression would require a fresh decision round. The permission is now bounded once, in writing, instead. |
| Accept HARNESS-1 as written | It would require the runtime role to be unable to write application tables, contradicting ADR 0010 and the intended installation, and it would invite tenant-session identity patterns back in. |
| Treat Accounted agreement as acceptance | It replaces independent derivation with a second implementation's opinion, and both could share the same misunderstanding. |
| Close all 34 scope items as decided | The decision pass covers 23 capabilities. Closing the other 11 by silence would be the exact failure this record exists to prevent. |
| Import the revised parity backlog and test plan as files | A wholesale old-file overwrite would delete later valid requirements and would not survive the existing 53-packet and 101-edge integrity gate. |

## Consequences

- Work unblocks immediately: local development, ordinary regression testing, a chosen accounting-method path, and a selected product scope with a named disposition per capability.
- The acceptance standard becomes checkable by a coding agent: independent expectations, real runtime observation, real recovery, and an explicit owner act for real company actions.
- The D-register stops being a queue of unaddressed parties and becomes a set of affected-stage gates with named remaining evidence.
- Eleven scope items and every provider, credential, company-fact and legal-qualification gate remain genuinely open, and are recorded as such.
- "Independent" now has a specific accepted meaning in acceptance contexts, which is a sharper obligation than the previous ambiguity and must not be applied to certification claims.
- The reference comparison gains a pinned commit, an explicit licence position and a documented place in the evidence hierarchy, instead of an unstated influence.
- The repository carries a documented risk that adoption of the revised plans is partially integrated: the decisions are recorded, the textual merge is not complete, and the two must not be conflated.

## Implementation and proof

This decision is a planning and process artifact. Its proof is that the maintained registers state it rather than contradict it: that `AGENTS.md` carries the bounded permission instead of the blanket prohibition, that the D-register separates chosen design from remaining evidence, that [14-plan-review-adoption.md](../plans/14-plan-review-adoption.md) records the five adoptions with honest integration status, that the dossier plan carries the 23 dispositions and the 11 open items, and that `python3 docs/plans/check-plan.py` still passes with the mandated index unchanged in count, edges and denominator.

Proof that any workflow, monetary result or company profile is correct is that workflow's own acceptance under the authorisation in force. **No runtime, database, browser or provider workflow was executed to produce this decision, and this ADR verifies none.**
