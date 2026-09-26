# Accounting API notes

This directory holds feature-specific implementation notes, handoffs and feasibility reviews for `apps/api`. Start with the [API layout](../README.md) for code ownership and the [repository documentation](../../../docs/README.md) for product requirements, plans, progress and open decisions.

These notes distinguish source implementation from runtime verification. A handoff or feasibility review does not establish that a feature is complete or approved for a real company.

## Current ownership

Effect operations in [application](../src/application/) own commands and reads. HTTP and MCP use the shared [capability registry](../src/application/capabilities/); persistence uses the caller's transaction. The former SQL dispatcher and its statement modules are deleted.

All slices share three DDL owners: [schema](../migrations/0001-schema.sql), [integrity](../migrations/0002-integrity.sql) and [roles](../migrations/0003-roles.sql). Install them with the [documented migrator](../../../docs/local-development.md). The old chain is superseded, not an upgrade source.

Feature notes with a **Historical implementation notes** section preserve the earlier design, integration instructions and observed results. Migration names, SQL entrypoints and EXECUTE-only grants in those sections describe the removed implementation. Each note links to its current application owner and the baseline above. Current completion limits and verification are in the [API layout](../README.md) and [baseline evidence](../../../docs/plans/evidence/application-owned-baseline-cutover.md).
