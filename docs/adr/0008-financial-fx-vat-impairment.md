# ADR 0008: financial FX, VAT reclassification and asset impairment

Status: adopted working design following the user's confirmation on 2026-09-24. Implementation, runtime verification, company applicability and external acceptance remain separate and open. [ADR 0010](0010-application-owned-accounting-replacement.md) supersedes the implementation/compatibility ownership while retaining the FX, VAT and impairment financial requirements. Adoption authorizes this planning update; it does not execute financial actions or activate legal profiles.

## Context and authority

The [supplied proposal](../plans/evidence/financial-contract-proposal.md) provides the detailed equations, compatibility requirements, examples and acceptance scenarios adopted here. Its historical “proposed” status and pinned-source observations are retained as provenance; this ADR records adoption. Sections 3–6 define the selected technical contract, subject to the boundaries below. Its embedded handoff instructions do not independently authorize implementation, tests or external actions.

The current source reconciliation confirmed the employee foundation in migration 9050, the `legal_ar_recognition` purpose, and migration 4500's refusal of supported actual-company VAT totals. Migration 4500 also retains `bookSequence` in the VAT basis. These are source observations, not assembled-database or runtime proof. Reconcile later replacements before implementation. The proposal's legal-source observations have not been independently revalidated in this adoption task; D-04/D-08 still govern profile applicability and qualification.

## Shared decision

Keep commerce/subledger ownership, Effect preparation and the application-owned transaction. Preserve exact monetary wire fields, bounds and sealed financial meaning. The clean replacement has no old-canonicalization interpreter or old-schema compatibility path; historical records and evidence remain intact as history. Application operations calculate, authorize and write the complete group through one transaction. PostgreSQL independently enforces essential scope, conservation, immutability and atomicity constraints without duplicating the full calculator. Introduce explicitly versioned semantics and never rewrite historical financial meaning.

Approve exact financial and register consequences together. Under the established authorization/book lock order, recover a successful identical request before applying new-work freshness checks; revoked access still refuses recovery. Commit journal, register consequences and receipt atomically. Generic journal/reversal paths cannot execute half of an owned operation. Evidence reuse is not a universal exclusive-capacity rule; enforce incompatible economic roles at their specific owners in both admission directions.

## FX: commerce owns paired balances

Adopt a versioned commerce monetary item with original currency/scale/units, book currency/scale/carrying amount, source obligation revision, recognition control line, rate evidence and policy/profile versions. Recognition, settlement, credits/corrections and remeasurement effects determine balances; no independently writable FX register competes with commerce allocation capacity. Existing `synthetic_invoice_v1` remains book-currency data. Mixed reads require a discriminated amount model.

For positive remaining original units `Q`, current book carrying value `B`, and consumed units `q` with `0 < q <= Q`, release `b = B` for final settlement; otherwise use exact nonnegative half-up rounding of `B*q/Q`. Record inputs and residual. Sequential legs consume the updated capacities within one serialized operation. Zero carrying release is a register fact, not a zero-valued journal line.

With gross book-currency consideration `K`, receivable gain is `K-b`; payable gain is `b-K`. Negative gains are losses. Evidenced fees are separate effects and never consume foreign principal. Actual consideration is not replaced by a reference rate. Recognition, settlement and reporting rates have distinct provenance; missing rates refuse rather than default or invert silently. Later withdrawal prevents new rate use without rewriting historical carrying amounts.

Adopt incremental remeasurement: target value `T` changes carrying by `T-B`, without automatic next-period reversal. Future settlement uses updated carrying. Preserve realized/unrealized attribution, uniqueness by economic operation and cutoff, and stale-input refusal. Backdating across an effective valuation cutoff requires a correction path or refusal.

First slice: synthetic customer receivable recognition and full settlement into book-currency cash, without fees, including receipt recovery, register control and a latest-unconsumed settlement correction. Then payables, partial settlement/fees and remeasurement. Foreign cash, hedges, netting and later-consumed correction chains remain explicit unsupported cases until implemented. No-journal unallocation cannot undo an FX settlement.

Rejected: a second authoritative FX balance, reinterpreting old invoice amounts, original-rate rounding for every settlement, hidden fee netting, and automatic valuation reversal as the initial policy.

## VAT: reclassification, assessment and cash are distinct

Own one obligation by legal entity/book, VAT registration, jurisdiction/scheme and reporting interval. Synthetic registration has a synthetic namespace. Draft IDs are versions attached to this identity, never new obligations. Retain exact accounting net, reported net and assessed amount separately.

