# ADR 0006: Customer workspaces around shared accounting records

Status: working decision, 2026-09-22. Selected frontend direction; implementation and runtime acceptance remain separate.

## Context

OpenERP needs a customer workspace for founders, in-house finance and accountants. A single page of accounting sections provides weak entry hierarchy and makes repeated review harder. The interface needs task-based company navigation, a to-do home, structured review, account reconciliation and a firm portfolio.

OpenERP already owns accounting operations and reusable UI primitives. Its immutable approvals, exact values, resource scope and durable receipts must remain the source of truth while customer composition changes.

## Decision

Build one customer application with different preferred starting views and density. The delivered company entry point is the To do home. A founder-oriented business overview and an authorized firm Clients view remain planned; users entering a company share its record interfaces. All use the same record details, evidence, revisions, approvals and receipts.

Use grouped company navigation and a compact page frame: To do, Accounts, Invoicing, Purchases, Bookkeeping, Tax, Reports and Year-end. Expose destinations through established OpenERP operations; do not relabel a bank-only source importer as a purchase-document inbox. Use explicit entity/book routes and validated URL state for periods and list context. Preserve unsupported capability states and the current operation/recovery contracts. Retain `/intake` as the local preview surface during migration.

Presentation preferences grant no authority. Real firm membership, assignments and shared views require backend contracts and persisted state. Production identity remains D-01. Queue summaries are read projections with declared coverage; they do not become a second financial state machine.

Build screens with existing StyleX tokens and owned primitives. Keep OpenERP’s existing palette and fonts. Introduce a reusable component only when a delivered journey needs it. Deliver focused review and receipt recovery inside the new frame first, then aggregate work, move domains, and add the firm layer. The [frontend plan](../frontend.md) owns detailed layout, route, state, migration and acceptance requirements.

## Alternatives considered

| Alternative | Benefit | Reason not selected |
| --- | --- | --- |
| Continue with one page of accounting sections | Minimal routing work and all current tools remain visible | Weak entry hierarchy, limited deep linking, and too much context for a founder or repeated finance review |
| Separate founder, finance and accountant applications | Each can optimize its own initial screen | Duplicates record presentation, recovery and permission-sensitive behavior; users regularly move between these responsibilities |
| One application with shared records and different entry views | Reuses owners while adapting hierarchy and density | Selected; requires an explicit migration and authoritative aggregate reads |

## Consequences

The first frontend milestone is a complete supported journey, not a set of empty routes. Existing domain components and API consumers move incrementally; old paths remain available until their destination and recovery behavior are covered. The large workspace is removed after migration instead of becoming a permanently duplicated application.

The work-list and firm views may require contracts/API work. The frontend must show unknown coverage instead of inferring completeness. Actual Swedish-company facts, rule applicability and provider acceptance remain D-04/D-08/D-10; visual availability does not settle those gates.

## Sources and proof

The [frontend plan's design basis](../frontend.md#design-basis) defines the required surfaces and current OpenERP owners. The [operations contract](../operations.md#human-workbench) owns financial review semantics. [Frontend acceptance](../frontend.md#acceptance-and-verification) extends the presentation proof for those semantics with deep links, scoped caches, audience journeys, narrow widths, zoom, localization, both themes and recovery.

No implementation or new test authorization follows from this decision. The implementing task must establish actual behavior and retain repeatable evidence under D-09 and the repository instructions.
