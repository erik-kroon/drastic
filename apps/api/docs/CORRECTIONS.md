# Atomic corrections

## Current ownership

Application operations live in [application/posting-corrections.ts](../src/application/posting-corrections.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

### Current workbench layer

The new0410 source adds snapshot-bound impact review, chain/discovery and request recovery. See [CORRECTIONS-WORKBENCH.md](CORRECTIONS-WORKBENCH.md) for acceptance cases and supported/blocked behavior, and [CORRECTIONS-HANDOFF.md](CORRECTIONS-HANDOFF.md) for root integration. Its runtime evidence is separate from the earlier0400/0401 observation below. New bundle sealing requires a reviewed impact reference; registered downstream compensation remains unavailable rather than inferred.

### Original bundle boundary

`0400-correction-bundles.sql` adds a linked reversal **and** replacement workflow for the existing `synthetic-core-v1` manual journal profile. It depends on migrations through0211 and0300 (the posting recovery hook). It does not replace the reversal-only API.

```text
retained original voucher
  └─ immutable bundle digest
       ├─ sealed exact reversal → normal child approval → kernel execute_change
       └─ sealed replacement   → normal child approval → kernel execute_change
                           one PostgreSQL transaction
                   paired receipt + both child outbox rows
```

The original remains unchanged and included in ledger sums. A bundle has two ordinary one-voucher change sets. Their original uniqueness constraints, execution receipts, evidence validation, account checks, period checks, current operator membership checks and native-writer guard remain intact. There are no direct ledger inserts in the correction commands.

The bundle fixes the original voucher, both complete child plans, rationale, explicit date policy, creator and creation time under `openerp-c14n-v1`. Approval accepts only this digest and version. Execution accepts only this digest, version and bundle approval ID; it does not accept replacement lines. Every approval is an operator-only command and seals a pair of ordinary child approvals. Agents may prepare, read and execute an already-approved bundle; approval is not an MCP tool.

Both parts use the same explicitly selected open period and date, which cannot precede the original posting date. No date is silently moved. An original locked period is not reopened. The reversal retains the original evidence, event, accounts, order and opposite exact amounts. Replacement uses active accounts, the original evidence, its own description and new exact lines. Its economic event key derives from the original voucher (`correction:<original-id>`), not the caller's request/job ID. The explicit bundle mapping links replacement and reversal to the original without inventing a new kernel posting purpose.

This is a synthetic operational policy, not a finding that these dates or this workflow satisfy a company's statutory correction requirements. Tax recalculation, dimension changes, new replacement evidence, standalone-reversal upgrade, reopening and historic import correction are outside this version.

### Atomicity and authority

After normal credential/member admission locks, mutation commands lock the book first. Preparation/approval/execution hold shared locks on the relevant period, fiscal year and union of original/replacement accounts. Execution checks both sealed dependency sets before calling either kernel command. The kernel checks each approval and locks its operator membership through commit.

A deferred `SECURITY DEFINER` constraint trigger on `vouchers` requires both child execution receipts and their bundle receipt for every bundled child voucher. Ordinary single-change execution therefore cannot commit one half, even if an operator separately approves that child. `posting_recovery_standalone(book,id)` excludes child plans from the ordinary posting recovery flow; the old `get_change` remains inspectable.

A second-part failure rolls back the first part, both approval consumptions, numbering, sequences, command receipts and outbox entries. The wrapper catches no SQL exception. This is the implemented transaction structure, **not observed failure/recovery proof**.

All bundle history is append-only. Tables and private helpers explicitly revoke PUBLIC/runtime access. Only scoped authenticated entry functions receive runtime EXECUTE. Functions use a protected search path and prefixed PL/pgSQL locals. The original kernel functions and their existing authority locks remain unchanged.

A dependent domain may install a book-serialized `BEFORE INSERT` voucher guard to reject reversals of active linked records. Commerce is implementing this for active recognition/allocation links. Such a rejection rolls back the complete correction. This module does not rewrite commerce residuals or bypass those guards.

### Retry and recovery contract

- Same key, actor and payload returns the exact committed command result. Different content under that key conflicts.
- Execution under a fresh key returns the original paired receipt when bundle digest/version/original approval match. It does not consume another approval or recheck already-committed dependencies.
- A new bundle/job cannot duplicate either posting. Original reversal uniqueness, deterministic replacement event identity and one committed bundle receipt per original enforce the boundary.
- An original with a lone existing reversal raises `AlreadyPosted` at preparation and execution. It is an explicit conflict, never an instruction to create another reversal. This version cannot claim the old reversal and a new replacement were one atomic commit.
- GET by bundle ID returns its immutable bundle, latest live approval with both exact, unconsumed, unexpired child approvals and a current operator membership (or null) and paired receipt (or null).
- GET by original voucher ID returns its committed bundle, otherwise its latest prepared bundle. No bundle found does **not** prove the original is unreversed. Ordinary voucher history still owns reversal-only records.
- Lost prepare responses can be recovered by original voucher ID. Lost approval/execute responses can be recovered by bundle ID. The UI also retains a stable in-memory request key per exact payload and offers refresh, not blind fresh-key posting.

### Integration

Export `./corrections` from the contracts package. Add `CorrectionApi` to `Api` and `CorrectionHandlers` to the Worker layer. Spread `CorrectionCapabilities` into the common capability schema map and bind:

| Capability                | Database operation              | Parameters after token                            |
| ------------------------- | ------------------------------- | ------------------------------------------------- |
| `corrections_prepare`     | `prepareCorrectionBundle`       | scope JSON, voucherId, idempotencyKey, input JSON |
| `corrections_get`         | `getCorrectionBundle`           | scope JSON, bundleId                              |
| `corrections_for_voucher` | `getCorrectionBundleForVoucher` | scope JSON, voucherId                             |
| `corrections_execute`     | `executeCorrectionBundle`       | scope JSON, bundleId, idempotencyKey, input JSON  |

The REST-only `approveCorrectionBundle` database operation takes scope JSON, bundleId, idempotencyKey, input JSON. Operation SQL functions are the snake_case names in0400. All statements must remain fixed and parameterized.

Mount `CorrectionsPanel` from `apps/web/src/components/corrections/corrections-panel.tsx` with `{book, setup, locale}`, inside a book-keyed boundary. The panel supplies original lookup, editable replacement lines, sealing, original/reversal/replacement and evidence review, exact approval, atomic execution and receipt recovery. It uses the owned StyleX UI primitives and a domain-local English/Swedish copy module. TanStack Query owns remote state; monetary checks use BigInt, not Number.

### Evidence status and required failure work

Implementation, source review and one manual local synthetic workflow are recorded. Bounded Oxlint passed on the owned contracts, API adapter and correction UI with zero warnings/errors; Oxfmt passed on those files and this document. No tests, fixtures, migration application, server, build or database mutation were run by this domain worker. Root owns shared static validation and any authorized local development observation. Source checks do not prove PostgreSQL transaction behavior, browser layout, keyboard behavior, 200% zoom or compliance.

Root applied0400 and forward0401 locally.0401 fixes JSON operator precedence in the replacement-input guard;0400 remains immutable. The integrated REST/MCP dispatcher and workspace panel are composed. In the retained manual development artifact, an original500 posting at sequence3 was corrected by reversal500 and replacement700 at sequences4–5. Same-key and fresh-key execution returned the identical paired receipt. The final synthetic balances were bank−700 and clearing700. See [manual correction bundle receipts](../../../.agents/work/openerp-implementation/manual-correction-bundle-receipts.json). This observation covers a successful local synthetic path and receipt recovery, not browser interaction or adversarial failure proof.

Still missing real failure/recovery evidence: simultaneous approvals/executions with same and different request keys; lost responses before/after commit; crash during the second posting; expired/revoked approval; credential revocation while waiting on the book; changed account/period/profile dependencies; standalone child execution under a valid child approval; deferred-trigger failure; fiscal-year boundary corrections; conflicting existing reversal; repeated correction of a replacement; dependent-domain guard failure; cross-book IDs and history access. Approval to add tests remains absent. No production writes, deployment, provider action or authority acknowledgment is established.
