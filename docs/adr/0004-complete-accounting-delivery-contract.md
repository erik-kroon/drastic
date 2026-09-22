# ADR 0004: complete accounting delivery contract

Status: working decision, 2026-09-22. This records the selected implementation plan; it does not certify existing code, company applicability or production readiness. It amends only the monetary wire representation in [ADR 0002](0002-exact-posting-and-approval.md) and makes its ownership/recovery boundaries concrete.

## Context

The seven delivery areas need executable scope beyond the original posting design. The source has also advanced: the baseline recorded in the [plan](../plans/README.md) includes a synthetic accounting kernel and further recovery, correction, register and closing work. Starting over from the old starter description would discard useful contracts and conceal compatibility obligations. The [acceptance plan](../plans/09-acceptance.md) records the failure cases that every affected workflow must withstand.

## Decision

Adopt the [shared contracts](../plans/00-shared-contracts.md), seven domain plans and [dependency-ordered delivery](../plans/08-delivery.md) as the working delivery specification. Keep the high-level requirements/invariants and scenario identifiers stable. Each packet must reconcile current implementation and demonstrate its own acceptance criteria before being called complete.

Retain the existing paired `debitMinor` and `creditMinor` canonical integer strings: each line has exactly one positive side, each amount has at most 38 digits, and its currency/scale is explicit in the scoped plan. SQL and admission reject malformed/fractional values before coercion. Signed aggregate values have a separate bound/codec and must not be cast to JavaScript number. Source quantities/rates use exact decimal/rational arithmetic and named rounding boundaries. This changes representation only; exact balance and immutable posting invariants remain.

Keep `openerp-c14n-v1` interpretation for existing sealed records. Establish independent canonicalization vectors and admission checks before relying on new plans across runtimes. A required algorithm change receives a new version; no migration silently rehashes approved economic content.

FND-01 reconciliation retains the implemented credential/executor-membership shared-lock prefix before the book barrier. Authority revocation remains an authority-only transaction with no book/configuration writes; new bulk authority operations need a complete lock analysis. This replaces the original plan's book-first membership-update assumption, which would reverse the order in migration 0210. It also preserves `ApprovalRequired` as HTTP 403 and the existing CamelCase error family. The [reconciliation record](../plans/fnd01-reconciliation.md) separates observed source from remaining proof.

Effect owns request context, scoped resources, preparation/calculation and typed orchestration. Named PostgreSQL transitions own short transactions, locks, final monetary/scope validation, authority/dependency checks, financial/register effects, receipt and outbox. Preserve small deterministic SQL preparation already present; do not duplicate growing tax/payroll calculators in SQL and TypeScript. All mutation paths obey the shared book barrier and lock order. Durable jobs persist admission, progress and fenced claims; fibers and provider calls cannot supply financial atomicity.

Retain content bytes separately from source occurrences and economic identity. Imports preserve provenance, duplicates that are legitimate events, historical relationships and unknown facts. Bank matching and invoice settlement have distinct capacities and effects. Financial close requires the reviewed inventory of applicable controls; a technical close certificate alone cannot assert statutory readiness.

Select OIDC authorization-code/PKCE admission with server-controlled sessions for production human access and separately scoped agent credentials. The actual identity provider, memberships and deployment arrangement remain D-01 inputs. Existing synthetic operator identity cannot satisfy the production gate. Preserve existing routes, capability IDs and sealed-record compatibility; add owned operation families through the shared contracts.

Select a rehearsed offline cutover for the first company: freeze and physically fence the old writer/egress, reconcile the final delta, restore and prove the target, then establish new authority outside the restored backup and enable one writer. A restored database flag alone cannot fence the old environment. Recovery after acknowledged native effects requires a reconciled delta or correction; it cannot erase those effects by reverting to an older backup.

## Alternatives and consequences

| Alternative                                                                   | Decision and consequence                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replace paired money fields with side plus value                              | Both can enforce one-sided lines. Retain the implemented paired shape to avoid unnecessary contract/digest churn; enforce exactly one positive side explicitly.              |
| Put all policy in SQL, or trust arbitrary application-generated ledger writes | Keep domain preparation in its owning module and independent final SQL invariants. New calculation families need one policy owner and a narrow admissible transition.        |
| Build a generic financial effect language and workflow platform first         | Use named domain operations and existing adapters. Shared identity/receipt mechanisms are reused without turning every business rule into an interpreter.                    |
| Deduplicate economic events by byte hash or equal amount/date/text            | Content hashes identify bytes. Scoped source occurrence and reviewed economic links preserve equal legitimate events and avoid double recognition.                           |
| Treat all domain modules as prerequisites for every development step          | Engineering dependencies stay acyclic. Company release gates separately require every applicable treatment and obligation; missing applicability is a blocker.               |
| Online dual writing or promotion controlled only by restored state            | First release uses enforced offline fencing and independently recorded authority. This accepts downtime to simplify the proof of one writer.                                 |
| Fully autonomous first-company operation                                      | Retain explicit reviewed plans, distinct approval/payment/signature powers and honest unknown outcomes. Later mandates need bounded scope and their own acceptance evidence. |

The plan is detailed enough to sequence engineering without guessing company facts. Actual rules, provider contracts, source inventory, recovery objectives and test-change authority are finite inputs specified in [external inputs](../plans/10-external-inputs.md). Unknown values require evidence from the responsible owner.

## Compatibility and proof

FND-01 inventories actual callers, schemas, grants, digest versions and applied migrations before changing implementation. Applied migrations remain immutable; populated upgrades preserve approved plans, source identities and receipts. Add versioned contracts only where semantics actually change.

The [acceptance plan](../plans/09-acceptance.md) connects all seven areas to R-01–R-12, I-01–I-12 and E-01–E-21, with concrete fault cases and required repeatable artifacts. Document integrity checks prove that the plan is internally linked and dependency-consistent; they do not prove runtime or legal correctness. Existing evidence is reusable only for the exact revision, environment and assertions it establishes.
