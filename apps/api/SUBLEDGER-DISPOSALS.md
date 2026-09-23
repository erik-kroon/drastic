# Synthetic no-proceeds asset disposal —4200 source work

## Failure contract recorded before implementation

This bounded operation may dispose only a native `synthetic-core-v1` asset with an intact
retained gross/accumulated carrying basis. Explicit synthetic/no-proceeds/tax-not-applicable
selection is not a real legal or tax policy. No company fact or treatment is inferred.

Reject or roll back the complete transaction when:

- Current operator/scope admission fails, or an idempotency key names another actor, command
  or payload. Exact successful replay must precede currentness checks.
- The schedule/basis digest changed, the original basis was corrected/reversed, history is
  ambiguous, a correction replacement exists, or net recognition is outside retained cost.
- Selected basis lines do not still represent retained gross debits and opening accumulated
  credits. This slice requires a separate accumulated-control account equal to the schedule
  credit account; direct net write-down on a gross account is unsupported.
- A historical posting/reversal occurs after the disposal date, or a due unposted occurrence
  before disposal is silently skipped. Only remaining effects on/after disposal may cease.
- The explicit loss account is a represented carrying control, or any disposal account is
  a known bank/commerce/owner/tax-account control. Account activation, period/year and writer authority
  still use the native kernel's current checks.
- Amounts do not conserve original gross = prior accumulated + effective recognized +
  remaining carrying loss. No proceeds, balancing plug, new residual, tax or depreciation
  amount is inferred. Zero carrying loss omits the zero line, not the control releases.
- Schedule, basis, posted/reversed history, profile/period/account or retained review source
  changes after preparation. A human must approve the exact new review and kernel plan.
- Generic execution posts only the native disposal journal without its register consequence;
  deferred aggregate ownership must abort it. Generated immutable review evidence/event
  ownership must also reject cloned generic/correction proposals and postings.
- A second disposal tries to post, even under another key/review/evidence. Unique schedule
  ownership plus the book barrier must prevent a second financial/register consequence.
- Disposal is posted but schedule recognition/amendment remains usable, or generic correction
  reverses the disposal/basis/consumed prefix without a register-aware correction. These
  paths must refuse until a separately supported complete disposal-correction workflow exists.
- Controls omit disposal release lines, still report a disposed carrying amount as active,
  or closing captures remain current after disposal. Historical snapshots stay immutable;
  new/current captures retain disposal identity and release contributions without claiming
  inventory/legal completeness or financial-close readiness.
- Any posting/register/receipt/approval/constraint step fails. Native posting, register
  consequence and public idempotency receipt must commit together, with no ambient bypass.

## Inspected owners and selected source design

1500 retains gross/accumulated amounts and selected physical control lines;4000 preserves
those facts across estimates.1800 already owns shared validation and immediate physical
schedule posting authority, including the deferred native-proposal owner.1400 demonstrates
operator-only domain review/approval/execution over the same kernel with a deferred voucher
aggregate guard.4200 will use those existing patterns, not another financial engine.

The disposal source slice will require disjoint gross debit accounts and one explicit
accumulated account (the schedule credit account). Existing broader basis records outside
this bounded representation remain valid, but cannot use this disposal profile. Frozen
facts retain all occurrences, reversal links, original source/review hashes and basis digest.
A generated immutable review-envelope evidence record binds the complete reviewed basis
into the ordinary kernel plan. Unknown independent evidence/events are not universal
economic deduplication; known native provenance and retained correction ancestry are guarded.

Status when this failure contract was written: owner inspection only. The implementation
record below now describes source changes, not runtime proof. No tests, SQL execution or
application, external calls, frontend or VCS work is authorized.

Additional owner-inspection failure recorded before its guard:1500 excludes recognition and
correction vouchers as new carrying bases, but predates disposal ownership. A disposal's
accumulated-control release or loss debit must not be relabeled as another acquisition.
4200 must reject native disposal vouchers at the basis-insertion boundary as well.


## Implemented source: reviewed plan → human approval → atomic consequence

Forward `migrations/4200-subledger-disposals.sql` implements the narrow financial path.
Owner inspection found an existing safe pattern: ordinary native `prepare_journal`,
`approve_change`, `execute_change` and their immutable plans/receipts, plus1400-style
deferred aggregate enforcement. No separate posting engine, shared kernel replacement,
ambient session flag or public register-write command was added.

