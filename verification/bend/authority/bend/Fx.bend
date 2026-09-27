import ./Foundation.bend as F
import ./BigNat.bend as N
import ./BigInt.bend as I
import ./Rational.bend as R

# A rate is quote-major-units per base-major-unit. Scale factors are explicit.
# This returns a conversion, not an accounting gain/loss classification.
def powerTen(scale: F.Count) -> N.BigNat:
  match scale:
    case F.Stop{}: N.Odd{N.Zero{}}
    case F.Tick{rest}: N.multiply(N.Even{N.Odd{N.Even{N.Odd{N.Zero{}}}}}, powerTen(rest))

def convert(amount: I.BigInt, numerator: N.BigNat, denominator: N.BigNat,
  fromScale: F.Count, toScale: F.Count, mode: R.RoundingMode) -> R.RoundedResult:
  R.round(I.multiplyNat(amount, N.multiply(numerator, powerTen(toScale))),
    N.multiply(denominator, powerTen(fromScale)), mode)
