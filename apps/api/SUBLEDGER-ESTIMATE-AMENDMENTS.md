# Explicit remaining-basis estimates — synthetic AST-01/02

## Scope and failure contract recorded before implementation

Extend3100's immutable revision owner. An operator supplies exact future amounts and an
explicit residual for the entire unposted future suffix. This is a named synthetic
`explicit_remaining_minor_v1` policy, not equal allocation, a useful-life recommendation,
a depreciation/tax rule, impairment, revaluation or disposal. No ledger posting occurs.

```text
current schedule + original linked basis + current posted/reversed prefix
  -> reviewed explicit remaining amounts + residual = retained net carrying cost
  -> new immutable revision; old pending financial plans become stale
  -> fresh native preparations -> fresh human approval -> existing physical posting guards
```

Source-review failure cases, recorded before code changes:

- Scope, current operator permission, book barrier, exact-key replay and scoped evidence
  must match3100. Old committed responses stay recoverable; changed requests conflict.
- Require exact current schedule and original basis digests. Original gross acquisition,
  imported accumulated recognition, carrying cost, source evidence, accounts, installment
  count and stable occurrence IDs never change. Reversed/corrected acquisition basis refuses.
- Prefix occurrences may be posted or genuinely fully reversed, never pending/conflicted.
  Preserve every prefix amount/date/identity and voucher link. Exclude fully reversed
  recognition from the reviewed net recognized amount; retain it visibly in history.
- Require every remaining occurrence to be unposted, with original and new dates future
  in open periods. New dates follow the latest prefix posting/reversal date and basis date.
  Reused IDs, partial suffixes, overdue unposted effects or ambiguous correction history refuse.
- Exact recognized + explicitly supplied future amounts + residual must equal retained
  schedule cost. Use bounded canonical integer strings; no floats or guessed final amount.
  Residual may be zero. Future installments must remain positive in this bounded slice:
  zero-value entries have no supported kernel posting/occurrence completion contract and
  are explicitly refused rather than fabricated as posted. Count/lifetime changes refuse.
- New output must name the explicit policy. For that policy, `allocatedMinor` is the net
  recognized-plus-future allocation excluding reversed history, not a sum of every retained
  historical face amount. The amendment retains reviewed recognized and reversed totals.
  Historical equal-allocation revisions retain their original bytes and meaning.
- Old prepared/approved effects must fail1800's captured dependency comparison during shared
  validation and physical voucher insertion. Reprepare must create a new plan/approval.
- A later reversal/conflict changes the effective estimate basis. Block further recognition
  if live net allocation plus residual no longer conserves cost. Normal installment posting
  moves the same amount from future to recognized without staling peers. A new reviewed
  estimate may repair a now-reversed prefix using an otherwise intact original basis.
- Date-only amendments must not bypass estimate history/conservation checks or erase policy
  meaning. Preserve3100's stronger amount/account freeze for that command.
- Declared-account controls must continue to explain original/reversal rows separately with
  the unchanged posted amounts/accounts. Reversed gaps remain visible; no completeness or
  financial-close readiness flag is activated.
- No test/helper/fixture, runtime/SQL exercise, migration application, external/provider
  call, VCS change, frontend change or legal/production activation is authorized.

Additional source-review failure identified before the related guard change: a historical
full reversal may belong to a correction bundle whose replacement already posted under
a different event. That replacement cannot be ignored when allocating remaining basis.
Refuse that lineage rather than infer a new carrying basis, even if the replacement was
later reversed. Only a full reversal without a retained posted bundle replacement is
eligible for the bounded net-prefix treatment.

## Implemented source and caller

Forward `migrations/4000-subledger-estimate-amendments.sql` adds
`amend_schedule_estimate` and extends only3100's private revision/basis owners. It does not
replace1800's shared dependency or physical posting guards. No historical migration,
retained row or receipt is updated. The estimate uses the existing schedule/revision tables.

Public operator-only REST:
`POST /api/v1/entities/:entityId/books/:bookId/schedules/:id/estimates`.
The group declares `/v1/...`; shared `Api.prefix("/api")` supplies the public prefix.
`AmendScheduleEstimate` takes current schedule/basis digests, `firstOrdinal`, explicit
`remainingMinor` and `residualMinor`, one `{postingDate, accountingPeriodId, amountMinor}`
per remaining installment, review evidence and rationale. All amounts are canonical strings
bounded to38 digits. Future amounts are strictly positive; residual is nonnegative.
No array element may add account, source, ordinal or event identity fields.

