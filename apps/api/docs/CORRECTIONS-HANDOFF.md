# Corrections workbench integration handoff

## Current ownership

Application operations live in [application/posting-corrections.ts](../src/application/posting-corrections.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

### Released source

- `packages/contracts/src/corrections.ts`: additive chain, snapshot, discovery and request-recovery contracts/endpoints/capability definitions. `CorrectionIntent` is the old intent shape; `PrepareCorrectionBundle` adds optional `impactReview:{id,digest}` for wire compatibility.0410 requires that reference for new sealing; old exact command replays remain valid. `CorrectionBundle` adds optional impact reference so old retained bodies still decode.
- `apps/api/src/corrections.ts`: new Effect REST handlers call shared named capabilities. Existing approval remains operator-only REST.
- `apps/api/migrations/0410-correction-impact-workbench.sql`: immutable review table; connected chain and exact totals; snapshot/guards/discovery/request recovery; forward replacements of correction prepare/check and reversal-only preparation. Earlier migrations untouched.
- `apps/web/src/components/corrections/{corrections-panel,correction-review,impact-review,discovery}.tsx` and `copy.ts`: exact impact→review→seal flow, affected-resource links, chain drilldown/net sums, bundle pages and request recovery, English/Swedish copy.
- `apps/api/docs/CORRECTIONS-WORKBENCH.md`: risks/acceptance cases written before transition changes; implementation boundaries and evidence.

### Prerequisites and shared root changes

Use the current Drizzle Effect `query` dispatcher and Better Auth accounting credential boundary. No new connection or auth adapter is needed. The current `CorrectionApi`/`CorrectionHandlers` and spread `CorrectionCapabilities` composition remain; the spread picks up new contract definitions. Add these bindings to `apps/api/src/capabilities.ts` and operations to `apps/api/src/database.ts`:

| Capability                    | Dispatcher operation       | SQL function signature                                          | Parameters after token                                                                            |
| ----------------------------- | -------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `corrections_review_impact`   | `prepareCorrectionImpact`  | `openerp.prepare_correction_impact(text,jsonb,text,text,jsonb)` | `scopeParameter(input.scope), input.voucherId, input.idempotencyKey, JSON.stringify(input.input)` |
| `corrections_get_impact`      | `getCorrectionImpact`      | `openerp.get_correction_impact(text,jsonb,text)`                | `scopeParameter(input.scope), input.impactId`                                                     |
| `corrections_chain`           | `getCorrectionChain`       | `openerp.get_correction_chain(text,jsonb,text)`                 | `scopeParameter(input.scope), input.voucherId`                                                    |
| `corrections_list`            | `listCorrectionBundles`    | `openerp.list_correction_bundles(text,jsonb,text)`              | `scopeParameter(input.scope), input.after ?? ""`                                                  |
| `corrections_recover_request` | `recoverCorrectionRequest` | `openerp.recover_correction_request(text,jsonb,text)`           | `scopeParameter(input.scope), input.key`                                                          |

Use fixed Drizzle `sql` tagged statements with the listed casts and `as result`, matching existing dispatcher style. Do not interpolate function names or change the restricted runtime role.

Optional mapping for the shared Drizzle table inventory: `correction_impact_reviews(book_id text,id text,voucher_id text,body jsonb)`, composite PK(book_id,id), FK(book_id,voucher_id)→vouchers. The application only calls approved functions; no direct runtime writes are granted.

New REST paths under `/api/v1/entities/:entityId/books/:bookId`:

- POST `/vouchers/:id/correction-impact-reviews` with `CorrectionIntent` and stable Idempotency-Key.
- GET `/correction-impact-reviews/:id` → immutable impact plus `snapshotCurrent`, always `executable:false`.
- GET `/vouchers/:id/correction-chain` → complete bounded connected history and totals.
- GET `/correction-bundles?after=<id>` → stable25-item identifier cursor page.
- GET `/correction-requests/:key` → own-actor recorded result or timed `not_recorded_at_check`.

Existing workspace mount needs no change. Existing book-keyed `CorrectionsPanel` now includes all new screens. No package export, error vocabulary, route, shared copy or new dependency is required.

0410 consumes stable schema from0400/0401,0500,0600,0700 and0800, and the existing0900 authorization boundary. It is forward-only. The migration runner must consider these prerequisites; do not expose0410 functions to traffic before all prerequisite domain migrations exist. No dependency on concurrently drafted0510/0610/0710/0810+ semantics is assumed.

### What is implemented, unavailable and unverified

Implemented: one immutable impact snapshot binds exact original, replacement lines/date/rationale, connected committed chain, represented relationships, configuration and ledger sequence. New bundle digest binds the review ID/digest; sealing, approval and execution compare its current basis. Snapshot-current explicitly is not executability. Reordered, description-only or split lines with identical per-account economic balances and unchanged date/period are rejected. Standalone reversals remain visible and conflict with a new bundle. Old committed receipts replay before new live checks; old unposted bundles are subject to live unsupported-register/no-op guards.

Bank matches/applied allocations, invoice recognition/applied payment capacity and represented schedule events block generic reversal before a new proposal seals. A protected voucher trigger also covers old proposals and reversal-only execution. No other domain record is changed. Prepared allocation plans are linked as needing revalidation; they are not described as consumed capacity. Reports covering the target date and technical certificates are linked with retained-history/stale-basis consequences, not mutated or reopened. Actual statutory filing, tax/payroll consequences and company completeness remain unknown and explicitly unavailable.

Conservative limitation: any book ledger/configuration change or changed represented impact invalidates a snapshot. Earlier/current register relationships remain blocked even if another owner's future compensation release exists, until that owner supplies an explicit stable integration. This module does not guess release semantics or become a compensation authority. Maximum chain200 vouchers/resources1000 is fail-closed with no partial totals.

Not verified: new0410 runtime, PostgreSQL concurrency/rollback/crash paths, browser interaction/zoom/accessibility, real-company use, legal policy, deployment or authority acceptance. Previous0400/0401 synthetic observation is historical evidence for the earlier bundle, not proof of this package. No tests, fixtures, migrations, DB writes, server/build/repo checks, dependencies or Git operations were performed by this worker.

### Owned-file checks

`bun x --no-install oxlint packages/contracts/src/corrections.ts apps/api/src/corrections.ts apps/web/src/components/corrections/*.ts*` passed with zero warnings/errors. Oxfmt passed on those source files and the three domain documents. This is bounded source validation only; dispatcher integration and native type/runtime checks remain with root.

### Next root action

Integrate the five dispatcher/capability mappings, inspect/apply0410 only in the authorized local environment, then serialize native type/lint/build validation and permitted manual observation. Suggested manual review (not an added test): plain changed-amount journal snapshot→seal→approve→execute→same/new-key recovery; stale snapshot after an intervening represented link; no-op, already-reversed, locked-target, matched-bank, commerce and schedule blocks; chain net totals and loss/reload discovery. Report exactly what ran; leave missing adversarial/browser/legal evidence open.
