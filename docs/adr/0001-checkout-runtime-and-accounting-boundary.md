# ADR 0001: application runtime and ownership

Status: established repository baseline. Accounting delivery and its remaining proof gates are specified in [ADR 0004](0004-complete-accounting-delivery-contract.md).

## Context and decision

[AGENTS.md](../../AGENTS.md), the [root manifest](../../package.json) and source establish Effect `4.0.0-rc.112`, Bun, Vite+, TanStack Start/Query, StyleX, Paraglide and Alchemy. The backend owner is `apps/api`; transport schemas belong to `packages/contracts`; product UI and reusable primitives remain separate.

Preserve request-scoped QueryClient construction and the web-to-API service binding. Backend workflows use Effect and run at the Worker boundary. Keep the pinned Effect major consistent across adapters; a framework upgrade requires its own compatibility work.

## Alternatives and consequences

A framework replacement would discard working infrastructure without advancing the accounting requirements. Retain the current modules and extract a package only when another real consumer needs it. PostgreSQL remains behind the API boundary; the UI Worker has no database credentials.

Bun runs local commands and maintenance tasks; workerd runs the deployed API. Each supported runtime needs its own transaction and resource-lifetime evidence. A successful local command cannot establish Worker compatibility.

## Evidence and remaining gates

The [architecture](../architecture.md) describes current ownership. The [roadmap](../roadmap.md) records historical static checks and bounded runtime observations. Trusted production identity and fixed-revision runtime proof remain D-01/D-02 in [open decisions](../open-decisions.md); source presence does not close those gates.
