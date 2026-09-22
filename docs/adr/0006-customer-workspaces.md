# ADR 0006: Customer workspaces around shared accounting records

Status: working decision, 2026-09-22. Selected frontend direction; implementation and runtime acceptance remain separate.

## Context

OpenERP's current home selects a book and exposes many accounting sections in one workspace. The user requested a customer frontend plan for founders, in-house finance and accountants, using Accounted's frontend as the base. They selected better-layout in place of taste, alongside make-interfaces-feel-better and better-ui.

Accounted's inspected frontend contains task-based company navigation, a to-do home, structured review, account reconciliation and a firm cockpit. OpenERP already owns accounting operations and reusable UI primitives. Its immutable approvals, exact values, resource scope and durable receipts must remain the source of truth while customer composition changes.

## Decision

Build one customer application with different preferred starting views and density. Founders start at an attention-oriented Overview; in-house finance starts at To do; authorized firm users can start at Clients and enter a specific company/book. All use the same record details, evidence, revisions, approvals and receipts.

Organize company navigation around Overview, To do, Banking, Sales, Purchases, Books and Reports. Use explicit entity/book routes and validated URL state for periods and list context. Preserve unsupported capability states and the current operation/recovery contracts. Retain `/intake` as the local preview surface during migration.

Presentation preferences grant no authority. Real firm membership, assignments and shared views require backend contracts and persisted state. Production identity remains D-01. Queue summaries are read projections with declared coverage; they do not become a second financial state machine.

Use the existing StyleX tokens and owned primitives. Introduce a reusable component only when a delivered journey needs it. Deliver focused review and receipt recovery inside the new frame first, then aggregate work, move domains, and add the firm layer. The [frontend plan](../frontend.md) owns detailed layout, route, state, migration and acceptance requirements.

## Alternatives considered

| Alternative | Benefit | Reason not selected |
| --- | --- | --- |
| Continue with one page of accounting sections | Minimal routing work and all current tools remain visible | Weak entry hierarchy, limited deep linking, and too much context for a founder or repeated finance review |
| Separate founder, finance and accountant applications | Each can optimize its own initial screen | Duplicates record presentation, recovery and permission-sensitive behavior; users regularly move between these responsibilities |
| Port Accounted's frontend implementation | Broad existing screen coverage | Introduces another framework/component architecture and implies capabilities that OpenERP has not established |
| One application with shared records and different entry views | Reuses owners while adapting hierarchy and density | Selected; requires an explicit migration and authoritative aggregate reads |

## Consequences

The first frontend milestone is a complete supported journey, not a set of empty routes. Existing domain components and API consumers move incrementally; old paths remain available until their destination and recovery behavior are covered. The large workspace is removed after migration instead of becoming a permanently duplicated application.

The work-list and firm views may require contracts/API work. The frontend must show unknown coverage instead of inferring completeness. Actual Swedish-company facts, rule applicability and provider acceptance remain D-04/D-08/D-10; visual availability does not settle those gates.

## Sources and proof

The [frontend plan's design basis](../frontend.md#design-basis) links the inspected Accounted revision and the current OpenERP owners. The [operations contract](../operations.md#human-workbench) owns financial review semantics. [Frontend acceptance](../frontend.md#acceptance-and-verification) extends the presentation proof for those semantics with deep links, scoped caches, audience journeys, narrow widths, zoom, localization, both themes and recovery.

No implementation or new test authorization follows from this decision. The implementing task must establish actual behavior and retain repeatable evidence under D-09 and the repository instructions.