Three new append-only tables retain bounded disposal reviews, human approvals and the one
posted disposal per schedule. Preparation and each approval/execution call authorize the
current operator before taking the book barrier and checking exact-key replay. Twenty
reviews per schedule and twenty approvals per review are allowed. Reviews have a1MiB
complete-body limit. Failures do not save partial proposals or advance a schedule.

Preparation freezes the current revision, original1500 basis with selected physical lines,
all current occurrence states/voucher/reversal identities, derived net amounts, caller source
and review evidence hashes, explicit input and the actual native kernel plan. The compact
generated evidence envelope includes the review ID, full command and digest of the complete
frozen basis snapshot. It fits the existing65,536-character evidence limit without truncating
or duplicating the full snapshot; the complete snapshot remains in the immutable review.
The generated evidence hash belongs to the kernel action. No external evidence is fetched.

The selected profile is `synthetic_no_proceeds_asset_disposal_v1`, with literal
`proceedsMinor:"0"`, `taxAssessment:"not_applicable"` and
`acknowledgeSyntheticOnly:true`. These fields express only the explicit synthetic choice.
They never establish actual disposal facts or legal/tax treatment.

### Exact represented amounts

```text
G = retained original gross cost
O = retained imported accumulated recognition (zero for acquisition)
R = net unreversed native schedule recognition
L = G - O - R = remaining carrying amount, including retained residual

credit represented original gross debit lines       G
 debit separate accumulated-control account         O + R
 debit caller-selected non-control loss account     L
                              total debits = credits
```

The gross source lines must still match their exact posted account, ordinal and amounts.
Every original accumulated credit must use the schedule credit account; no gross debit
may use that account. Mixed accumulated controls and direct net write-down schedules are
refused, not reinterpreted. A genuine full reversal releases its prior recognition from
`R`; its face amount remains separately recorded. Posted correction replacements and
ambiguous history are refused. The original gross/opening amounts and all schedule rows,
revisions, plans, vouchers and reversals remain immutable.

`L` is derived from retained exact accounting facts, not a balancing plug or a new legal
valuation. Negative carrying amounts are refused. A zero `L` omits the zero loss line;
the positive gross and accumulated-control releases still form a valid native journal.
Zero accumulated recognition similarly omits that line. No proceeds, tax, new useful life,
new residual, impairment or revaluation is computed. Existing native balance, line-side,
precision, fiscal-year/period, active-account and writer checks remain authoritative.

The explicit loss account cannot be any known subledger basis or schedule credit control.
No disposal account may be a known bank, commerce, owner or tax-account control. This is a bounded
represented-control check, not a company-wide account-classification certificate.

Disposal may not precede its basis or any retained recognition/reversal. Due unposted
occurrences strictly before disposal must be resolved first; remaining unposted effects
on or after disposal may cease. Backdated/future accounting dates must still belong to an
open native period and cannot hide later known source history. No occurrence date is moved.

### Financial authority and correction ownership

The domain approval seals the review digest and expires after one hour. Execution requires
the same currently authorized operator and their unexpired, unused approval. Only then,
inside the same transaction, the workflow obtains the standard kernel approval, posts the
sealed kernel plan and inserts the immutable schedule disposal with posting receipt.

1800's `subledger_check_posting_basis` changes only by calling the new disposal owner before
its previous logic. The existing shared `check_dependencies`, deferred proposal-owner
trigger and immediate voucher trigger therefore inspect disposal ownership at validation,
approval and execution. The current snapshot must equal the reviewed one. A basis/revision,
posting, reversal or even changed pending occurrence preparation makes the review stale;
ordinary kernel account/period/profile/writer dependencies remain in force.

A deferred voucher aggregate guard requires the exact native disposal review/action,
posting receipt and schedule consequence together. Calling generic `execute_change` on
the disposal plan cannot commit a journal alone, even with a generic operator approval.
The transaction rolls back its posting, approval consumption, sequence/counter changes,
outbox and receipts. Generated review evidence ownership also blocks a generic cloned
proposal with another event key. Retained correction-bundle ancestry is checked, not only
the immediate event. These are provenance controls, not universal economic deduplication
of unrelated external evidence, unknown events or free-form manual accounting assertions.

