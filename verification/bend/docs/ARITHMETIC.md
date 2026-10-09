# Exact arithmetic representation

## Binary naturals

`BigNat` is a little-endian binary tree: `Zero`, `Even(high)` and `Odd(high)`. Its semantic magnitude is respectively 0, 2 times high and 2 times high plus 1. There is no native-word overflow boundary.

Raw constructors can spell redundant high zero bits. `normalize` removes them. Supported boundary operations (`add`, `subtract`, `monus`, `multiply`, `compare`, `divmod`, `gcd`, `succ`) normalize their input. Functions named `plus`, `times`, `minusBits`, `compareRaw` and `divideBits` are implementation helpers with canonical-input preconditions. They are not host entrypoints.

`subtract` returns `Underflow` rather than wrapping. `monus` is intentionally different: it returns max(left minus right, 0). Callers must not use truncated subtraction to conceal an over-allocation.

Binary long division processes the dividend bits and returns an explicit division-by-zero result. GCD uses Euclid's algorithm with structural fuel derived from operand bit lengths. An exhausted computation returns `GcdExhausted`, never an invented divisor.

## Signed integers and fractions

`BigInt` uses sign and magnitude. Its public constructors normalize negative zero. Signed division truncates toward zero and gives the remainder the dividend's sign.

A rational uses a signed numerator and nonnegative denominator representation. `make` rejects zero denominators, reduces by GCD and canonicalizes zero to 0/1. Arithmetic operations reject invalid raw zero-denominator fractions. Exhausted reduction is explicit.

The library implements exact, toward-zero, floor, ceiling, half-even and half-away-from-zero rounding. Each successful round returns the chosen integer, denominator and signed residual numerator. A residual is not silently discarded. Exact mode returns `Inexact` when division has a remainder.

The host's `half_up` alias preserves the current Drastic implementation's meaning, which rounds magnitude ties upward then restores the sign. It is not an assertion that every external system gives that name the same semantics.

## Decimal conversion and wire bounds

`Decimal.bend` converts between binary naturals and typed decimal-digit lists. It uses binary arithmetic, not floating point. The JS boundary separately validates canonical strings and constructs digits or binary terms.

Posted-money inputs retain Drastic's maximum 38 decimal digits. A multiplication intermediate can therefore exceed that bound. Returning an intermediate to a posting contract still requires that contract's range check; the arithmetic library does not silently clamp or round it.

Rates and intermediate fractions do not inherit an implicit currency scale. A filing unit or rounding denominator must be explicitly supplied by the relevant caller.

## Tests versus proofs

The arithmetic implementation has differential, boundary and round-trip tests. Only the selected properties in `PROOF-COVERAGE.md` have universal proof terms. This package is not presented as a fully proved arbitrary-precision number theory library.
