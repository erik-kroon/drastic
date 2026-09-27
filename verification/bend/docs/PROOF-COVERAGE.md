# Proof coverage and evidence boundaries

## Checked propositions

`bend/LAWS.bend` is the specification surface. `bend/PROOF.bend` supplies every declared body. No first-party module contains an unsafe definition, a foreign implementation, a proof hole or an unfilled law.

| Property | What its proof establishes |
| --- | --- |
| `normalize_shift` | Normalization commutes with a binary left shift. |
| `normalize_idempotent` | Repeating normalization changes nothing. |
| `add_zero_left` | Adding zero on the left returns the normalized operand. |
| `plus_shift_zero` | The internal addition helper preserves a shifted operand when adding zero. |
| `add_zero_right` | Adding zero on the right returns the normalized operand. |
| `reversal_involution` | Swapping debit and credit twice restores the original line list. |
| `reversal_debits` | A reversal's debit total equals the original credit total. |
| `reversal_credits` | A reversal's credit total equals the original debit total. |
| `reversal_balanced` | A reversal of a balanced line list remains balanced. |
| `append_preserves_history` | Posting to the immutable journal spine preserves its previous history. |
| `voucher_balance` | Every constructed certified voucher has equal debit and credit totals. |
| `voucher_line_shape` | Every certified voucher has exactly one nonzero side on every line. |
| `voucher_minimum` | Every certified voucher contains at least two lines. |
| `allocation_source_conservation` | Amount plus source remainder equals the normalized source capacity. |
| `allocation_target_conservation` | Amount plus target remainder equals the normalized target capacity. |
| `restoration_source` | Reversing the allocation's arithmetic restores its source capacity. |
| `restoration_target` | Reversing the allocation's arithmetic restores its target capacity. |
| `floor_exact_no_increment` | A zero remainder never increments the negative floor magnitude. |
| `half_even_tie` | An exact tie delegates increment selection to quotient parity. |
| `zero_has_no_negative_sign` | Constructing a signed zero produces the canonical nonnegative zero. |

The certified-voucher and allocation properties are safety guarantees about accepted values. Their constructors require actual equality witnesses. The validators obtain those witnesses by deciding structural equality of normalized binary values, not by inserting axioms.

They are not proofs that a validator accepts every valid input. They also do not prove a refinement theorem connecting every binary arithmetic function to mathematical integers. The independent integer differential tests provide a separate, finite check of that connection.

## Executable evidence

The harness evaluates the actual Bend terms through the selected source checker/evaluator. Its independent expectations come from JS BigInt arithmetic and brute-force enumeration. Tests cover:

- Small exhaustive arithmetic grids plus large boundary values and signed division.
- GCD reduction, rational arithmetic, decimal conversion and negative rounding ties.
- Valid and invalid voucher shapes, conservation and restoration.
- VAT source differentials, excluded contributions and reported-box net derivation.
- Solver ambiguity, bounded cardinality, budget exhaustion and deterministic input identity.
- Malformed money, duplicate IDs, stale snapshots and cross-book/currency/direction refusals.
- Rejection of false proofs, missing proofs, holes, unsafe code, nondecreasing recursion and affine duplication.

An independent positive checker control verifies that rejection tests are not merely failing to load their imports. Two mutation controls deliberately break reversal and exact-negative-floor behavior; their corresponding proofs must reject those changes.

## Deliberately not claimed

There is no universal proof here of addition commutativity, multiplication correctness, Euclidean division correctness, GCD completeness or all rounding identities. Those routines are implemented and tested, not comprehensively formally verified.

There is no universal proof of PRY-33 search completeness. A complete result follows the implemented finite traversal and is tested against exhaustive enumeration. The adapter independently validates each returned witness, but uniqueness still depends on the search and declared candidate scope.

There is no proof that a receipt corresponds to an actual payment, that imported evidence is complete, that a reviewed rate is legally applicable or that an agent has human approval. Those facts cannot be established by this pure arithmetic model.

There is no concurrency proof for SQL, no proof of exactly-once financial effects and no authority to mutate posted records. In particular, `Allocation.restore` computes one restoration; it does not prevent a second restoration being applied by a careless caller. Existing effect identities and transactions must enforce that.

## Compiler trust

The included development checker is a modified source adaptation. It is not an official release and cannot satisfy `verify:release`.

`BEND_SOURCE_ROOT` selects the unmodified pinned checker, verified by Git blob hash. The release gate additionally invokes the official Bend command and `--safe`. That still leaves the compiler, proof translation, execution backend, host codecs and operating environment in the trusted computing base.
