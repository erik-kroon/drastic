# Bounded future schedule dates (AST-02)

## Current ownership

Application operations live in [application/subledger/schedules.ts](../src/application/subledger/schedules.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql). Impairment/disposal and two schedule-amendment operations still contain unsupported placeholders; consult the current source before relying on the historical behavior below.

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

### Scope and failure contract recorded before implementation

The smallest amendment keeps every retained amount, account, source, occurrence key,
ordinal, residual and installment count. It replaces only dates/periods for the entire
remaining unposted suffix of an evidence-backed native synthetic schedule. This is a
real future-term amendment, not a new depreciation rule or a disposal/estimate profile.
Amount or lifetime changes need a separate reviewed allocation contract.

```text
operator + current schedule/basis digests + reviewed evidence + explicit remaining sum
  -> append immutable future-date revision; never update posted occurrences
  -> old pending plans fail shared validation and physical voucher insertion
  -> prepare fresh kernel plans -> fresh human posting approval -> existing atomic posting
```

Source-review acceptance (not executable tests):

- Reauthorize current operator permission before book lock and committed command replay.
  Same scoped key/input recovers the original revision; changed requests conflict.
- Require native synthetic profile, intact linked carrying basis and exact schedule/basis
  digests. Missing, reversed/corrected or mismatched bases refuse.
- Require every prior occurrence to be posted and every remaining occurrence to be
  unposted. Refuse reversed/conflicted history and any voucher on a remaining event.
- Both old and new remaining dates must be strictly after the server UTC date, in
  strictly increasing order, after retained prefix and basis date, and in explicit open
  periods/fiscal years. Refuse locked old periods as well as locked new periods.
- Require the full remaining suffix, unchanged count, explicit exact remaining amount,
  retained review evidence and rationale. Preserve all amounts, residual and identities.
  Reject a no-op. Bounds remain 120 occurrences and 20 immutable revisions.
- Existing preparations become unusable after any amendment; a captured schedule digest
  joins the existing basis dependency.1800 enforces it during shared validation and at
  physical posting, including generic/correction lineage. No caller bypass flag.
- Reads and committed replay preserve old bytes. Historical posted effects remain
  inspectable. Controls/closing pin current revision digests and stale old captures.
- No financial write occurs in amendment. Existing kernel validation, approval and
  execution remain necessary. No legal policy, production activation, completeness or
  financial-close readiness claim.

Implementation and static-check results follow below. Runtime/database behavior is not
verified. No migration application, tests, fixtures, browser or external action is allowed.

### Implemented source and integration

Files: forward `migrations/3100-subledger-schedule-amendments.sql`, additive schemas and
endpoint in `packages/contracts/src/subledgers.ts`, the existing HTTP subledger handler,
and `src/db/statements/subledgers.ts`. Historical migrations remain unchanged.

Root integrated the following in `apps/api/src/db/query.ts`:

```ts
import { subledgerStatements } from "./statements/subledgers";
// Within the existing statements object:
...subledgerStatements,
```

Existing `SubledgersApi` and `SubledgerHandlers` composition already owns this endpoint.
No package export, new API group or capability binding is needed. This command is
operator-only REST, deliberately absent from ordinary MCP. Existing MCP schedule reads
and native preparation receive the additive revision/basis metadata through shared schemas.

`POST /api/v1/entities/:entityId/books/:bookId/schedules/:id/future-dates`
uses `Idempotency-Key` and `AmendScheduleFutureDates`. The group declares `/v1/...`;
`packages/contracts/src/api.ts` applies `.prefix("/api")` to the composed API. SQL dispatch calls
`amend_schedule_future_dates(token, scopeJSON, scheduleId, key, inputJSON)` and decodes
`ScheduleRevision`. Reads and discovery reuse `getSchedule` / `listSchedules`; the full
revision history contains the retained amendment input, basis lineage, reviewer receipt,
review evidence hash and server UTC review date. Recover an uncertain command with the
same key and exact input. A successful old replay does not make its revision current.