The response remains `ScheduleRevision`. Its optional amendment union now includes
`remaining_estimate_v1`, the exact reviewed input, derived net recognized amount, separately
retained reversed face amount, original basis lineage, review evidence hash and reviewer
receipt. Source discovery/history reuse existing list/get routes. An uncertain request
must retry the same scope, key and exact input; a later currentness change does not replace
the successful retained result.

`RetainedScheduleTerms` admits the new `explicit_remaining_minor_v1` output policy.
Initial create/revise inputs still use `ScheduleTerms` with only the original equal policy.
Thus no caller can select an explicit estimate through the original generic revision path,
and prior revisions retain their equal-allocation interpretation.

## Conservation and reversed history

For the new policy, the sealed review records:

```text
recognized = sum(unreversed posted prefix amounts)
reversed = sum(eligible fully reversed prefix face amounts)  # history, not recognized again
remaining = sum(explicit future installment amounts)
recognized + remaining + residual = retained schedule carrying cost
allocatedMinor = recognized + remaining
```

No residual or final installment is calculated for the caller. The supplied amounts must
satisfy both the declared remaining sum and the retained-cost equation exactly. Original
acquisition gross cost/imported accumulated recognition stay in1500's unchanged basis;
the existing schedule cost remains that retained net carrying cost, not gross acquisition
cost. This command cannot capitalize a new cost or reset imported depreciation.

A reversed prefix remains in occurrences with its original date, amount, identity and
voucher/reversal links. Under the explicit policy its face amount is excluded from the
net `allocatedMinor` meaning. Summing every retained face amount therefore need not equal
net allocation: reversal history is not another future installment. Old equal-allocation
revisions and their `allocatedMinor` bytes remain untouched. The new policy and explicit
review totals make that distinction machine-readable.

Only a genuine full reversal without a posted correction-bundle replacement can release
prefix recognition. Ambiguous/multiple correction rows or a known replacement refuse.
Future installment dates must follow the latest prefix posting or reversal date, avoiding
new recognition before the released amount's accounting date. No reversal, correction,
impairment or disposal is generated by this command.

## Stale authority and recovery

The current amendment digest already participates in3100/1800's posting-basis capture.
Any amount, residual or date amendment changes that digest. Old pending preparations and
approvals therefore fail existing shared validation and the immediate voucher-insertion
guard. Native preparation detects stale dependency and creates a fresh kernel plan;
ordinary human financial approval is still necessary. Stable occurrence event identities
keep the kernel duplicate constraint intact, including originally reversed occurrences.
No stored plan or approval is repointed to the changed amounts.

`subledger_estimate_current` adds live conservation for the named explicit policy. It sums
unposted and unreversed posted amounts, excludes only genuine full reversals, refuses
conflicts/posted correction replacements and checks net allocation plus residual against
retained cost. Ordinary installment posting transfers the same amount between future and
recognized state, so it does not invalidate unrelated prepared peers. A later reversal
reduces the net sum and makes `postingBasis.supported=false` with
`blocker:estimate_history_changed`;1800 then blocks future preparation/approval/posting.
A new evidence-backed estimate can review the now-reversed prefix and reallocate the still
future/open suffix, but cannot bypass a reversed/corrected original carrying basis.

Date-only amendments retain their stronger unchanged amount/residual/policy guards. They
also run the explicit-policy conservation check when applicable. An estimate with reversed
prefix may need the estimate route for later date changes, because3100 deliberately
requires an unreversed posted prefix. No legal policy or completed zero-value occurrence
is inferred to bypass that existing bound.

## Controls, limits and integration

3100 control capture already calls the shared basis/revision lineage helper.4000 admits the
new estimate kind there without replacing the control function. Expected GL contributions
still use each retained occurrence amount/account, including separate original/reversal
rows. The command never changes a posted occurrence amount. Reversed/conflicted review
gaps and false completeness/readiness flags stay in place. Existing current revision and
ledger dependency digests stale prior control/closing/accountant captures.

Existing limits remain120 occurrence identities and20 retained schedule revisions. Future
count changes, zero installments, closed/due unposted suffixes, source/account changes,
posted correction replacement lineage, full residual-only cessation and changed gross
basis require another supported workflow; this command refuses them.

