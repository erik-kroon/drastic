# Manual exchange-rate observations and conversion reviews

## 1900 failure cases and decisions — before implementation

This FX-01 subset retains operator-reviewed, explicitly sourced directional rates and exact
synthetic conversion reviews. It never posts invoices, payments, FX gains/losses or revaluation.
No feed retrieval, company/legal activation, automatic date selection or fallback is added.
No checks, tests, DB execution or migration application are authorized for this wave.

Failure cases:
- Foreign-book evidence/observations/revisions and stale revision digests must fail before writes.
- Missing rate, reversed direction, same-currency pair, target other than current book currency,
  wrong effective date, missing scale, zero/negative/decimal/oversized rational parts must fail.
  Explicit rate1 is valid only when entered and reviewed; never supply it by default or invert.
- Only operators may retain or revise rates; evidence and review evidence are both mandatory.
  Ordinary capture is an artifact calculation, not human approval or posting authority.
- Concurrent revisions compare the current digest under the book barrier; retain old revisions.
  Conversion pins the exact current revision; older saved reviews remain readable after revision.
- Replay returns original results before freshness checks; a reused key with a different actor,
  operation or payload conflicts. Observation source keys and capture receipts support recovery.
- Nonnegative original amounts and positive rational major-unit rates are explicit. Source scale
  and book scale must be0–6. Compute exact integer numerator/denominator first; no floating point.
- Named policy `synthetic_half_up_nonnegative_v1`: divide exact target minor units, round ties
  upward. Retain quotient, remainder and signed residual numerator over the same denominator.
  Rounded output over the existing38-digit MinorUnits bound fails; no clipping/approximation.
- Retain calculation formula, inputs, source hashes, operator revision receipt and capture receipt.
  A zero remainder is not source completeness, legal suitability or financial-close readiness.
- Immutable JSON bytes/hash/length remain unchanged; live currentness is separate and false after
  a rate revision or book currency/profile/writer change. Unrelated ledger activity need not stale
  a pure calculation. Currentness is not rate-market freshness or permission to post.
- Bound inventories to200 observations,20 revisions each and200 conversion reviews; lists must
  be complete or fail, never truncate silently. Artifacts are at most1MiB.
- UI validates response scope/identity, preserves retry keys on ambiguity, discovers saved records
  and verifies retained artifact bytes before download. No browser arithmetic or rate defaults.

Implementation shape: new1900 tables/functions, one owned contracts module composing domain
money primitives, local routes/statements and a bounded rate/revision/capture/recovery UI. Root
owns exports, shared query/API/capability composition and routed mounting. Existing1700 commerce,
1800 basis guards and every historical migration remain unchanged.
