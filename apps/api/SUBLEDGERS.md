# Assets and deferrals: explicit schedule preparation

## Status

Implemented source: migration `0700-subledger-schedules.sql`, shared `subledgers` schemas, the `SubledgerHandlers` Effect group and `components/subledgers/` UI. Root owns shared API/capability/query composition and validation. This document does not claim the migration was applied or a request/browser flow was observed. No new tests or fixtures were added.

Only `synthetic-core-v1` with native writer authority is supported. No real company profile, Swedish depreciation rule, tax treatment, legal interval, payroll policy, exchange rate or authority acknowledgement has been accepted.

## Supported flow

```text
retained source evidence + explicit terms
  -> immutable schedule revision + exact occurrence amounts
  -> prepare one occurrence -> ordinary sealed kernel proposal
  -> separate human review/approval -> existing kernel execution
  -> live schedule reads link proposal, posting and any full reversal
```

The bilingual panel supports retaining text evidence, creating a schedule, paging/recovering schedules, reading retained revisions and source evidence, revising an unprepared schedule, and preparing/recovering an occurrence. It sends the resulting change-set ID to the shared journal review. It does not approve or execute a proposal itself.

Caller inputs are mandatory: source component key, `asset` or `deferral` label, name, retained evidence ID, rationale, source cost, residual amount, debit/credit accounts, series, useful-period count, each posting date and accounting-period ID, and explicit acceptance of `equal_minor_final_remainder_v1`. No dates, account numbers, useful life, residual value or accounting classification are inferred. The type label does not establish a tax or accounting rule. `taxAssessment` must be `not_applicable`.

### Exact allocation

All amounts are canonical nonnegative integer minor-unit strings, bounded below `10^38`. PostgreSQL numeric arithmetic owns allocation; the browser does not calculate accounting amounts.

Let `A = costMinor - residualMinor`, `N = usefulPeriods`, and `q = div(A, N)`. Require `1 <= N <= 120` and `A >= N`. The first `N - 1` occurrences receive `q`; the last receives `A - q * (N - 1)`. Therefore every occurrence is positive and their sum plus residual equals the source cost exactly. This is an explicitly chosen mathematical distribution, not a legal rounding policy. In particular it must not be reused for Swedish VAT rounding.

Dates must be real `YYYY-MM-DD` dates, strictly increasing, and inside the explicitly supplied book period and fiscal year. Terms must use existing open periods and two distinct active book accounts. Periods are not generated; periods beyond existing book setup must be provisioned by the owning workflow first.

### Revisions and identity

- `(book_id, source_key)` identifies one declared source component. A second key can describe another component; the service does not claim source split completeness or prevent a human from declaring the same economics twice.
- Revisions are immutable, linked by the prior digest, and limited to 20. The digest covers all stored revision fields except itself, using kernel canonicalization.
- A caller must present the current digest to revise. No revision can replace a schedule after any occurrence proposal/event exists. This conservative first boundary prevents a previously sealed, approved proposal from posting superseded terms.
- Future-only revisions after preparation, impairment, disposal, revised estimates and replacement after reversal remain unsupported. They need coordination with correction semantics; do not clone a schedule to silently bypass that boundary.
- An occurrence's stable kernel event key is `<scheduleId>_<ordinal>`, under its retained source evidence. Re-preparation keeps this identity. Kernel event/purpose/occurrence uniqueness, not a scheduler flag, prevents double posting.
- Each preparation and any stale-dependency replacement is appended. If the latest proposal is still valid, a new request key returns that same proposal. If its kernel dependencies are stale, prepare creates a fresh sealed proposal with unchanged schedule terms. Existing period/profile/account checks still apply. At most 100 preparations per occurrence are retained.
- A posted occurrence is not re-prepared, even after a full reversal. Human correction review is required; no automatic replacement is inferred.

### Recognition is not reconciliation

The live read reports the current immutable revision, all retained revisions, per-occurrence proposal/digest, posting voucher, reversal voucher and state. `recognizedMinor` sums schedule-owned posted amounts without a linked reversal. `remainingMinor = costMinor - recognizedMinor` includes the residual. A successful preparation does not change either amount.

If an ordinary manual proposal independently consumes this schedule's event identity, the occurrence is `conflicted`, not recognized. The UI shows the actual posting proposal/voucher for review. Kernel full reversals are linked to their original postings; reversing a reversal is currently prohibited by the kernel. If that kernel contract changes, the schedule read must change with it.

`controlAccountReconciled` is always false. The original purchase/deferral posting, opening carrying amount, asset register inventory, invoice allocation coverage and control-account reconciliation are not established by this flow. These totals must not be used as a statutory fixed-asset register or a whole-company readiness certificate.

## Authority, receipts and failure behavior

Public functions authorize through the existing credential/member admission locks, then acquire the book lock before schedule/configuration locks. All mutations, inner kernel proposal creation and outer receipts commit in one transaction. Reads hold a shared book lock. All functions protect `search_path`; all tables and private helpers revoke runtime/PUBLIC access. Only scoped authenticated entrypoints receive runtime EXECUTE.

