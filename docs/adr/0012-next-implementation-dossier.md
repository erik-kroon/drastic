# 0012 — vendored NEXT implementation dossiers

Status: accepted planning decision, 2026-09-26; amended 2026-09-28 to cover a third wave, NEXT-51 … NEXT-75, and a fourth wave, NEXT-76 … NEXT-100, under the same rules. It governs where design material lives and how implementing agents consume it. No packet, rule, rate, provider or legal profile is activated, and no implementation, runtime or company-readiness status is claimed.

## Context

Two externally produced dossiers arrived with implementation-level pseudocode for fifty work items inside the application-owned Effect boundary: NEXT-01 … NEXT-25 as an application-owned rewrite of an earlier SQL-owned packet set, and NEXT-26 … NEXT-50 as a second wave. Each packet names an existing owner, the delta it adds, the algorithm, the transaction boundary, the failure and replay cases, and concrete numeric vectors. Together they are the most specific statement this repository has of *how* the planned work would be built, and they are aligned with the boundaries already selected in [ADR 0009](0009-effect-mq-background-jobs.md) and [ADR 0010](0010-application-owned-accounting-replacement.md).

They also arrive as foreign artifacts, with three properties that make careless adoption dangerous.

1. **Their status is not ours.** Both state that they are proposed design, that no repository file was modified, and that no application, database, queue or provider workflow was run. Their self-checks are document and arithmetic checks. A planning document that adopted their wording as requirement text would silently convert a proposal into a claim.
2. **Their evidence is pinned and stale by construction.** The second wave pins a repository review and then records that the repository moved during preparation. Both pinned revisions are ancestors of this repository's current history, so their statements of absence describe a revision, not the checkout an agent will edit. The first wave additionally names an ownership amendment and an earlier packet archive as its inputs, and those inputs were not supplied with it.
3. **They overlap the plans without being the plans.** Most packets implement requirements the seven-area plan, the capability backlog or the parity backlog already own. A few describe lifecycles the plans name only as follow-up work, and one — the loan lifecycle — is labelled by its own authors as a proposed product extension rather than a discovered defect. Folding fifty packets into the mandated index would change a reviewed completion denominator on the strength of an external input, exactly the failure [ADR 0011](0011-reference-parity-backlog.md) already recorded for reference-parity findings.

Leaving the files in a downloads folder has the opposite failure: they are unversioned, they disappear, and the next agent has no way to tell which revision a decision was based on or whether the copy in front of them is the reviewed one.

## Decision

Vendor both dossiers into the repository as **byte-identical, separately rooted, checksummed material** under `docs/specs/next-01-25/` and `docs/specs/next-26-50/`, with a maintained provenance and verification record in `docs/specs/README.md` and the import observation in `docs/plans/evidence/next-dossier-verification.md`. Do not edit a file inside either tree: a file that no longer matches its recorded checksum is no longer the reviewed artifact, and a change is recorded as a new dated revision instead.

Keep `NEXT-nn` as a **third supplemental work namespace** alongside `PRY-nn`, described in [the dossier plan](../plans/12-next-implementation-dossier.md). It does not enter the 53-packet accounting index, its dependency DAG or its completion denominator, and neither namespace is renumbered to merge them. A `NEXT-nn` identifier is a work ID and never a migration number.

Treat packet content as a **contract to bind to real code**, not as a framework to reproduce. `App`, `Db` and `Domain` symbols, module paths and helper names are proposed responsibilities; the implementing agent resolves them against the actual owners. The repository instructions win on any conflict: `AGENTS.md`, ADR 0009 and ADR 0010, the area plans, the exact-money and scoped-transaction rules, and the existing outbox plus effect-mq delivery composition.

Make the prerequisites explicit rather than implicit. `APP-SLICE-READY(area)` is resolved against the real checkout before coding; a missing port is a prerequisite to raise, never a second owner to build. The five reserved workstreams and the application replacement stay reserved, and a reservation is re-resolved against the current tree when its owner is released.

The dossiers grant **no authority**. They add no repository test, no data reset, no deployment, no provider call, no payment and no filing, and they activate no statutory rate, tax table, provider schema or legal profile. Their numeric vectors are design obligations to satisfy under the test authorization actually in force, not tests to add.

## Alternatives

| Alternative | Reason for this decision |
| --- | --- |
| Leave the archives in a downloads folder | Unversioned and unreviewable. The next agent cannot tell which revision a decision used, cannot detect local edits, and the material vanishes with the folder. |
| Merge packet text into the area plans | The plans would then carry foreign status claims, and fifty packets of pseudocode would bury the requirements they are supposed to implement. |
| Add the fifty packets to the mandated 53-packet index | Changes a reviewed completion denominator, its edge count and its validation on the strength of an external design input, and mixes requirements with implementation design. |
| Treat the dossiers as authoritative over the live source | The pinned reviews are already behind the checkout. A packet is evidence of a considered design, not evidence of current code, and neither may silently reclassify an old approved plan. |
| Discard the first wave as superseded by the second | The second wave depends on the first wave's contracts for at least fifteen of its packets. Its design value does not expire because a later wave exists. |
| Adopt the packet designs without their refusals and replay cases | The failure, replay and stale-approval cases are the most expensive content in the files and the easiest to lose. A packet reduced to its happy path is the defect this decision exists to prevent. |

