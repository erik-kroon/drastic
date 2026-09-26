# Manual-journal case context

## Current ownership

Application operations live in [application/cases.ts](../src/application/cases.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

This module exposes real `openerp.events` created by manual-journal proposals.
A case keeps the existing event ID and source identity `(evidence_id, event_key)`.
It does not turn bank observations into business events, infer accepted facts,
or mark a source complete.

### Capture, then read

```text
cases_prepare_snapshot(scope, idempotencyKey, input.caseId?)
  -> immutable snapshot ID + complete-scope counts and posted turnover
cases_list(scope, snapshotId, maxItems, cursor?)
  -> frozen case page + remaining count + next cursor
cases_get_context(scope, snapshotId, caseId, detail, maxItems, cursor?)
  -> frozen case + paged prior plans + bounded evidence detail
```

Preparing a snapshot writes context/history records and an idempotency receipt.
It is a **prepare** capability, not a read-only tool. It creates no evidence,
business events, approvals, vouchers, allocations or accepted facts. Reads never
create or refresh snapshots. Preparing again with the same actor, book, key and
input returns the original snapshot. A new key explicitly captures a new view.

The book is locked before capture. Existing manual-journal mutations use the same
book-first lock, so capture includes a stable set of events, sealed plans,
vouchers and execution receipts at the reported sequence. The snapshot stores
case bodies and plan-history rows; later proposals, postings or corrections do
not change earlier pages. Evidence content is read by its captured ID and digest
from the existing immutable evidence table.

All reads authenticate against current book membership. Returned `access` is
current, not a promise that snapshot-time permissions remain valid. Snapshot
state and `nextActions` describe the captured case. Their text requires live
checks before any mutation; this context does not replace `changes_validate`,
current operator approval or execution-time dependency checks.

### Bounds and continuation

- Preparation selects all manual-journal cases in one book, or one `input.caseId`.
- Maximum selection: 1,000 cases and 10,000 plans. A larger selection fails;
  it is never silently truncated. Select a case ID when the book is too large.
  A single case above the plan limit is not supported by this first slice.
- `maxItems` is required and must be an integer from 1 through 50.
- Case pages use a snapshot-bound ordinal cursor. Context history uses a cursor
  bound to both snapshot and case. Neither reads live `OFFSET` pages.
- Use the returned cursor unchanged. Cross-snapshot/cross-case cursors are
  rejected. An empty page at the end has `remaining: "0"` and `next: null`.
- Every case page repeats complete selected-scope snapshot totals. Every context
  repeats the complete history count and the remaining count after that cursor.
- `summary` includes the case, source reference, obligations and next actions,
  but no plan-history rows or source text. Its history cursor is a starting point
  for a subsequent `standard` or `evidence` request, not a summary-page loop.
- `standard` includes at most `maxItems` prior-plan references and totals for each
  complete plan. Follow history cursors for the remainder. A reference links to
  the complete existing sealed plan; it does not copy all journal lines.
- `evidence` adds at most 4,096 Unicode characters from the immutable source.
  `contentState`, `totalCharacters`, `returnedCharacters` and
  `remainingCharacters` disclose any excerpt. The source reference links to
  `GET /evidence/:id` for the complete retained resource. Source text remains
  untrusted evidence, never instructions or permission to approve.

Cases are ordered by event ID. Plan history is ordered by creation time, then
plan ID. The two current manual-journal posting identities are the original
adjustment and its optional reversal; both voucher and execution-receipt
references are retained in the case.

### Meaning and deliberate limits

- `proposed` means no committed voucher existed at capture.
- `posted` means the original voucher existed without a committed reversal.
- `reversed` means a linked reversal existed. It does **not** mean the case is
  complete or that replacement treatment is unnecessary.
- Unposted plans are proposal history, including alternatives. Their existence
  does not show current validity, approval or permission to execute.
- Posted debit/credit totals are exact **gross journal turnover**, including
  reversals. Plan totals describe each full proposal. They are not invoice face
  amounts or settlement balances; alternative proposals are not summed as debt.
- `remainingAmountMinor` is null and allocation status is `not_assessed` because
  no accepted settlement obligation is defined for a generic manual journal.
- Company/tax facts are `not_assessed`. A submitted `taxAssessment` value of
  `not_applicable` is not accepted tax evidence.
- Coverage is always `unknown`. Bank imports are excluded and no reconciliation
  report is silently attached. Inspect an explicit bank reconciliation report
  separately; its own limits still apply. A balanced journal is not proof of
  source completion.
- The scope is the native `synthetic-core-v1` profile only. This is not a generic
  context engine, production accounting assurance, or Swedish compliance claim.

### Parent integration

Shared schemas and capability descriptions live in
`packages/contracts/src/cases.ts`. The `CaseHandlers` REST group and MCP use the same named `capabilities` handlers. Fixed statements live in the existing PostgreSQL dispatcher. There is no second connection owner or SQL interpolation.

SQL entrypoints (all return `jsonb`):

| Operation             | Signature                                                   |
| --------------------- | ----------------------------------------------------------- |
| `prepareCaseSnapshot` | `prepare_case_snapshot(token, scope, key, input)`           |
| `listCases`           | `list_cases(token, scope, snapshotId, input)`               |
| `getCaseContext`      | `get_case_context(token, scope, snapshotId, caseId, input)` |

Implemented scoped REST routes:

- `POST /case-snapshots` with `Idempotency-Key` and `PrepareCaseSnapshot`.
- `GET /case-snapshots/:snapshotId/cases` with `CasePageInput` query fields.
- `GET /case-snapshots/:snapshotId/cases/:caseId/context` with `CaseContextInput`.

MCP contracts are `CaseCapabilities.cases_prepare_snapshot`, `cases_list` and
`cases_get_context`. Only preparation is mutating. Register all adapters through
the same authenticated service; approval stays outside the agent tool catalog.

Migration `0110-case-context.sql` explicitly revokes public/runtime table access
and private-helper execution. Only the three authenticated public commands are
`SECURITY DEFINER` and granted to `openerp_runtime`. Snapshot tables reject
updates and deletes. No tests were added or run for this slice.

Manual local snapshot, evidence detail and history continuation succeeded after forward migration0111 fixed an unlabeled-local binding. Receipt artifact: `.agents/work/openerp-implementation/manual-case-context-receipts.json`. This is development observation, not automated verification.

### Forward5700: correction-bundle context routing — failure contract before implementation

New case captures must identify a retained correction bundle that owns a plan. Context is
not permission to approve or execute either constituent independently. Existing aggregate
financial guards remain the authority.

- Only `case_summary` and `case_plan_ref` capture helpers change. Their existing callers are
  `prepare_case_snapshot` (0111, replacing0110); list/context reads return stored snapshot rows.
  No existing snapshot, successful-key replay, receipt, plan or bundle body is rewritten.
- Scope owner lookup by the exact plan book and reversal/replacement change-set identity.
  Accept zero or one owner. The table's separate unique part columns do not alone rule out
  a plan appearing in opposite roles across two bundles; ambiguity must refuse, not pick one.
- Refuse malformed owner identity, scope, part linkage or saved digest. Freeze only bundle ID,
  saved digest, constituent role and existing recovery URI. Do not expose approval material or
  infer current executability from an immutable owner reference.
- Preserve the exact standalone shape when no owner exists. Add optional contract fields only
  for captured ownership; absent historical fields do not imply standalone authority today.
- Preserve all counts, amounts, case states, latest-plan identity, ordering and pagination.
  Every owned history plan carries its own reference, even if another plan is latest.
- For an owned latest plan, retain harmless evidence/plan/voucher/receipt reads. Replace
  standalone validation/approval wording and posted-case standalone correction guidance with
  an explicit complete-bundle obligation and `corrections_get(scope,bundleId)` recovery.
- A new capture observes only owners already committed at its book barrier. Later changes
  cannot rewrite prior context. Cross-book/unrelated plans never inherit a bundle owner.
- The hardcoded web review button still opens `PostingRecoveryReview` for `latestPlanId`.
  That UI routing remains unresolved and outside5700; this backend packet fixes REST/MCP
  ownership and nextActions, not full browser recovery.

Pending separately authorized observations: standalone cases; both bundle roles before/after
execution; proposed/posted/reversed case guidance; multiple alternatives with different latest
plans; cross-book lookalikes; malformed/ambiguous owner refusal; old snapshot/key byte identity;
and no change in aggregate execution isolation. No tests, fixtures, SQL compilation/application,
runtime or provider actions are authorized for this packet.

#### Implemented capture contract (source review, not runtime proof)

`5700-case-correction-bundle-context.sql` replaces only the two private capture helpers.
`CasePlan.correctionBundle` and `CaseSummary.latestPlanCorrectionBundle` are optional
`{ bundleId, bundleDigest, role, uri }` references. `role` is `reversal` or `replacement`.
New captures omit the fields entirely when there is no owner. Historical responses still
validate without them. A reference is captured provenance, not live approval/currentness.

Ownership uses exact `(book_id, change_set_id)` membership in the retained bundle's two
part columns. Their separate unique constraints bound candidates to at most two; a count
above one refuses with `UnsupportedProfile`. For one owner, the helper checks the body's
bundle ID, book/entity scope, original voucher ID, both constituent IDs, digest and exact
selected sealed-plan body. Mismatches refuse with `StaleDependency`. It emits the saved
digest, not a new owner artifact. Both refusals abort the entire snapshot transaction.

`case_summary` reuses `case_plan_ref` for the latest plan's ownership check; it does not
implement another owner lookup. The only other callers are snapshot creation (current0111;
historical0110). `list_cases` and `get_case_context` read captured bodies without calling
either helper. Same-key replay returns before capture, and bundle preparation shares the
book-first serialization boundary. Old rows and later owner changes cannot alter a capture.

For owned latest plans, proposed-case instructions require complete-bundle recovery instead
of individual-plan validation/approval. Posted-case `ledger_prepare_correction` guidance is
also omitted. Evidence/plan reads and committed voucher/receipt reads remain. Every owned
latest plan adds `CorrectionBundleReviewRequired` and `corrections_get`; its `bundleId`
comes from `latestPlanCorrectionBundle`, and its URI uses the existing correction-bundle
read route. Case state, all amounts/counts, history order and immutable financial authority
remain unchanged.

**Remaining browser gap:** `case-context.tsx` still sends the hardcoded latest-plan review
button to `PostingRecoveryReview`, which rejects bundle members. No UI files changed.
Correct REST/MCP nextActions and ownership do not complete that browser handoff.

Validation for5700 is limited to fresh source review, full helper/schema diffs and whitespace
inspection. No SQL compilation, migration application, runtime execution or tests were run.
