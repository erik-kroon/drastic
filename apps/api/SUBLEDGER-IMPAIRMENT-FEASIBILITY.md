# Partial impairment feasibility — AST-03

Status: **proposed and deferred**. No impairment posting profile, implementation or migration
prefix has been selected. This document records a source investigation, not a reviewed financial
artifact, endpoint or authorization to post. The contract owner must select the choices below.
No actual-company valuation, legal depreciation or tax treatment is inferred.

## Concrete missing consumer behavior

1500 declares original gross basis lines and imported accumulated recognition.0700 declares
ordinary schedule recognition debit/credit accounts.4200 selects separate gross controls and
one accumulated account specifically for terminal no-proceeds disposal, with an explicit disposal
loss account. None declares an interim impairment credit role or an impairment loss account.
The schedule debit must not silently become an impairment expense account; the schedule credit
must not silently become a combined recognition/impairment contra account.

A synthetic example illustrates why neither a manual journal nor an amount-only register record
completes the planned feature:

| Retained value                     | Minor units |
| ---------------------------------- | ----------: |
| Original gross cost G              |        1000 |
| Imported accumulated recognition O |         100 |
| Schedule carrying cost C = G − O   |         900 |
| Net ordinary recognition R         |         200 |
| Future installments F              |         650 |
| Residual S                         |          50 |
| Explicit proposed impairment I     |         100 |

Current carrying value is700. An impairment of100 would leave600; with residual50, future
installments must total550. Existing estimates reject `200 + 550 + 50 != 900`. If a generic
manual journal credits the existing accumulated account by100, controls still expect accumulated
recognition300, not400. The schedule getter and disposal still report carrying700. Current
disposal would release only300 accumulated and charge700 loss, leaving the extra contra100
behind. The manual posting is unexplained control movement, not a supported impairment workflow.

## Three contract choices required before implementation

1. **Posting roles.** Does the credit use the existing schedule accumulated account, a separately
   declared impairment contra account, or selected gross basis lines? These produce different
   control and disposal effects. Select the loss-account input and eligibility too. Existing
   disposal semantics are not implicit authorization for impairment semantics.
2. **Future allocation.** Does execution atomically post impairment and a reviewed positive future
   reallocation, or post impairment while blocking recognition until a separate estimate? The
   second choice needs a real allocation-blocked posting/control consumer. Leaving old financial
   plans executable is invalid. Atomic reallocation is a coherent candidate, not a selected rule.
3. **Correction and repetition.** Select supported impairment reversals/corrections, or explicitly
   refuse them until a register-aware workflow exists. Include corrections to acquisition and
   recognition history consumed by impairment. Select one-only versus bounded repeated impairments
   and their identities. A generic reversal cannot restore only the GL while leaving carrying and
   future allocation unchanged.

These are local financial-contract decisions. A narrow synthetic implementation does not require
inventing company facts or asserting that an actual legal impairment policy is approved.

## Conditional exact-money model

The following equations describe required conservation, not a selected account-role policy:

```text
C = G − O                         # retained original net basis stays immutable
B = C − R − I                     # carrying after effective impairment
R + I + F + S = C                 # positive explicit future suffix plus residual
allocatedMinor = R + F            # ordinary recognized plus future, not impairment
allocatedMinor + I + S = C
```

The bounded partial candidate requires `0 < I < current carrying`, at least one positive future
installment and a nonnegative explicit residual. Keep I separately visible; do not rewrite cost,
imported accumulated recognition or historical ordinary installments to conceal impairment.
Old schedules without impairment retain their original meaning and bytes.

**Only if the combined-contra role is selected**, controls would expect `O + R + I` on that
account. A later no-proceeds disposal would credit gross G, debit accumulated `O + R + I`, and
debit loss `C − R − I`. If a separate contra account is selected, disposal must release I on that
account separately. Direct gross reduction instead requires explicit gross-line allocation and
release rules; existing full-gross disposal cannot be reused unchanged.

## Actual operator journey required for a useful capability

A candidate operator prepare command would bind exact current schedule/basis digests, the explicit
partial amount, open-period posting date, selected account-role profile, retained source/review
evidence, rationale, and the complete positive future suffix/residual. It must produce a real sealed
native kernel journal and the exact proposed revision/basis snapshot, not a disconnected register
annotation. Human approval must bind the complete selected effect and schedule consequence.

For the atomic candidate, execution commits the kernel voucher/receipt, immutable owned impairment
effect and revised schedule together. Deferred aggregate enforcement must refuse constituent-only
posting or register-only writes. Existing schedule reads, estimates, declared-account controls,
closing and disposal must consume the committed effect. Preparation/approval records would serve
that financial workflow; they are not a substitute for it. No such command or artifact is implemented.

## Authority and historical boundaries

- Current operator authorization, book serialization and exact-key replay precede freshness checks.
  Scope/key/input conflicts refuse; a lost execute response recovers its original immutable result.
  New keys cannot duplicate a committed impairment.
- Bind original basis, current schedule, consumed postings/reversals, evidence and account/period
  state. Later estimate, recognition/reversal, impairment or disposal must stale old authority.
- Preserve posted occurrence bytes and original gross/opening basis.6100 retirement rules may govern
  a changed future suffix, but do not themselves authorize an impairment or its posting approval.
- Old ordinary preparations must stale on impairment dependency/current revision. Generic/manual,
  recurring and correction ancestry must not borrow owned impairment evidence or bypass the complete
  aggregate. Reuse the native journal kernel; add no ambient bypass or second posting engine.
- Acquisition-basis correction remains blocked or makes further recognition unsupported. Unsupported
  impairment/consumed-history corrections need both correction-impact disclosure and physical posting
  refusal. Disposal must freeze the impairment history it consumes too.
- No original basis, approval, voucher, saved control or prior revision is rewritten. Independent
  expected control amounts come from owned retained effects, never from unexplained GL totals.

## Necessary owner surface if a profile is selected

This is a dependency map, not an implementation authorization or a promise that a single helper
change is sufficient:

- New domain-local native prepare/approve/execute/read contracts, routes and statements; immutable
  effect/review/approval ownership; proposal/posting and deferred complete-aggregate guards;
  correction-impact and carrying-basis-reuse fences. They must have the financial consumers above.
  -4000 `subledger_estimate_current`;6100 `amend_schedule_estimate`, physical revision guard and basis
  lineage;3100 `amend_schedule_future_dates`: explicit impairment-aware net conservation.
  -4200 `subledger_posting_basis` and financial guard composition: pin impairment authority and stale
  prior plans.5300 `get_schedule`: truthful carrying/remaining with impairment shown separately.
  -4200 `create_subledger_control`, control and closing dependency owners, and3950 closing dependency
  composition where needed: cutoff-aware impairment expected lines/carrying, complete digest
  currentness, and allocation/correction gaps.
  -4200 disposal basis/prepare/execute contracts and history guards: exact post-impairment carrying
  and the selected contra/gross release.4900 correction-impact composition: expose the new owned
  effect/history without weakening existing blocking edges.

No automatic impairment amount, life/method/rounding, zero cessation, proceeds, legal/tax activation,
company-role inference or UI change is included. No tests, runtime/SQL compilation/application,
provider calls or VCS actions were performed. No implementation or prefix is reserved. Maintained
plan05 and open-decision links remain root-owned.
