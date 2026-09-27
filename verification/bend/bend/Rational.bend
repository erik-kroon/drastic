import ./Foundation.bend as F
import ./BigNat.bend as N
import ./BigInt.bend as I

type Rational is Data:
  Fraction{numerator: I.BigInt, denominator: N.BigNat}

type RationalResult is Data:
  ZeroDenominator{}
  ReductionExhausted{}
  RationalValue{value: Rational}

type RoundingMode is Data:
  Exact{}
  TowardZero{}
  Floor{}
  Ceiling{}
  HalfEven{}
  HalfAway{}

type RoundedResult is Data:
  RoundingZeroDenominator{}
  Inexact{}
  Rounded{value: I.BigInt, residualNumerator: I.BigInt, denominator: N.BigNat}

def reducedWith(g: N.GcdResult, numerator: I.BigInt, denominator: N.BigNat) -> RationalResult:
  match g:
    case N.GcdExhausted{}: ReductionExhausted{}
    case N.GcdValue{+d}:
      match numerator:
        case I.Integer{negative, magnitude}:
          RationalValue{Fraction{
            I.make(negative, N.getQuotient(N.divideBits(magnitude, d))),
            N.getQuotient(N.divideBits(denominator, d))}}

def makeDenominator(d: N.BigNat, +n: I.BigInt) -> RationalResult:
  match d:
    case N.Zero{}: ZeroDenominator{}
    case N.Even{+h}: reducedWith(N.gcd(I.absolute(n), N.Even{h}), n, N.Even{h})
    case N.Odd{+h}: reducedWith(N.gcd(I.absolute(n), N.Odd{h}), n, N.Odd{h})

# Reduced fractions with positive denominators. Zero is canonical 0/1.
def make(n: I.BigInt, d: N.BigNat) -> RationalResult:
  makeDenominator(N.normalize(d), I.normalize(n))

def invalidEither(a: N.BigNat, b: N.BigNat) -> F.Flag:
  F.not(F.and(F.not(N.isZero(a)), F.not(N.isZero(b))))

def addChecked(invalid: F.Flag, an: I.BigInt, +ad: N.BigNat, bn: I.BigInt, +bd: N.BigNat) -> RationalResult:
  match invalid:
    case F.Yes{}: ZeroDenominator{}
    case F.No{}:
      make(I.add(I.multiplyNat(an, bd), I.multiplyNat(bn, ad)), N.multiply(ad, bd))

def add(a: Rational, b: Rational) -> RationalResult:
  match a:
    case Fraction{an, +ad}:
      match b:
        case Fraction{bn, +bd}: addChecked(invalidEither(ad, bd), an, ad, bn, bd)

def negate(a: Rational) -> Rational:
  match a:
    case Fraction{n, d}: Fraction{I.negate(n), d}

def subtract(a: Rational, b: Rational) -> RationalResult:
  add(a, negate(b))

def multiplyChecked(invalid: F.Flag, an: I.BigInt, ad: N.BigNat, bn: I.BigInt, bd: N.BigNat) -> RationalResult:
  match invalid:
    case F.Yes{}: ZeroDenominator{}
    case F.No{}: make(I.multiply(an, bn), N.multiply(ad, bd))

def multiply(a: Rational, b: Rational) -> RationalResult:
  match a:
    case Fraction{an, +ad}:
      match b:
        case Fraction{bn, +bd}: multiplyChecked(invalidEither(ad, bd), an, ad, bn, bd)

def divideChecked(invalid: F.Flag, an: I.BigInt, ad: N.BigNat, bn: I.BigInt, bd: N.BigNat) -> RationalResult:
  match invalid:
    case F.Yes{}: ZeroDenominator{}
    case F.No{}:
      match bn:
        case I.Integer{negative, magnitude}: make(I.multiply(an, I.make(negative, bd)), N.multiply(ad, magnitude))

def divide(a: Rational, b: Rational) -> RationalResult:
  match a:
    case Fraction{an, +ad}:
      match b:
        case Fraction{bn, +bd}: divideChecked(invalidEither(ad, bd), an, ad, bn, bd)

def roundingChoice(up: F.Flag, q: N.BigNat) -> N.BigNat:
  match up:
    case F.No{}: q
    case F.Yes{}: N.succ(q)

def nearestChoice(order: F.Ordering, tiesUp: F.Flag) -> F.Flag:
  match order:
    case F.Less{}: F.No{}
    case F.Same{}: tiesUp
    case F.More{}: F.Yes{}

def roundingIncrement(mode: RoundingMode, negative: F.Flag, +q: N.BigNat, +r: N.BigNat, d: N.BigNat) -> F.Flag:
  match mode:
    case Exact{}: F.No{}
    case TowardZero{}: F.No{}
    case Floor{}: F.and(negative, F.not(N.isZero(r)))
    case Ceiling{}: F.and(F.not(negative), F.not(N.isZero(r)))
    case HalfEven{}: nearestChoice(N.compare(N.shift(r), d), N.isOdd(q))
    case HalfAway{}: nearestChoice(N.compare(N.shift(r), d), F.Yes{})

def roundedValue(+value: I.BigInt, numerator: I.BigInt, +d: N.BigNat) -> RoundedResult:
  Rounded{value, I.subtract(numerator, I.multiplyNat(value, d)), d}

def exactResult(isExact: F.Flag, negative: F.Flag, q: N.BigNat, n: I.BigInt, d: N.BigNat) -> RoundedResult:
  match isExact:
    case F.No{}: Inexact{}
    case F.Yes{}: roundedValue(I.make(negative, q), n, d)

def roundingParts(mode: RoundingMode, parts: N.Division, +negative: F.Flag, n: I.BigInt, +d: N.BigNat) -> RoundedResult:
  match mode:
    case Exact{}:
      match parts:
        case N.DivisionByZero{}: RoundingZeroDenominator{}
        case N.Divided{q, r}: exactResult(N.isZero(r), negative, q, n, d)
    case TowardZero{}:
      match parts:
        case N.DivisionByZero{}: RoundingZeroDenominator{}
        case N.Divided{q, r}: roundedValue(I.make(negative, q), n, d)
    case Floor{}:
      match parts:
        case N.DivisionByZero{}: RoundingZeroDenominator{}
        case N.Divided{+q, r}:
          roundedValue(I.make(negative, roundingChoice(roundingIncrement(Floor{}, negative, q, r, d), q)), n, d)
    case Ceiling{}:
      match parts:
        case N.DivisionByZero{}: RoundingZeroDenominator{}
        case N.Divided{+q, r}:
          roundedValue(I.make(negative, roundingChoice(roundingIncrement(Ceiling{}, negative, q, r, d), q)), n, d)
    case HalfEven{}:
      match parts:
        case N.DivisionByZero{}: RoundingZeroDenominator{}
        case N.Divided{+q, r}:
          roundedValue(I.make(negative, roundingChoice(roundingIncrement(HalfEven{}, negative, q, r, d), q)), n, d)
    case HalfAway{}:
      match parts:
        case N.DivisionByZero{}: RoundingZeroDenominator{}
        case N.Divided{+q, r}:
          roundedValue(I.make(negative, roundingChoice(roundingIncrement(HalfAway{}, negative, q, r, d), q)), n, d)

def round(n: I.BigInt, +d: N.BigNat, mode: RoundingMode) -> RoundedResult:
  match n:
    case I.Integer{+negative, +magnitude}:
      roundingParts(mode, N.divmod(magnitude, d), negative, I.make(negative, magnitude), d)