Files: new4000 forward SQL; additive subledger contract, existing route handler and
`src/db/statements/subledgers.ts`; this handoff and latest links in prior subledger handoffs.
Root already imports/spreads `subledgerStatements` and composes `SubledgersApi` /
`SubledgerHandlers`, so the new key/endpoint join that existing integration. No new export,
API group, capability registration or shared file edit is required. The mutation remains
operator-only REST, absent from ordinary MCP. SQL parameters are token, scope JSON,
schedule ID, key and input JSON; the result decodes as `ScheduleRevision`.

## Source review and proof limits

Source review traced current operator admission, scope, replay-before-freshness, book and
period/account lock ordering, integer bounds and conservation, immutable prefix handling,
standalone reversal versus correction replacement lineage, date-only policy compatibility,
1800 native/generic/physical guard paths, declared-account control contributions and private
EXECUTE grants. The4000 posting-basis replacement differs from3100 only by its new live
estimate-conservation branch. No shared financial approval or physical guard is weakened.

No SQL compilation/application, database/runtime exercise, test/helper/fixture, external or
provider call, VCS change, frontend change, legal-policy activation or production action
was performed. Shared API/contracts type checks remain root-owned. Source presence and
static checks do not prove conservation, concurrency, rollback or stale-plan behavior at
runtime.

Worker static checks: targeted `oxfmt --write` completed and targeted `oxlint` reported0
warnings/errors on the three owned TypeScript files. Source whitespace inspection found
no trailing whitespace in the new SQL/handoff and changed TypeScript. No VCS command was
used in this estimate packet. SQL compilation and shared types remain unverified by this
worker; root owns the shared static checks.

## Proposed6100: explicit remaining installment-count changes

**Design and failure contract only. Not implemented or accepted as runtime evidence.**
6100 is provisionally reserved pending an independent boundary review. The proposal extends
this existing estimates command, not its authority or financial policy. No new endpoint,
review artifact, table or UI flow is proposed.

### Caller and exact-money boundary

The existing operator-only `POST /api/v1/entities/:entityId/books/:bookId/schedules/:id/estimates`
accepts the same `AmendScheduleEstimate` fields. The proposed new behavior permits a different
positive installment-array length for the complete existing future suffix. For example,
retained carrying cost900, recognized prefix300 and remaining600/residual0 can explicitly
become three future200 installments or one future600 installment. The operator supplies each
amount/date/period; no lifetime, final amount or rounding policy is inferred.

Same-count requests retain4000 behavior and `remaining_estimate_v1`. Count-changing requests
would emit `remaining_lifetime_v1` in the existing immutable revision, with the same reviewed
input/basis/evidence/recognized/reversed fields and `explicit_remaining_minor_v1` allocation.
`usefulPeriods` would equal retained prefix count plus new future count; it is a slot count,
not a legal depreciation-life conclusion. The existing contract already accepts1–120 input
installments; only its output amendment union needs the new kind.

### Identity and retained-history contract

- Require an existing, nonempty, entirely future/open unposted suffix. `firstOrdinal` remains
  within the old occurrence array. A fully posted schedule cannot be reopened by this command.
- Keep every posted or genuinely fully reversed prefix occurrence unchanged, including amount,
  ordinal, date, period and event key. Refuse ambiguous/conflicted history or any retained
  posted correction-bundle replacement, even if that replacement was later reversed.
- For a count change, replace the complete future suffix with fresh server-generated event
  keys, including overlapping ordinal positions. New current ordinals stay contiguous.
  Reduction followed by extension must never resurrect a retired event key.
- Reject duplicate new keys, any key retained in schedule revision history, and any existing
  event with the same source/key. Source evidence and schedule/basis accounts remain frozen.
- Old revisions, preparations, events, plans, approvals and receipts are never deleted,
  repointed or marked executed. `previousDigest` plus full retained revisions records which
  future identities were superseded; no separate retirement registry is needed.
- Preserve the120-current-occurrence and20-revision bounds. Fresh generations permit at most
 2400 distinct retained occurrence keys; do not continue to claim120 identities for all history.
  Preserve100 preparation attempts per schedule/ordinal across every generation, and existing
  control/closing inventory limits. A new generation must not reset attempts or reclaim bounds.

