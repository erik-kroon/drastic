import ./Foundation.bend as F
import ./BigNat.bend as N

# Sign/magnitude. Public constructors and operations canonicalize negative zero.
type BigInt is Data:
  Integer{negative: F.Flag, magnitude: N.BigNat}

type SignedDivision is Data:
  SignedDivisionByZero{}
  SignedDivided{quotient: BigInt, remainder: BigInt}

def withMagnitude(magnitude: N.BigNat, negative: F.Flag) -> BigInt:
  match magnitude:
    case N.Zero{}: Integer{F.No{}, N.Zero{}}
    case N.Even{h}: Integer{negative, N.Even{h}}
    case N.Odd{h}: Integer{negative, N.Odd{h}}

def make(negative: F.Flag, magnitude: N.BigNat) -> BigInt:
  withMagnitude(N.normalize(magnitude), negative)

def normalize(x: BigInt) -> BigInt:
  match x:
    case Integer{negative, magnitude}: make(negative, magnitude)

def zero() -> BigInt:
  Integer{F.No{}, N.Zero{}}

def positive(x: N.BigNat) -> BigInt:
  make(F.No{}, x)

def negate(x: BigInt) -> BigInt:
  match x:
    case Integer{negative, magnitude}: make(F.not(negative), magnitude)

def absolute(x: BigInt) -> N.BigNat:
  match x:
    case Integer{negative, magnitude}: N.normalize(magnitude)

def isNegative(x: BigInt) -> F.Flag:
  match x:
    case Integer{negative, magnitude}: negative

def opposed(order: F.Ordering, sign: F.Flag, a: N.BigNat, b: N.BigNat) -> BigInt:
  match order:
    case F.Less{}: make(F.not(sign), N.monus(b, a))
    case F.Same{}: zero()
    case F.More{}: make(sign, N.monus(a, b))

def combineSigns(same: F.Flag, sign: F.Flag, +a: N.BigNat, +b: N.BigNat) -> BigInt:
  match same:
    case F.Yes{}: make(sign, N.add(a, b))
    case F.No{}: opposed(N.compare(a, b), sign, a, b)

def add(a: BigInt, b: BigInt) -> BigInt:
  match a:
    case Integer{+sa, ma}:
      match b:
        case Integer{sb, mb}: combineSigns(F.not(F.xor(sa, sb)), sa, ma, mb)

def subtract(a: BigInt, b: BigInt) -> BigInt:
  add(a, negate(b))

def multiply(a: BigInt, b: BigInt) -> BigInt:
  match a:
    case Integer{sa, ma}:
      match b:
        case Integer{sb, mb}: make(F.xor(sa, sb), N.multiply(ma, mb))

def multiplyNat(a: BigInt, b: N.BigNat) -> BigInt:
  match a:
    case Integer{sign, magnitude}: make(sign, N.multiply(magnitude, b))

def reverseOrder(x: F.Ordering) -> F.Ordering:
  match x:
    case F.Less{}: F.More{}
    case F.Same{}: F.Same{}
    case F.More{}: F.Less{}

def signedOrder(sign: F.Flag, order: F.Ordering) -> F.Ordering:
  match sign:
    case F.No{}: order
    case F.Yes{}: reverseOrder(order)

def compareNormalized(a: BigInt, b: BigInt) -> F.Ordering:
  match a:
    case Integer{sa, ma}:
      match sa:
        case F.No{}:
          match b:
            case Integer{sb, mb}:
              match sb:
                case F.No{}: N.compare(ma, mb)
                case F.Yes{}: F.More{}
        case F.Yes{}:
          match b:
            case Integer{sb, mb}:
              match sb:
                case F.No{}: F.Less{}
                case F.Yes{}: reverseOrder(N.compare(ma, mb))

def compare(a: BigInt, b: BigInt) -> F.Ordering:
  compareNormalized(normalize(a), normalize(b))

def equal(a: BigInt, b: BigInt) -> F.Flag:
  F.isSame(compare(a, b))

def signedParts(parts: N.Division, quotientSign: F.Flag, remainderSign: F.Flag) -> SignedDivision:
  match parts:
    case N.DivisionByZero{}: SignedDivisionByZero{}
    case N.Divided{q, r}: SignedDivided{make(quotientSign, q), make(remainderSign, r)}

# Truncation toward zero; remainder has the dividend's sign.
def divmod(a: BigInt, b: BigInt) -> SignedDivision:
  match a:
    case Integer{+sa, ma}:
      match b:
        case Integer{sb, mb}: signedParts(N.divmod(ma, mb), F.xor(sa, sb), sa)
