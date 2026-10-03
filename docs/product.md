# Product scope

Status: working product requirements. Company facts and applicable obligations remain open in [D-04](open-decisions.md).

OpenERP should turn retained evidence into explicit accounting decisions, approved financial changes, reconciled books and reproducible outputs. The first useful product milestone is a complete, reconciled period using the company's existing matched material. A synthetic kernel demonstration is a prerequisite to that milestone.

The initial candidate profile is one Swedish AB. Its actual legal form, accounting method, financial year, registrations, reporting framework and obligations must be established from records ([D-04](open-decisions.md)). “Swedish AB,” “K2,” calendar-year accounting and payroll are not defaults to invent.

## Adopted commercial priority — 2026-10-03

[ADR 0017](adr/0017-bureau-first-product-focus.md) adopts a bureau-first wedge: incoming documents, bank matching, invoicing and VAT. Accountants own bookkeeping within assigned authority; owners answer questions and approve payments. Keep owner-operated Book Zero available. Att göra owns all human tasks; other work views are filtered projections.

Use bounded bulk approval for familiar supported work, individual review for exceptions, and exact-action approval for payments, messages and filings. Financial approval and receipts remain immutable; automatic posting is not adopted. Live bank feeds, Peppol, direct VAT filing and BankID are target capabilities after their own qualification gates, with manual/file fallbacks retained.

Native payroll is deferred from the commercial wedge in favor of evaluating a specialist integration. Quotes/orders, incoming orders, recurring-billing and currency extensions, ROT/RUT, advanced assets/dimensions and Cash follow the core loop. Required import, corrections, reconciliation, reporting and closing remain in scope. Actual unsupported company transactions block their dependent release until a qualified treatment or handoff exists. Adopt visible assistant explanations, a bank-to-document-to-review onboarding/demo loop and the [success measures](plans/product-focus-review.md#success-measures). Choose a qualified replacement for the provisional public name before launch.

## Book Zero product priority

The [Book Zero plan](plans/15-book-zero-workflow-cash.md) organizes the first delivery around Drastic AB: independently review a real historical period, finish routine work through the ordinary interface, with read-only Drastic Cash sequenced later under ADR 0017. Extend acceptance to the first financial year, a new real period and a separately approved single-writer transition. Work belongs in the first delivery when the actual company or the core accounting journey needs it; Cash coverage requirements govern the later Cash slice.

The source reports SEB and a first financial year of 2025-05-17–2026-04-30; these remain [company inputs to qualify](open-decisions.md#book-zero-company-and-review-inputs). Reconstruction from raw evidence and migration of old accounting are separate trials. A successful migration cannot by itself prove new accounting treatment.

Cash uses qualified opening observations and remaining payment obligations to show daily balances, the minimum and its date, and headroom after an explicit buffer. It supports 30 days, 90 days and 13 weeks (91 days), with frozen scenarios, contribution drilldown and visible missing/stale data. It neither owns ledger balances nor initiates payments. It is separate from NEXT-45's historical cash-flow statement.

Lending, factoring, cards, credit decisions and the broader financial platform are outside this first delivery. Native annual filing is not required to accept the first period, but full P6/P7 requirements stay open and any external year-end handoff must work in practice. The source's L/G identifiers organize delivery and evidence without replacing R-01–R-12 or existing packet counts.

## Users and outcomes

| User                | Outcome                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Owner or bookkeeper | See missing evidence and exceptions, review exact effects, approve a bounded change, and verify what was posted.                     |
| Accounting agent    | Obtain scoped facts and available actions, prepare deterministic changes, request human authority, and resume from durable receipts. |
| Reviewer            | Trace a report amount through its calculation and ledger entries to decisions and original evidence.                                 |
| Operator            | Restore books, evidence and receipts together; establish which system is the active writer.                                          |

The [customer frontend plan](frontend.md) turns these outcomes into starting views for founders, in-house finance and accountants working across clients. [ADR 0006](adr/0006-customer-workspaces.md) selects one application with shared records and different entry hierarchy/density. Audience preferences confer no accounting authority; firm membership and assignments require their owning contracts.

## Requirements

These requirements define the target; implementation and acceptance are recorded separately. The identifiers connect implementation slices to [verification](verification.md).

| ID   | Required outcome                                                                                     | Principal evidence                                                                |
| ---- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| R-01 | One authoritative ledger per statutory book; every operation has trusted entity/book scope.          | Cross-scope rejection and single-writer checks.                                   |
| R-02 | Preserve source bytes, source identities, historical decisions and existing receipt/payment matches. | Import manifest, multiplicity and relationship comparison.                        |
| R-03 | Separate observation, economic event, recognition and settlement.                                    | An invoice and its payments recognize cost once; allocations conserve amounts.    |
| R-04 | Calculate amounts exactly with explicit date and rounding semantics.                                 | Independent expected amounts; invalid precision rejected before storage coercion. |
| R-05 | Approve immutable effects; reject changed dependencies and unauthorized execution.                   | Approval, staleness and permission scenarios through the public boundary.         |
| R-06 | Commit once, recover after interruption, and correct without changing posted history.                | Concurrent retries, lost responses, correction and outbox checks.                 |
| R-07 | Reconcile both item coverage and balances against independent evidence.                              | Offsetting omissions remain visible; unexplained differences block readiness.     |
| R-08 | Produce reproducible reports with line-level provenance and honest filing states.                    | Snapshot reconstruction, drilldown and actual submission receipts.                |
| R-09 | Use shared operations for human UI, REST, MCP and durable jobs.                                      | Equivalent results and authority rules through each supported adapter.            |
| R-10 | Accumulate reviewed rules and decisions; unsupported treatments remain blockers.                     | Rule version, positive/negative cases and activation authority.                   |
| R-11 | Retain the existing stack, UI components, localization and accessibility practices.                  | Repository checks and actual keyboard/narrow-width/zoom observations.             |
| R-12 | Support portable runtime composition and complete recovery without a second ledger.                  | Worker/Bun transaction proof and database-plus-object restore.                    |

## Delivery boundaries

First deliver the accounting core and a real-period workflow. Reconciliation and reporting cannot be replaced by a dashboard that merely shows imported totals. Required payroll, VAT or other transaction families become dependencies of the company's readiness even if they appear later in the generic roadmap.

Hosted multi-entity operation and self-hosting are target design directions. Preserve entity/book scope and runtime boundaries now; defer billing, enterprise administration, broad international onboarding and unrelated ERP modules. Additional modules must use the same accounting authority and shared operation contracts.

Local development uses explicitly synthetic records until actual data and its permitted use are supplied. No company import, production posting, deployment, cutover, payment, filing or provider purchase is implied by this documentation task.

The [supplemental capability backlog](plans/capability-backlog.md) adds collections, quotes/orders, catalog and webshop intake, dimensions, mileage claims and a bounded extension lifecycle to the planned product scope. These reuse the accounting core; general CRM, inventory/warehouse management and a plugin marketplace remain excluded.

## Three separate completion claims

**Software:** a named capability works in a named environment under specified scenarios. **Company books:** the actual profile and sources are covered and the selected period is reconciled. **External obligations:** the required artifact, signature and acceptance evidence exist. None implies the other two.