### Admission, conservation and stale-authority failures

- Current operator/scope authorization, book-first lock and exact-key replay-before-freshness
  remain unchanged. Changed input/key ownership conflicts; an old successful request still
  returns its original immutable result, not a reconstruction of current terms.
- Match exact current schedule and intact linked acquisition/imported-basis digests. Freeze
  original gross/imported accumulation, carrying cost, source evidence, currency, accounts,
  schedule kind and other terms except explicit future periods/count/amounts/residual/policy.
- Check every old suffix occurrence, including removed ones: no posting/correction, no due
  date, no locked original period. A count reduction is not a way to hide an unresolved effect.
- Require at least one strictly positive new installment, nonnegative explicit residual and
  no more than120 current occurrences including the retained prefix. Dates are future,
  strictly increasing, after the basis and latest prefix posting/reversal, and within explicit
  same-book open periods/fiscal years. No caller-supplied identities or accounts are accepted.
- Require exact canonical bounded minor-unit strings and both equations:
  `sum(new future amounts) = remainingMinor`;
  `recognized prefix + remainingMinor + residualMinor = unchanged retained carrying cost`.
  Reversed face amounts stay history and are not recognized again.
- A new revision/digest must permanently stale every previous native future preparation,
  including removed identities. Old approvals never transfer to a new key/amount/count.
  Fresh native preparation and normal human posting approval are still required.
- Retired keys remain protected from generic/manual/recurring/correction-replacement posting,
  not merely absent from the current schedule. Exact old command replay remains historical
  recovery and grants no renewed financial authority.
- Normal new installment posting moves value from future to recognized without staling peers.
  Later eligible reversal still changes conservation and blocks further recognition until
  another reviewed estimate; disposal still blocks all later revisions and recognition.
- Later same-count/date amendments preserve the current generated keys/count. Date-only
  amendments keep3100's stronger financial freeze and its existing reversed-prefix limitation.

### Owners and required independent challenge

The proposed forward migration replaces only4000 `amend_schedule_estimate`,
`subledger_basis_matches_revision`, `subledger_basis_revision_guard`, and0700
`subledger_occurrence_states`. Existing route/statement, native preparation, physical posting,
financial approval, getter, control, disposal and closing owners should remain unchanged.

The state helper currently selects latest preparation by ordinal alone. It must additionally
match the preparation's pinned revision occurrence event key and source evidence to the
requested occurrence. Otherwise a fresh generation could display a retired preparation.
Same-key date/amount amendments must keep current behavior. Do **not** filter1800 native
preparation's latest-attempt lookup by generation: its stale-plan branch must see the retained
maximum attempt and increment it, never restart the ordinal counter.

The revision trigger must independently fence the new amendment's prefix bytes, positive
count/period shape, fresh unique never-reused suffix identities, permitted `usefulPeriods`
change, receipt operation, exact input/basis lineage and live conservation. Existing4000 and
3100 branches keep their current checks. Malformed/ambiguous transitions refuse atomically.

Boundary reasoning to challenge before approval:

-4200 `subledger_posting_basis` includes current amended schedule digest.4200
  `subledger_check_posting_basis` compares the full retained preparation capture.1800 shared
  dependency validation and its book-locked BEFORE-voucher guard consume that check.
- The4200 generic/correction-ancestry guard scans **all** retained schedule revisions, so
  retiring a key from the active suffix must not release its provenance restriction.
-1800 `prepare_schedule_occurrence` indexes the current contiguous slot, checks expected
  digest and prior plan dependencies, then uses a fresh plan/approval and next retained attempt.
-4000 `subledger_estimate_current` consumes the current occurrences and excludes only genuine
  reversals.4200 disposal/control/closing and3950 closing dependencies consume the same current
  revision/state; their digests must stale old captures without altering historical bytes.
-5300 schedule reads already return full immutable revision history and independent live tax
  references. All other count/ordinal consumers need source review for generation assumptions.

No automatic lifetime/method/rounding, legal depreciation/tax/company treatment, fully posted
reopening, zero/residual-only cessation, impairment, proceeds or changed carrying basis/accounts
is proposed. Those remain outside this packet. No tests, helpers, fixtures, runtime/SQL
compilation/application, provider calls, UI edits or VCS actions are authorized. Source review
and any later static checks are not proof of concurrency, isolation or rollback behavior.
