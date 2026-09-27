# Proof coverage and trust boundaries

## Observed here

Both the development checker and the pinned upstream source checker accepted **35 completed law/proof pairs** with no reported holes. The independent safe-kernel lane also passes under Lean 4.34.0, and the suites pass against generated JS. See `evidence/current/release-verification.json` and its `safe-kernel.json` receipt for exact identities and coverage.

The default development checker is reconstructed/adapted source. Its success alone is development evidence. The upstream build verifies pinned source bytes, exercises generated code and separately invokes the freshly built independent safe kernel. The compiler, translator and host boundary remain part of the trusted computing base.

## Original 20 laws

`LAWS.bend` and `PROOF.bend` retain:

- Normalization/shift compatibility and idempotence; left and right addition identities.
- Reversal involution, debit/credit interchange and preservation of a supplied balance witness.
- Preservation of the preceding journal history in the model's append operation.
- Balance, line shape and minimum-line evidence carried by accepted voucher values.
- Source/target conservation and restoration evidence carried by accepted allocation values.
- No floor increment for an exact negative division, the half-even tie decision and canonical zero sign.

The certificate laws establish safety of already accepted values. They do not establish that every valid input is accepted. Journal-history laws do not prove persistence, database grants or concurrent execution behavior.

## New 15 laws

`Meaning.bend` defines an unbounded inductive mathematical-natural model for specifications, separate from both binary runtime integers and the backend's built-in Nat representation.

`RefinementLaws.bend` and `RefinementProof.bend` connect binary operations to that model:

| Law family | Property |
| --- | --- |
| Mathematical addition | Zero identity, successor behavior, associativity and commutativity |
| Doubling | Distribution over addition and equality to self-addition |
| Mathematical multiplication | Distribution over addition and compatibility with doubling |
| Binary shift | Decoded value doubles |
| Normalization | Decoded value is unchanged |
| Increment | Decoded value increases by one |
| Raw plus and public addition | Decoded output is the mathematical sum |
| Raw times and public multiplication | Decoded output is the mathematical product |

These are refinement statements about the actual binary implementations, not merely equations saying an operation agrees with itself. Mutation tests remove multiplication terms and verify that the corresponding refinement check rejects the change.

## What is not universally proved

The package does not contain complete refinement proofs for comparison, subtraction/borrow, long division, GCD, signed arithmetic, rational reduction, all decimal conversions, all rounding modes or solver completeness.

It also does not prove the official compiler, the Bend-to-BendTT translator, the JS/native code generators, the runtime adapters, the TypeScript declarations, source extraction accuracy, SQL isolation or statutory applicability. The official safe checker itself has an explicit scope boundary and the release gate refuses exclusions.

No `@unsafe`, foreign implementation, open law or placeholder proof is accepted by the source gate. That policy is not a claim that a new formal system or an adapted checker has no soundness defects.

## Runtime mathematical postconditions

`src/operations.mjs` checks each result independently before accepting it at the host boundary. In particular, rounding is not accepted solely because `q*d+r=n` holds.

For positive `d`:

- Floor additionally requires `0 <= r < d`.
- Ceiling additionally requires `-d < r <= 0`.
- Truncation requires `abs(r) < d` with the appropriate residual sign.
- Nearest rounding requires `2*abs(r) < d` or the selected tie condition.
- Exact mode requires `r=0`.

Thus the fraudulent result `q=0, r=n` cannot generally pass just by conserving value. Output bounds, denominator identity, box presence, net derivation, period order, capacity conservation and reversal content are independently checked too.

These small host checks remain trusted executable code, not universal proof terms. They do not compute a fallback result or authorize an action. Their purpose is to reject a bad compiled result at the boundary.

## Review discipline

Review changes to `LAWS.bend`, `RefinementLaws.bend`, the interpretation model and `src/semantics.mjs` as specification changes. Do not let an implementation agent weaken a requirement solely to make its code pass. Implementation changes, proof changes and semantic changes should remain distinguishable in review.

Do not claim complete arithmetic verification because there are 35 proof pairs. Promote one operation only after reviewing the exact law dependencies, postconditions, artifact evidence and current application mapping relevant to that operation.
