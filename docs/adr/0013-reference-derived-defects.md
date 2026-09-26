# 0013 — reference-derived defects are fixed forward, never by editing the reviewed baseline

Status: accepted planning decision, 2026-09-26. It governs placement and sequencing only. It fixes nothing, and it claims no runtime, company or external-acceptance status.

## Context

A comparison against a working reference implementation surfaced defects in code we already ship. Two of them are severe: a voucher balance guarantee whose second code path is unreachable, so a committed voucher's lines can grow without the guarantee being re-established; and a uniqueness constraint on retained evidence that makes it structurally impossible to keep two genuinely distinct occurrences of a byte-identical document — the exact case our own supplier-inbox requirement was written to protect. Several more are internal contradictions between our own files, which are the most dangerous kind, because a reader of either file in isolation is right.

The instinct is to correct these in place. That instinct is wrong here, for a reason that is specific to this repository rather than general good practice.

[ADR 0010](0010-application-owned-accounting-replacement.md) selected application-owned accounting on a **clean three-file baseline**, and the delivery plan states the consequence explicitly: the clean replacement installs only the three reviewed files, and future releases use **forward migrations**. The baseline is not a starting point to be improved; it is a reviewed artifact whose value depends on being exactly what was reviewed. Editing `0002-integrity.sql` to add a trigger that was never reviewed would make the file a record of something nobody checked, and it would make the planning-integrity hash in `evidence/planning-integrity.json` a hash of a fiction.

There is a second, subtler pressure. A defect register invites scope creep: the moment a comparison can write "this is wrong", anything can be reclassified as a defect, and the reviewed baseline plus the reviewed ADR become negotiable. That is precisely the outcome the clean baseline was chosen to prevent.

## Decision

Record reference-derived findings that are wrong **now** in a separate [defect register](../plans/13-reference-derived-defects.md), and keep them separate from forward scope in the [parity backlog](../plans/11-parity-backlog.md). The distinction is by kind, not by severity: a defect is something already shipped that is wrong or unsafe; a backlog packet is something not built.

Fix every defect by **forward migration or forward packet**. Never edit `0001-schema.sql`, `0002-integrity.sql` or `0003-roles.sql`.

Before a forward migration tightens an existing constraint, state which of three states the target population is in, because they need different migrations:

| Population state | Migration shape |
| --- | --- |
| Empty or synthetic only | Add the constraint directly. |
| Real data present and already violating | Add `NOT VALID`, then repair forward, then validate. Record the repair as its own reviewed step. Never weaken the rule to fit the data. |
| Real data present and compliant | Add the constraint directly, and say so in the migration comment. |

A defect fix is not complete when the code changes. It is complete when the guarantee is **structurally** established — a constraint or trigger that a caller cannot bypass — not merely re-checked at a call site. Where a defect is currently unreachable through any real code path, record that it is defence-in-depth rather than a live hole, so a later reader can triage it correctly.

Where a finding is genuinely uncertain, it stays in the register as *observed but not yet a defect* with the question an owner must answer. It does not become a task, and it is not changed blind.

## Alternatives

| Alternative | Reason for this decision |
| --- | --- |
| Edit the baseline in place | Makes a reviewed artifact a record of unreviewed work, and invalidates the integrity hash. The clean baseline is the point of ADR 0010. |
| Fix defects and add scope in one pass | Conflates "wrong now" with "not built". The two have different owners, different urgency and different acceptance, and merging them makes both harder to schedule honestly. |
| Treat every finding as a backlog packet | Buries the severe items among ~130 forward packets. A balance guarantee that can be bypassed is not the same kind of thing as a missing Peppol adapter. |
| Defer all defects until the parity backlog lands | Leaves two live defects in shipped code while sequencing 130 new packets behind them. The register is cheap to keep current and expensive to ignore. |
| Add a fourth baseline file to hold the fixes | Still a baseline, still needs review as a unit, and re-opens the question the clean three-file decision closed. |
| Fix a defect by loosening the rule | A rule weakened to fit current data is not a fix, and the data is the thing most likely to be wrong. |

## Consequences

- The reviewed baseline stays exactly what was reviewed, and the integrity artifact keeps meaning what it says.
- Every defect fix is separately reviewable and separately reversible, which a baseline edit is not.
- The three-population table makes a data-dependent migration decision explicit before any migration is written, instead of discovering it against real rows.
- The register needs discipline, because a stale defect row is worse than none: it implies a live risk that may be fixed, or a fixed risk that may be reopened. Each row therefore cites the current evidence line, so a reader can tell a present fact from a proposal.
- Two of the register's rows contradict our own written requirements rather than the code. Those are the ones most worth fixing first, because a documented requirement and its implementation currently disagree and only one of them can be right.
- An unverified finding is labelled, not actioned. The comparison is a planning input; the evidence line is the fact.

## Implementation and proof

This decision places work; it performs none. Proof that it was followed is that the three baseline files are unchanged at the revision where this decision was taken, that every register row citing a baseline line has a corresponding forward migration, and that `python3 docs/plans/check-plan.py` still passes. Proof that any individual defect is fixed is that defect's own acceptance, which is out of scope here.
