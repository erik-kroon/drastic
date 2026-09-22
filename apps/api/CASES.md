# Manual-journal case context

This module exposes real `openerp.events` created by manual-journal proposals.
A case keeps the existing event ID and source identity `(evidence_id, event_key)`.
It does not turn bank observations into business events, infer accepted facts,
or mark a source complete.

## Capture, then read

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

## Bounds and continuation

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

## Meaning and deliberate limits

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

## Parent integration

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
