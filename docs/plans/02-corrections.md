# Corrections and immutable history

Owner: corrections domain using the kernel transaction, with each affected register owner contributing its explicit effects. Phase: P1 for journals; extended with commerce, schedules and close. The current correction-bundle contracts/migration drafts are the starting point; the implementation must prove this contract before release.

## User result

The reviewer selects an original voucher, sees its evidence and accounting meaning, chooses an explicit permitted correction date/period, and reviews the complete reversal plus replacement and resulting net effect. Both postings and their register consequences commit together. The original remains readable and remains in sums alongside its reversal. A reversal-only command stays separately named and does not claim replacement.

A ledger correction does not alter the legal/commercial invoice that produced it. A credit note, payroll correction, changed tax return or asset disposal has its own domain meaning and may create a correction bundle. The system must not silently transform a generic voucher edit into those operations.

## Correction aggregate

Retain `CorrectionBundle` with original voucher identity, immutable original snapshot/digest, explicit-open-period date policy, reason, exact reversal, exact replacement, dependencies and bundle digest. Add typed register/allocation consequences when applicable. A bundle owns its constituent proposals; standalone execution of either constituent is refused. Public callers cannot substitute lines at execution or authorize only half of the bundle.

The aggregate approval covers the bundle digest and all effects. The aggregate receipt links original, reversal/replacement receipts, changed register links, approval, commit boundary and actor. Constituent receipts support existing readers, but the parent transaction is the only admission path for bundle-owned effects. Private SQL helpers may share mechanics; no caller-controlled flag bypasses approval or immutability.

Unique constraints prevent a second independent full reversal of the same original and duplicate bundle execution. A prior standalone reversal blocks a competing bundle, even if a recovery view has no bundle receipt. Recursion is explicit: a correction to a replacement names that replacement, shows the whole chain and its cumulative net effect; it never “unconsumes” a previous approval.

## Operations and failure policy

| Operation         | Contract                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Prepare reversal  | Original + explicit target period/date + reason → exact opposite original amounts/accounts/dimensions, same event/evidence lineage. |
| Prepare bundle    | Original + intended replacement facts/lines + date policy + reason → immutable reversal/replacement and dependency manifest.        |
| Review / validate | Original, chain, net effect, source and all register consequences visible; missing downstream semantics block preparation.          |
| Approve / execute | Human-approved bundle digest + original request key → one aggregate receipt; constituent execution denied.                          |
| Recover / trace   | Bundle ID, original voucher or request key → aggregate/current state and linked history, with timed absence semantics.              |

The first policy permits an explicitly selected **open** accounting period. Never silently backdate to the original locked period or reopen it. If a supported accounting treatment requires original-period correction, use the separately approved reopen workflow, invalidate affected close/report readiness and then prepare a new bundle. Filed artifacts retain their history and receive an impact case. Legal treatment/date requirements are profile inputs, not a generic date convenience.

Inactive original accounts remain usable for an exact reversal; they are not automatically valid for new replacement recognition. The reversal copies original identities even if display names or current dimensions changed. Invalid replacement accounts, amounts, period or dependency fail before either effect is durable. A replacement identical to the original with unchanged date/treatment is rejected as no economic change.

Economic equivalence includes supported dimensions, tax facts, allocation/register identities and recognition meaning, not only account totals or debit/credit multisets. A project or tax reclassification can be meaningful while account balances stay unchanged. A dimension-only or tax-only correction remains unsupported until its complete effects and proving scenarios exist; do not hide it as a no-op or force it through a plain-journal shortcut.

## Register consequences

| Affected owner             | Required correction behavior                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invoice recognition        | Reverse/replace the recognition link and GL effect atomically; preserve issued invoice content. Require an explicit credit/reissue workflow if commercial facts change. |
| Invoice payment allocation | Reverse identified allocation legs under capacity locks; recompute residual from immutable allocations, never decrement a cached paid amount twice.                     |
| Bank matching              | Keep historical match receipt; append reversal/supersession of the relationship when its supporting line is reversed. Do not invent a new bank observation.             |
| Asset/deferral schedule    | Preserve posted occurrence identity and its reversal; remaining-plan amendments must be explicit. A lost link cannot make the occurrence appear never posted.           |
| Payroll                    | Correct against the frozen pay-run revision and its liabilities/declaration lineage; never recalculate old approved rows from current employee settings.                |
| VAT/report/close           | Append changed treatment/impact facts and stale relevant readiness; retain old snapshots and submitted bytes.                                                           |

A domain-specific original whose register consequences cannot be expressed safely is unsupported for generic correction. The UI names the owning workflow instead of attempting a partial voucher-only repair.

## Delivery packets

| ID     | Deliverable                                                                                           | Depends on             | Acceptance                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| COR-01 | Complete and integrate existing bundle prepare/review/approve/execute path and constituent isolation. | PST-03                 | E-09: invalid replacement and midpoint failure leave neither posting; exact original retained.       |
| COR-02 | Stable correction-chain identity, reversal-only conflict handling and receipt discovery.              | COR-01                 | E-04/E-05/E-09: concurrent alternatives produce one permitted correction; reload recovers aggregate. |
| COR-03 | Register-specific correction contributions and capacity reconciliation.                               | COR-02, COM-03, AST-02 | E-09/E-13: invoice, payment and schedule assertions agree with corrected GL.                         |
| COR-04 | Closed-period policy, downstream impact cases and all-channel correction workbench.                   | COR-02, END-01         | E-06/E-11/E-16: no silent reopening/backdating; old report preserved and affected readiness stale.   |

The plain-journal P1 correction gate is COR-01/COR-02 with relevant PST proofs. It does not wait for asset/payroll implementation. COR-03 extends the gate whenever those domains become supported. This distinction prevents a circular dependency while keeping register-aware correction mandatory before their release.