Adopt `vat_control_reclassification_v1`. For the narrow synthetic subset only, `O = box10.exactMinor`, `D = box48.exactMinor`, `N = box49.exactMinor = O-D`. This is not a complete Swedish return formula. Select the period's evidenced contributing control lines, not whole live account balances. If their debit-minus-credit balances are `b_i`, reverse each with `-b_i` and post settlement control `sum(b_i) = -N`. Positive net produces a credit liability; negative net a debit receivable. Zero net clears nonzero controls without a zero settlement line; entirely zero effects receive an explicit no-effect receipt.

An evidenced assessment amount `A` posts settlement control `+A` and tax-account control `-A` in debit-minus-credit terms. Require reviewed assessment identity and period relationship. Reuse an existing owned tax-account match rather than reserve its capacity again. Imported journals need explicit reviewed role adoption; equal amounts or a generic tax-charge classification are insufficient.

Cash transfer remains separate and proves neither assessment nor filing. Amendments post the target less effective previously applied effects of the same obligation, never the full replacement again. Unsupported differences between exact, reported and assessed values refuse; no blanket rounding plug is selected.

Validate approved input under the book lock before execution. Its receipt remains historical proof after the operation advances book sequence. Preserve legacy snapshot interpretation and global-sequence checks. New versions separate taxable-source dependencies, accounting controls and settlement history; withdrawals, corrections, unexplained control movements and new taxable facts still invalidate or block relevant work. Exclude owned reclassification from taxable activity through symmetric admission guards, not naming convention or mere shared evidence.

First slice must actually post a reclassification with obligation identity, duplicate prevention, recovery and controls. Assessment, amendment and real-profile paths remain separately tracked. Actual-company VAT requires implemented and qualified calculation/profile behavior; removing synthetic restrictions or filling company metadata is insufficient.

Rejected: draft-ID obligations, equal-amount matching as economic identity, cash deposits as filing/assessment proof, clearing whole multi-period account balances, and rewriting old bases to hide self-induced staleness.

## Impairment: distinct contra role and atomic future schedule

Select separate reviewed impairment-loss and accumulated-impairment accounts for the first appropriate depreciable-asset profile: debit loss, credit impairment contra. Preserve gross cost and imported ordinary recognition; prior imported impairment needs separate evidence. Other asset classes and combined-contra profiles are outside this first slice.

Let `G` be gross basis, `O` imported ordinary recognition, `C=G-O`, `R` subsequent effective ordinary recognition, `I` effective net impairment, `F` future ordinary installments and `S` residual. Carrying is `C-R-I`; enforce `R+I+F+S=C`.

Commit the journal, owned impairment event and complete approved future schedule revision together. Require positive post-impairment carrying, at least one positive future installment and nonnegative residual in the bounded initial profile. Useful life, residual and suffix are reviewed inputs, not inferred from impairment. Posted occurrences stay immutable and superseded unposted plans become stale.

Update schedule reads, estimates, occurrence eligibility, account controls, closing, correction impacts and disposal together. Controls separately reconcile gross `G`, ordinary accumulated `O+R` and impairment `I` at consistent accounting/recorded cutoffs. Retained old reports never acquire today's impairment.

For `G=1000`, `O=100`, `R=200`, `I=100`, `S=50`, carrying is `600` and future installments sum to `550`. Subsequent no-proceeds disposal debits ordinary accumulated `300`, impairment `100` and disposal loss `600`, and credits gross basis `1000`.

Repeated impairments require new reviewed economic decisions bound to current carrying/schedule, each strictly below current carrying in this profile. Immediate error correction is atomic and allowed only without later dependent recognition, estimate, impairment, disposal or closed-period consumption; it installs a valid new suffix. Consumed-history corrections refuse until their complete consequences are supported. Later economic reversal is a separate evidenced operation with a qualified carrying cap, not a generic journal reversal. Its legal profile and tax treatment remain separately qualified; never claim full impairment lifecycle support from the bounded slice.

Rejected: reducing original cost, hiding impairment in ordinary depreciation, posting first while leaving the old schedule executable, and treating impairment as terminal disposal.

## Delivery and acceptance

The [financial-contract delivery section](../plans/05-vat-payroll-assets-fx.md#adopted-financial-contract-delivery) names owners, stages and observable exits. Detailed scenarios in the retained proposal are acceptance requirements, not executed tests or permission to add tests. Preserve five statuses per slice: design adoption, implementation, runtime proof, company applicability and external outcome.

D-01–D-10 retain their relevant gates. Seek actual provider specifications and sandbox access early; invented interfaces and local fakes cannot establish external behavior. Company readiness requires implemented behavior, qualified rules, established facts, processed real material and independent reconciliation. This ADR requires no Rust extraction, second ledger or new service boundary.
