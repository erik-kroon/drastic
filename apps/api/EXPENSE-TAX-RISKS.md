# Expense tax facts package — decision, risks and acceptance cases

Status: implementation contract recorded before coding. No legal profile is activated. No test or fixture change is authorized.

## Outcome and boundary

Retain immutable source observations and separately attributed human review facts for expense tax analysis. Show source-versus-reviewed-versus-calculated amounts and explicit exclusions in immutable accountant review snapshots. Never post, issue an invoice, calculate a filing-ready VAT return or assert source completeness. Source evidence and existing kernel proposal/voucher references remain owned by the kernel; these records annotate them rather than duplicating invoice or ledger authority.

Actual-company review remains useful even though all actual-company contributions are excluded from supported calculation/inclusion until a separately reviewed dated legal profile exists. A visibly synthetic profile may demonstrate caller-supplied rational rates and deduction fractions, using exact division only. No rate, legal date, full deduction or zero VAT is defaulted.

## Consequential transition rules

1. Recording source facts requires retained scoped evidence and a stable source component key. A source correction appends a revision against the expected digest; earlier evidence/amounts stay visible. Collection changes occur under the book barrier.
2. Reviewing requires an admitted operator, retained reviewer-basis evidence, the current source digest and expected latest review digest. The actor/time are server-derived. A review is a factual opinion, not legal-profile activation or posting approval. A new source revision makes the previous review stale.
3. Snapshot preparation freezes all current source revisions and their latest reviews within the bounded inventory (up to 200 source components). No row is silently dropped by date, eligibility or unknown facts. Date/profile mismatches are explicit exclusions. A larger inventory fails closed rather than becoming a partial success.
4. Actual and synthetic records cannot cross modes. `coverageEstablished`, `ledgerReconciled`, `vatReturnReady`, `productionProfileApproved` and `postingEnabled` remain false. Only complete synthetic facts may contribute to synthetic totals.
5. Numeric strings are canonical minor units. Source gross/net/VAT and reviewed gross/net/VAT are distinct. Controls expose their differences. Synthetic tax uses the explicitly supplied rational rate; a nonintegral minor-unit result is excluded, never rounded. The explicitly supplied deduction fraction must lie in [0,1]; exact division must conserve deductible + nondeductible = calculated VAT and expense + deductible = reviewed gross.
6. Unknown VAT registration/method, missing evidence/date/currency/deduction basis, unsupported treatment/profile, foreign or reverse-charge facts, inconsistent source amounts and source-versus-review differences block inclusion. An explicit reviewed zero is distinguishable from missing/null.
7. Private deterministic dependency hooks expose current source/review digests and explicit coverage/profile limitations for future company setup/closing. No shared setup or closing policy is changed by this package.

## Failure and acceptance cases (documentation, not executed tests)

- Different book/evidence/proposal/voucher IDs: reject without disclosing records or writing a partial revision.
- Same key and payload after an uncertain response: recover the original immutable result. Changed actor/target/payload with that key: conflict. New key with the same component key does not create a second source.
- Two source revisions or reviews against the same prior digest: only one succeeds under book locking; the other is stale.
- Source changes after review: old review stays readable but cannot contribute. A review made by a revoked/nonoperator credential is rejected.
- Null amount versus explicit zero: never collapse missing to zero. Decimal, negative, oversized or noncanonical inputs are rejected before storage/coercion.
- Gross != net + VAT: retain evidence/observations but expose exact discrepancy and exclude. Source versus reviewer amount mismatch: same behavior.
- Unknown registration/method/deduction policy, foreign currency/supply, reverse charge and unapproved actual profile: retain review; explicitly exclude, never fall back to zero or full deduction.
- Synthetic net*rate with a remainder, or VAT*deduction with a remainder: show the exact numerator/denominator and exclusion; do not introduce an unreviewed rounding rule.
- Actual source tagged for a synthetic snapshot, or synthetic source tagged for actual review: exclude and preserve the mode conflict.
- Snapshot after source/review update: old bytes/totals remain immutable; freshness reports changed basis. Snapshot receipt replay returns old bytes, not the new projection.
- No source rows, or every row excluded: inventory/coverage remain unestablished; no zero return or passed control is inferred.
- Source collection >200, source revisions >20 or reviews >100: fail with explicit bounded-scope refusal; no silent truncation.
- UI reload: durable inventory and snapshot list recover IDs/results. Unknown network outcomes retain keys while mounted; never reset a key as automatic recovery.
- Narrow/keyboard/200% zoom, current-source versus stale reviewer display, raw and exact amounts, readable exclusion reason and permission-limited review: require real browser observation by root. Static code checks do not satisfy this gate.

## Intended implementation

New contract `packages/contracts/src/expense-tax.ts`; API `apps/api/src/expense-tax.ts`; migration0710; domain UI `apps/web/src/components/expense-tax/**`; handoff `apps/api/EXPENSE-TAX.md`. Use existing query/Drizzle connection integration through root-owned fixed statements. No dependency, shared schema mapping, authentication, existing migration or ledger transition changes.
