# Exact arithmetic

Runtime money uses a custom little-endian binary natural plus explicit sign, never floating-point arithmetic or backend Nat magnitude. Public arithmetic normalizes redundant high zero bits. The host wire contract accepts canonical decimal integer strings and rejects negative zero, leading zeros, signs on nonnegative amounts, exponent notation and Number inputs.

`BigNat` provides normalization, comparison, increment, addition, checked subtraction, explicit truncated subtraction, multiplication, long division and fuel-bounded GCD. `BigInt` provides signed operations and truncating division. `Rational` normalizes fractions and supports exact, toward-zero, floor, ceiling, half-even and nearest-ties-away rounding. `half_up` in the supplied port names nearest-ties-away from zero and is not a claim about every system's use of that term. `Decimal` converts between digit lists and binary magnitudes.

Posted/output minor amounts are capped at 38 digits by the host contract. Intermediate arithmetic is not truncated to 38 digits. `money.round.v1` accepts up to 160 digits for a numerator/denominator while enforcing the output limit. FX numerator and denominator identities are checked before accepting the residual.

GCD exhaustion, division by zero, unsupported precision and inexact exact-mode results remain failures. They do not become zero or a successful approximate value.

`Meaning.bend` supplies an inductive mathematical interpretation only for specifications. Its unary representation is not used to store or compute production monetary magnitudes. The new refinement proofs establish normalization, addition and multiplication against that interpretation. Other algorithms retain explicit proof gaps documented in `PROOF-COVERAGE.md`.