The command changes dates and accounting periods, not the amount allocation or its named
policy. `remainingMinor` excludes the untouched residual. All earlier installments must
be posted and unreversed. Both original and replacement suffix dates must be future at
the instant the command owns the book barrier. Partial suffixes, overdue installments,
posted suffix entries, altered counts, missing evidence, stale digests, locked old/new
periods and no-op requests refuse before a revision or receipt remains.

#### Authority and stale-plan enforcement

The revision trigger still rejects ordinary revisions after basis linkage. Its sole new
path accepts the command-owned immutable `future_dates_v1` record and checks unchanged
financial terms/occurrence identities plus exact predecessor and carrying-basis lineage.
The runtime role receives EXECUTE on the scoped command, never table writes or private
helper access. No session flag, new approval token, direct voucher write or substitute
posting path is introduced.

`subledger_posting_basis` keeps the exact1800 output shape until a date amendment exists.
After amendment, it adds `scheduleDigest` and accepts the intact original carrying basis
through the retained amendment lineage. Thus pre-amendment proposals and proposals from
an earlier amendment fail1800's full captured-dependency comparison at validation,
approval, execution and physical voucher insertion. Native preparation catches this stale
dependency and appends a new plan. The changed posting dates enter that sealed plan and
need a fresh ordinary human posting approval. Completed command/financial receipts stay
unchanged. Existing pending proposals can still appear as prepared in historical schedule
reads; that state is not a claim that their dependencies are current.

Known generic occurrences and correction replacement ancestry still pass through1800's
native-owner guard. Genuine reversals remain governed by the existing reversal rules.
Stable evidence/event/purpose/occurrence identity preserves kernel duplicate refusal;
rescheduling does not create a second recognition identity. Unknown cloned evidence or
new arbitrary event keys remain outside economic deduplication, as before.

#### Controls and compatibility

The only change to1500's control-capture function is its basis/revision match predicate.
It accepts the retained date-amendment lineage instead of falsely marking the unchanged
basis stale. Exact expected effects still derive from unchanged amounts/accounts and
retained posted occurrences. Every other gap, unexplained line, coverage and false
readiness flag is unchanged. Old saved control bytes are never regenerated.

The current revision digest was already part of control/closing/accountant dependencies.
An amendment therefore makes prior captures stale without a new shared provider shape.
Read contracts add optional amendment and posting-basis digest fields; old bytes still
decode. Standalone schedules remain unchanged and cannot use this new command until
an eligible linked carrying basis exists.

#### Source review and proof limits

Source review traced current operator admission, scoped evidence and schedule lookup,
book/period/account lock order, replay before freshness, exact suffix conservation,
unchanged posted prefix, native re-preparation,1800 shared and physical posting guards,
known generic/correction provenance, report currentness and private grants. The control
function was compared with its1500 owner; only the basis predicate changes. Current SQL
function owners were checked; no later subledger owner is overwritten.

No SQL compilation, migration application, database request, runtime or browser proof was
performed. No tests, helpers, fixtures, deployment, commit or external calls were added.
Shared API/contracts type checking remains root-owned after query dispatch integration.

Static checks performed on the three owned TypeScript files:

- `bunx --no-install oxfmt --write`: completed.
- `bunx --no-install oxlint`: 0 warnings, 0 errors.
- `git diff --check`: passed for the working tree at review time.

These checks do not establish SQL compilation, stale-plan rejection, duplicate refusal,
concurrency, rollback or runtime compatibility. Those observations remain unverified.

###4000 explicit estimate follow-up

[Explicit remaining estimates](SUBLEDGER-ESTIMATE-AMENDMENTS.md) adds a separate reviewed
amount/residual command under the same immutable revision owner. Date-only amendments
retain their unchanged-amount contract. The new policy names explicit positive future
installments, preserves posted/reversed prefix records and enforces net recognized +
remaining + residual = retained carrying cost. Old plan authority becomes stale through
existing1800 guards. Zero installments, count changes and legal/depreciation profiles
remain unsupported.4000 is source-only, unapplied and runtime-unverified.
