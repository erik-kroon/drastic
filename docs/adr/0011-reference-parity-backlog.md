# 0011 — reference parity backlog and rule adoption

Status: accepted planning decision, 2026-09-26. It governs planning scope and classification only. No rule, rate, provider, schema or legal profile is activated, and no implementation or verification status is claimed.

## Context

A working accounting product accumulates requirements faster than it implements them, and the requirements arrive from three directions: user requests, primary-source research, and comparison against a working reference implementation. The third direction is the least disciplined.

`docs/plans/capability-backlog.md` reconciles a capability-level comparison, which is the right level for deciding *whether* a capability is owned. It cannot answer the questions an implementer actually has. Which reference folder does this requirement come from? What is the smallest honest unit of work? Is the internal logic worth keeping, and if so, is the logic an algorithm or a number someone typed?

The reference implementation under comparison encodes Swedish statutory constants directly beside the algorithms that consume them — contribution rates, tax table shapes, reporting boxes, deadline dates, per-diem amounts, benefit values. Those constants were correct for one company in one year. Two failure modes follow if they are treated as portable:

- A rate or a table is copied and shipped as though it were authority. The product then states a legal position it cannot evidence, and it is wrong the moment the year changes.
- The reusable half is thrown away with the unreusable half, because the whole file looks like "someone else's tax code" and is rewritten from scratch.

A third pressure pulls the other way. The reference is a mature working system, and its hardest-won behaviour is usually encoded as a **refusal**: an unreadable reference returns null, a missing rate is no rate, an override is bound to what was detected at that moment. Those refusals are the most valuable content in the file and the easiest to lose, because a port that "simplifies" a null return into a best guess converts a safe refusal into a silent accounting error that is written once and cannot be corrected in place.

Separately, the mandated delivery index is a reviewed artifact: 53 packets, a validated dependency DAG, a delivery order, and an acceptance denominator. Folding a large comparison inventory into that index would change the denominator of every completion claim in the roadmap and the acceptance document, on the strength of a planning input that no implementation or proof backs.

## Decision

Record reference-parity findings as **supplemental** work, outside the mandated index, in [the parity backlog](../plans/11-parity-backlog.md) under a distinct `PRY-nn` namespace. Neither namespace is renumbered to merge them. Where a parity packet must complete a mandated packet, the mandated packet is named as a prerequisite; where a parity packet is a prerequisite **of** a mandated packet, that is recorded as a blocking note on the mandated packet. The mandated index keeps its count, its edges and its denominator, and the backlog states explicitly that it is not part of the completion denominator.

Require every adopted rule to be classified before implementation, in one of three classes:

| Class | Adopt |
| --- | --- |
| **A — Adopt** | Deterministic algorithms with no external authority: check-digit arithmetic, subset search, reference parsing, tolerance ordering, aggregation order, severity and refusal behaviour. |
| **B — Structure only** | The shape of a rule whose numbers, tables, dates and thresholds are dated external facts. Reference constants become test fixtures. |
| **C — Re-derive** | Legal judgements, eligibility tests and applicability decisions. The reference's outcome is evidence that a question exists, never the answer. |

A packet mixing classes is split before implementation, or names its class-B/C parameter set explicitly in its deliverable.

Preserve the reference's refusals as first-class requirements. An unreadable input returns null; a missing rate is no rate; an override is bound to the state detected now; a bypass is written to immutable handling history. Ported money rules use the exact minor-unit model, never floating point, because a float port of a whole-krona rule is a defect rather than a simplification.

Adopt the reference's **algorithms** and reject its **money representation**. The target's exact minor-unit arithmetic, rational rates, retained residuals and immutable monetary units are ahead of the reference and are not up for adoption in either direction.

Do not adopt the reference's architecture, storage model, tenancy, transport or framework choice, and do not treat an existing surface there as evidence of correctness.

## Alternatives

| Alternative | Reason for this decision |
| --- | --- |
| Fold the findings into the mandated 53-packet index | Changes the completion denominator and a validated dependency DAG on the strength of a planning input. Reviewing ~85 supplemental packets as index churn would also bury the reviewable set. |
| Record findings only as prose in the capability backlog | Leaves an implementer without a work unit, a prerequisite, an owner and a class. That is the failure this backlog exists to prevent. |
| Adopt reference constants and version them later | Ships a legal position the product cannot evidence, and is wrong as soon as the period changes. Structure is reusable; numbers are not. |
| Re-derive every rule from primary sources | Correct, and required for classes B and C, but it discards class-A algorithms that have already been validated against real data. It also re-implements working, hard-won logic. |
| Reuse the reference code directly | Conflicts with the licensing posture, the storage and tenancy model, and the exact-money model. The portable value is the rule, not the file. |
| Implement the findings immediately | Comparison findings are planning inputs. They carry no implementation, company or external-acceptance status, and the repository instructions require test changes to be separately authorized. |

## Consequences

- An implementer receives, per requirement: the source folder, the smallest honest work unit, its prerequisite, its owner and its adoption class, plus the preserved logic where the logic is worth keeping.
- The distinction between "we have this requirement" and "we have a work unit for it" stays visible, and an unowned finding cannot hide inside a prose backlog.
- Classification forces the statutory question to the front. A packet cannot be closed by porting code, because class B and C parameters have no authority until a dated source is acquired and versioned.
- The preserved refusals are testable requirements rather than incidental code, which is the only reason a future port cannot quietly drop them.
- Supplemental work is not in the delivery denominator. Progress reporting must say so, or the two counts will be conflated.
- Comparison findings can go stale against a moving reference. Each packet records what is missing, and a delivered packet is replaced by what was actually built rather than deleted.

## Implementation and proof

This decision is a planning artifact. Proof of the decision is that `python3 docs/plans/check-plan.py` still passes, that the mandated index is unchanged in count, edges and denominator, and that every preserved rule in the backlog names a class and its source module. Proof of any packet is that packet's own acceptance, which is out of scope here.