A replay returns the original command result, not a later live view. The same key with another actor, operation, target or payload conflicts. After an uncertain UI write, unchanged input retains its key while mounted. Following navigation/reload, recover schedules from their durable source key/list and occurrences from `get_schedule`; in-memory key maps are not claimed as durable recovery. Only a confirmed preparation response clears that local key to permit a new dependency check on the next explicit click.

Source-level failure review covered malformed/excess fields, decimal/oversized amounts, residual greater than cost, zero allocations, missing/foreign evidence and accounts, wrong/locked periods, repeated/unordered dates, stale revisions, duplicate source keys, stale kernel dependencies, conflicting event consumption, linked reversals, retry identity and runtime helper exposure. These are implemented guards and review targets, not failure/concurrency/recovery proof. Runtime and rendered validation remain separate gates.

## Integration map

- Contract package export: `"./subledgers": "./src/subledgers.ts"`.
- Add `SubledgersApi` to `Api`; add `SubledgerHandlers` to HTTP composition.
- Spread `SubledgerCapabilities` into shared `Capabilities`. Bind below through the existing `bindCapability`; REST, direct Effect and MCP then share the same functions and contracts.

| Capability          | Database key                | Fixed SQL function and ordered parameters                                              |
| ------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `schedules_create`  | `createSchedule`            | `openerp.create_schedule(token, scope, idempotencyKey, input)`                         |
| `schedules_list`    | `listSchedules`             | `openerp.list_schedules(token, scope, after ?? "")`                                    |
| `schedules_get`     | `getSchedule`               | `openerp.get_schedule(token, scope, scheduleId)`                                       |
| `schedules_revise`  | `reviseSchedule`            | `openerp.revise_schedule(token, scope, scheduleId, idempotencyKey, input)`             |
| `schedules_prepare` | `prepareScheduleOccurrence` | `openerp.prepare_schedule_occurrence(token, scope, scheduleId, idempotencyKey, input)` |

Use `$n::text` for text and `$n::jsonb` for scope/input. Serialize scope with `scopeParameter` and input with `JSON.stringify`. Each SQL call returns `as result`. The HTTP path is `/api/v1/entities/:entityId/books/:bookId/schedules`, with `/:id`, `/:id/revisions` and `/:id/prepare` as declared in the group.

Mount `SubledgersPanel` from `components/subledgers/schedules.tsx` with `{book, setup, locale, onPrepared}` in the scoped workspace. It uses owned UI primitives/StyleX tokens and local English/Swedish copy. Section ID is `subledgers`. Scope changes must remount local drafts, as the shared workspace already does.

### Year-end dependency

Private `openerp.subledger_close_dependencies(book text, ends_on date) RETURNS jsonb` is intended only for a SECURITY DEFINER close owner while holding the same book lock. No runtime grant.

It returns `coverageEstablished:false`, `scheduleRevisionDigest`, `scheduleCount`, `dueUnpreparedCount`, `dueUnpostedCount`, `reversedOccurrenceCount`, `conflictedOccurrenceCount` and `limitation`. `dueUnpostedCount` includes unprepared, prepared and conflicted due occurrences. Posting/reversal dates are cut off by `ends_on`. The digest binds each current revision and all due occurrence/proposal/posting/reversal identities. No wall-clock timestamp is inserted. No schedules still means coverage is unestablished. The year-end owner decides its technical close blockers and must retain the statutory coverage limitation.

## Evidence-backed basis and declared-account controls (1500 source slice)

The separate [schedule-control module](SUBLEDGER-CONTROLS.md) links an operator-reviewed
acquisition or imported-opening carrying basis to existing posted lines and a frozen schedule
revision. It captures immutable known-register versus complete declared-account GL controls,
including individual unexplained rows, missing expected effects and saved JSON bytes. It does
not create openings, activate depreciation law or establish whole-source/close readiness.
Existing0700 schedule views still report `controlAccountReconciled:false`;1500 only adds the
basis freeze to their revision-allowed condition. Root composition and all runtime proof remain
pending. No existing migration or posted occurrence was changed.

## Schedule boundaries and remaining domain roadmap

Schedules retain their basis, remaining amounts and immutable posted occurrences. Preparation does not automatically post. Revisions affect eligible future occurrences; they cannot reset or recalculate posted history.

Next supported schedule work needs source purchase/control-account reconciliation, evidence-linked invoice component acceptance with the commerce owner, and future-term revision/correction treatment with the correction/year-end owners. Add each only as a coherent workflow, not a purported compliant flag.

VAT remains blocked by `docs/adr/0002-swedish-vat-profile-boundary.md` and `docs/sources/sweden-vat-sources.json`: no production-approved legal interval or rounding/aggregation algorithm exists. Payroll needs accepted employer/employee facts, current dated rules and authorization. FX needs exact rational rate numerator/denominator, source, effective date, explicit rounding scope/mode and account policy; no rates or floating-point defaults are provided. No production posting, filing, payment, deployment or external acknowledgement is claimed or enabled here.
