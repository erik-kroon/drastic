# ADR 0003: native accounting and company migration

Status: working decision. Actual company source, history scope and cutover evidence remain open.

## Context and decision

OpenERP owns its accounting operations and PostgreSQL ledger. No live legacy accounting connection or actual company export has been established for migration. Build the native product around the existing module boundaries and shared contracts.

Treat company-data migration as a separate, explicit workflow. Select an adapter only after inspecting the actual source system, version, permitted export and retained relationships. A bridge requires a demonstrated coexistence need; it is not a prerequisite for native accounting.

## Alternatives and consequences

A speculative legacy adapter adds a second authority boundary without a known caller. Permanent dual posting creates competing books and ambiguous recovery. The first company instead uses the rehearsed offline cutover selected in [ADR 0004](0004-complete-accounting-delivery-contract.md).

Prefer complete available history with original identifiers, evidence, matches, corrections, unpaid items, schedules and filing receipts. Declare any reduced-history scope and the information it cannot reconstruct. Historical movements and an opening balance representing those movements must never both contribute to the same balance.

Before cutover, independently reconcile the final source delta and fence the old writer and provider egress. After acknowledged native effects, recovery must preserve those effects through a reconciled delta or correction. Restoring an old backup cannot erase them.

## Proof

[D-06](../open-decisions.md) owns source and history inputs. The [import plan](../plans/03-imports-matching-reconciliation.md) owns preservation and reconciliation; the [operations plan](../plans/07-restore-operations-cutover.md) owns restore and writer promotion. E-12/E-14/E-16/E-21 cover their acceptance. A synthetic import or a balanced total cannot establish actual-company migration completeness.
