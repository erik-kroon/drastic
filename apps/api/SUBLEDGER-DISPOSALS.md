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
  a known bank/commerce/owner control. Account activation, period/year and writer authority
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

Current status: failure contract/owner inspection only. No4200 implementation or runtime
proof yet. No tests, SQL execution/application, external calls, frontend or VCS work.