## Consequences

- An implementing agent receives, per work item: the existing owner to reconcile, the exact delta, the algorithm, the transaction and lock expectations, the failure and replay obligations, the numeric vectors and the qualified external inputs it does not have.
- The distinction between "we have this requirement", "we have a work unit for it" and "we have an implementation design for it" stays visible, and an external proposal cannot become a maintained claim by being copied.
- Progress reporting keeps its denominator. Fifty supplemental packets exist, and they are explicitly outside it.
- The vendored copies are verifiable: the archives' own checksums and checkers run against them, and a modified copy is detectable.
- Six requirements the plans do not yet own are now visible with a named decision each, instead of arriving later as an undocumented extension.
- The material can go stale. Both waves are dated snapshots; the plan records how to supersede a packet without silently editing the reviewed artifact.

## Amendment 2026-09-28: third wave NEXT-51 … NEXT-75

A third dossier arrived with implementation-level pseudocode for twenty-five further work items, pinned to `116a5ca6b5fb9ec9fb08ee55c3beaad5af6b8fa5` and prepared 2026-09-28. It is vendored at `docs/specs/next-51-75/` under exactly the rules above, and the decision above is unchanged by it. What the amendment records is the scope extension and the one place where the third wave's own wording weakens an evidence claim the first two waves already limited.

**Scope extension.** Vendor the tree byte-identical and checksummed at `docs/specs/next-51-75/`, with its own import observation in [next-51-75-dossier-verification.md](../plans/evidence/next-51-75-dossier-verification.md). `NEXT-nn` remains a supplemental work namespace outside the mandated 53-packet index, its DAG and its completion denominator; the third wave renumbers nothing and asserts that it preserves NEXT-01 … NEXT-50. Seventy-five supplemental packets now exist and all seventy-five remain outside the denominator. No new reservation is added and none is released.

**Where the third wave is weaker evidence of absence.** The first two waves at least claimed a repository review at a pinned revision. The third wave's own `INTEGRATION-MAP.md` defines "new" as absent from the *prior NEXT scope* and states that this is not an exhaustive current-source absence audit, and its `README.md` states that it does not claim every new capability is wholly absent from unreviewed code. Its "new deliverable" column is therefore a statement of authorial intent, not a finding about this checkout. The dossier plan records this and instructs the same reconciliation the other two waves already required.

**What the amendment does not do.** It does not adopt any packet design, requirement, packet count, dependency edge, sequencing order or gap decision; it does not add a D-row to [open decisions](../open-decisions.md); it does not grant test, deployment, provider, payment, filing or company-data authority; and it does not discharge any earlier packet's application, persistence or proof obligation. Five lifecycles the third wave names — the EU sales statement, receivable allowance and loss lifecycle, purchase commitments, budget control and accounting-method change — are recorded in the dossier plan as dated, unverified search results needing a decision, not as adopted scope.

## Amendment 2026-09-28 (second): fourth wave NEXT-76 … NEXT-100

A fourth dossier arrived on the same date, pinned to `66355b62b23e3b8007c2d324f3739fbbcc96cdc0` — this repository's head at import — with twenty-five further work items. It is vendored at `docs/specs/next-76-100/` under the same rules, with its own import observation in [next-76-100-dossier-verification.md](../plans/evidence/next-76-100-dossier-verification.md). The decision above is unchanged. Two things are recorded because they are new.

**Scope extension.** One hundred supplemental packets now exist, and all one hundred remain outside the mandated 53-packet index, its DAG and its completion denominator. The fourth wave renumbers nothing, records the prior range as "not assumed complete", and reserves the same owners. Its conditional tax, grant, dividend, termination, pension and lease profiles are explicitly not launch prerequisites, and the dossier plan records that a dated search found no maintained owner for twelve of its lifecycles, each with the decision it needs.

**Pinning and auditing are independent, and this wave separates them.** Earlier waves were pinned to revisions this repository has moved past, so their statements were stale but auditable. The fourth is pinned to the current head, so nothing in it is stale — and it states that its repository reading was "targeted to plans, operations and the candidate entry point" with "no complete source audit or runtime qualification" claimed. A well-pinned proposal from a targeted read is still a proposal. The rule that a packet is a contract to bind to real code, not a framework to reproduce, and the rule that a statement of absence describes a pinned revision rather than the checkout, both apply unchanged.

**One tooling caveat, recorded because it affects verification.** Every vendored checker writes its own `checks/results.json` when it runs, so running one inside a vendored tree is a write. For the first three waves the regenerated file is byte-identical to the archived one. For the fourth it is not: the same 264 checks pass with the same counts, but the document checks are emitted in filesystem enumeration order, so the file fails its own manifest entry until the archived bytes are restored. Verification of that tree is therefore order-sensitive, and the import record states the restore that was performed and re-verified. This is a property of the archive's tooling and is not evidence for or against any packet.

## Implementation and proof

This decision is a planning artifact. Its proof is that `python3 docs/plans/check-plan.py` still passes with the mandated index unchanged in count, edges and denominator, that all four vendored trees still satisfy their recorded checksums and self-checkers, and that the maintained bridge document states its mapping as proposed rather than verified. Proof that any packet is implemented is that packet's own acceptance under the authorization in force, which is out of scope here.