After disposal, posting basis reports `supported:false, blocker:"disposed"`. Previously
prepared/approved future occurrences therefore fail the same1800 guards. A new revision
trigger refuses both date and amount amendments without rewriting4000's revision owner.
The unique disposed-schedule constraint and book barrier prevent another native disposal.

Disposal reversal/replacement is intentionally unsupported. Shared validation and physical
posting refuse corrections of the owned disposal or its consumed original basis/recognition
history. This includes previously prepared reversals and other correction callers; none
receive a new bypass. A basis-insertion trigger also refuses treating a disposal's release
or loss debit as a new acquisition/imported opening. A later register-aware correction would
need its own reviewed complete lifecycle; this packet does not reopen the schedule.

### Register, controls and closing

`ScheduleView.disposal` carries the immutable disposition. The original recognized/history
rows remain visible, while current `remainingMinor` is zero and the disposition separately
records `carryingMinorReleased`, original gross, opening accumulated and net recognition.
This is cessation, not fabricated zero-value postings for each future occurrence.

New control captures include an effective-as-of disposal and show carrying amount zero
on/after its posting date. `disposal_release` expected effects come from the sealed native
plan's carrying-control lines and exact ordinals, never from summing the GL to manufacture
agreement. The explicit loss debit is not a carrying-control contribution. Original basis,
recognition and reversal contributions remain separate, and unexplained GL differences
remain visible. Intentionally ceased future effects no longer count as missing recognition;
reversal/conflict gaps and all completeness/readiness limitations remain.

Control dependency digests include retained disposal digests once present. Technical
closing's existing schedule dependency digest also incorporates disposal identity. Due
unprepared/unposted counts exclude only effects on/after an effective disposal date;
original occurrences and correction counts remain retained. Old snapshots are not edited.
Before any disposal, the digest input shape remains unchanged. Neither controls nor closing
claim legal policy, source inventory completeness or financial-close readiness.

### HTTP and integration

Existing `SubledgerControlsApi` and `SubledgerControlsHandlers` own these routes beneath:
`/api/v1/entities/:entityId/books/:bookId/subledger-controls`.

- `POST /disposals/prepare`: `PrepareAssetDisposal` → `AssetDisposalReview`.
- `POST /disposals/:id/approve`: `ApproveAssetDisposal` → `AssetDisposalApproval`.
- `POST /disposals/:id/execute`: `ExecuteAssetDisposal` → `AssetDisposal`.
- `GET /disposals/:id`: retained review, approvals and any disposition for that schedule.
- `GET /disposals/for-schedule/:id`: all bounded review summaries and disposition.

For the first three calls, preserve the exact idempotency key and payload until receipt
recovery completes. Successful replays return the retained result before new freshness
checks; current operator authorization remains required. Read endpoints are historical
recovery only (`liveAuthorizationChecked:false`), not fresh approval/execution permission.
The GET review may show another review's completed disposal for the same schedule so a
losing proposal cannot hide which result actually committed.

The SQL result goes through Effect route composition and the shared contract decoder.
The five new query keys live in already-integrated `src/db/statements/subledgers.ts`.
No new API group/package export/shared registry edit is needed. The new financial commands
are operator-only REST and absent from ordinary MCP capabilities. Existing read/control
capabilities can expose retained disposition data, not grant disposal authority.

### Source review and proof limits

Source review traced the amount equations, original line ownership, correction and native
proposal ancestry, snapshot freshness at the physical insertion point, duplicate schedule
constraint, generic execution rollback boundary, current membership/approval expiry, date
cutoffs, control release ordinals and closing dependency consumption.1800's check-owner
replacement adds one call;4000's posting-basis replacement adds only the disposed branch.
No historical SQL or approval/posting engine was changed.

Targeted `oxfmt --write` completed. Targeted `oxlint` reported0 warnings/errors for the four
changed TypeScript files. Source whitespace inspection found no trailing whitespace. Root
owns shared API/contracts type checks. No tests/helpers/fixtures, SQL parser/application,
database/runtime exercise, provider/external action, frontend change or VCS command was
performed. All financial/concurrency/rollback claims above describe implemented guards,
not executed proof.4200 remains unapplied and runtime-unverified.

Root source review follow-up: the live account-eligibility predicate also checks same-book
3800 `tax_account_sources`. A later tax-control declaration therefore refuses a previously
prepared disposal at domain approval/execution and shared/physical revalidation. No test or
runtime proof was added for this source-only correction.
