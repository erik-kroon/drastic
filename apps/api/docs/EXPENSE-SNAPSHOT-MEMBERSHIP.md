#5200 expense snapshot membership — pre-code failure contract

## Current ownership

Application operations live in [application/vat/expense-tax.ts](../src/application/vat/expense-tax.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

Extend the existing expense snapshot list only.0710 list summaries have no source membership;
4500 source history has no snapshot references. Snapshot history is not capped at500.

Failure contract:

- Preserve unfiltered query/cursor/output semantics by delegating to the existing0710
  three-argument list owner. Add an explicit four-argument overload, not a replacement artifact.
- Authorize scope and confirm the exact source identity belongs to that book. Withdrawn source
  identities stay readable; current basis, assessment, readiness and providers are not called.
- Freeze the current ordinal ceiling on the first filtered request. Filtered cursors bind
  scope, source and ceiling. Unfiltered/filtered mode switches and different-source reuse fail.
- Select/materialize at most25 global snapshot rows BEFORE examining entry membership. Advance
  by the last examined ordinal, even if zero returned entries match. Empty items with next are
  not absence/completeness proof. Expose ceiling, examined-through and examined-count metadata.
- Retain exact sourceId membership from saved v1/v2 entries, including excluded/withdrawn cases.
  Project captured revision/review/withdrawal identities and saved assessment, never command,
  approval or reviewer input payloads. Preserve absent v1 withdrawal metadata versus explicit
  v2 null. Refuse unsupported/malformed/duplicate membership rather than silently omit it.
- Enforce an8MiB complete canonical UTF-8 response bound. No count/byte truncation. Preserve
  historical snapshot bytes and existing original-key mutation recovery.
- No new artifact family, financial calculation, approval, posting, legal/currentness claim,
  UI expansion, tests, runtime/SQL execution or migration application.

Inspected0710: snapshots have immutable book ordinals, body.entries, schemaVersion1 and
expense-tax-controls-v1; each entry retains source, nullable review and assessment.4500 writes
schemaVersion2/expense-tax-controls-v2 and adds nullable withdrawal per entry. The existing HTTP
list route already forwards its query object through the existing read-only capability.

### Implemented source

`5200-expense-snapshot-membership.sql` adds an explicit four-argument overload of the existing
`list_expense_tax_snapshots` owner. No-source requests delegate to the unchanged0710
three-argument function, preserving its summaries, fixed-ceiling cursor and output fields.
Both branches enforce the complete response byte limit. No existing migration was edited.

The existing GET `/expense-tax/snapshots` and read-only `expense_tax_list_snapshots` capability
accept optional `sourceId`. This is the stable retained source identity, not an evidence ID,
revision ID, voucher ID or amount match. Current scope is authorized and the source must exist
in that book. Permanent withdrawal does not remove the source or hide its historical membership.

#### Bounded continuation

The first filtered request captures the book's maximum retained snapshot ordinal. A filtered
cursor has an `esm1_` prefix and a full SHA-256 context digest over scope, source, ceiling and
this paging interpretation. It also retains the ceiling and last examined ordinal. Source,
mode or cutoff switches cannot reuse the previous cursor. Each page reauthorizes scope;
this context digest is not an approval or a substitute for authorization. Cutoff and nonzero
anchor ordinals must name saved snapshots in that book.

Each request first materializes at most25 snapshot rows in ordinal order, within that fixed
ceiling. Only then does it inspect entries for the exact source ID. It never scans unlimited
history looking for25 matching items. `next` uses the last **examined** ordinal, not the last
returned match. Later snapshots above the ceiling wait for a fresh traversal.

Filtered responses add `membershipScan` with `sourceId`, `cutoffOrdinal`,
`examinedThroughOrdinal` and `examinedCount`. An empty `items` array can have `next`; continue
until `next` is null to finish the captured scan. It does not prove source completeness,
current eligibility or absence outside the captured inventory. Snapshot history is not
artificially restricted to VAT's500-record bound.

#### Saved entry projection

Matching items keep the original snapshot summary and add `sourceMembership` containing:

- Saved schema/engine version and captured source revision ID/number/digest.
- Nullable captured review ID/revision/digest/source digest, without its rationale or command.
- Captured withdrawal ID/digest/revision identity when that metadata existed. Absence in v1
  remains absent; explicit v2 null remains null. Neither is rewritten from live withdrawal state.
- The saved assessment, controls, calculation and contribution from the SQL-owned v1/v2
  snapshot entry. Included and excluded observations are both represented; no amount changes.

The scanned snapshot must have a supported v1/v2 pair, an entries array within the original
200-source capture bound and intact scoped source-entry identity. Duplicate selected membership,
missing captured metadata and inconsistent review/withdrawal identities refuse the response.
Stale captured reviews are permitted and remain stale in their saved assessment; the reader
does not replace them with a newer review.

The producer copies only source/review/withdrawal identity fields and the existing private
SQL calculator's saved assessment. It does not copy source/review/withdrawal input bodies,
receipts, command keys or approval material. The filtered response explicitly states
`interpretation:"retained_source_membership"`, `currentnessChecked:false` and
`legalObligationAssessed:false`.

No `expense_tax_basis`, `expense_tax_assess`, current readiness or external provider is called.
The complete canonical UTF-8 response, including every matching item from the scanned window,
must fit8MiB. Otherwise the operation refuses; it does not shrink the page or omit history.
No source, snapshot, review, withdrawal, receipt or financial allocation is changed.

### Exact shared composition

Local statement map: `src/db/statements/expense-tax-snapshots.ts` exports
`expenseTaxSnapshotStatements` with the existing `listExpenseTaxSnapshots` key and explicit
four-argument SQL call.

Root integration:

1. Remove the old inline three-argument `listExpenseTaxSnapshots` statement in `db/query.ts`.
   Import/spread the local map instead.
2. Existing `expense_tax_list_snapshots` binding forwards
   `[scopeParameter(input.scope), input.after ?? "", input.sourceId ?? ""]` after token.
3. Existing HTTP handler already forwards `...search`, and the capability schema already
   composes `TaxAfter.fields`. No new route, registry key, handler or capability is required.

The expense contract adds optional metadata to the existing page and item shapes. Unfiltered
responses do not gain those optional fields. Unfiltered and filtered cursor formats remain
separate; the appropriate SQL branch refuses mode switches.

### Source review and checks

Inspected0710 and4500 captured shapes and actual route forwarding before implementation.
Reviewed source/book isolation, withdrawn readability, old unfiltered delegation, NULL/missing
inputs, mode/source/cutoff cursor binding, observed anchors, fixed-ceiling later inserts,
window-before-filter behavior, empty-page progress, duplicate membership, stale captured review,
previously absent withdrawal metadata and full-response byte refusal. These are source observations,
not executed paging or concurrency cases.

Owned expense contract and statement module passed Oxlint with zero warnings/errors.
Owned Oxfmt and `git diff --check` passed. Shared integration/type checks remain root-owned.
No tests, fixtures, UI edits, runtime/SQL execution, migration application, provider or VCS
history actions occurred. Runtime behavior remains unverified.
