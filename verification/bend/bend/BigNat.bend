import ./Foundation.bend as F

# Little-endian binary digits. Raw constructors can contain redundant high zero
# bits; every public arithmetic entry normalizes and every arithmetic result is
# canonical. Numeric magnitude never passes through a native U32, F32 or Nat.
type BigNat is Data:
  Zero{}
  Even{high: BigNat}
  Odd{high: BigNat}

type Subtraction is Data:
  Underflow{}
  Difference{value: BigNat}

type Parts is Data:
  Parts{quotient: BigNat, remainder: BigNat}

type Division is Data:
  DivisionByZero{}
  Divided{quotient: BigNat, remainder: BigNat}

type GcdResult is Data:
  GcdExhausted{}
  GcdValue{value: BigNat}

def shift(n: BigNat) -> BigNat:
  match n:
    case Zero{}: Zero{}
    case Even{h}: Even{Even{h}}
    case Odd{h}: Even{Odd{h}}

def normalize(n: BigNat) -> BigNat:
  match n:
    case Zero{}: Zero{}
    case Even{h}: shift(normalize(h))
    case Odd{h}: Odd{normalize(h)}

def isZeroRaw(n: BigNat) -> F.Flag:
  match n:
    case Zero{}: F.Yes{}
    case Even{h}: isZeroRaw(h)
    case Odd{h}: F.No{}

def isZero(n: BigNat) -> F.Flag:
  isZeroRaw(n)

def isOdd(n: BigNat) -> F.Flag:
  match n:
    case Zero{}: F.No{}
    case Even{h}: F.No{}
    case Odd{h}: F.Yes{}

def increment(n: BigNat) -> BigNat:
  match n:
    case Zero{}: Odd{Zero{}}
    case Even{h}: Odd{h}
    case Odd{h}: shift(increment(h))

def succ(n: BigNat) -> BigNat:
  increment(normalize(n))

def plus(a: BigNat, b: BigNat) -> BigNat:
  match a:
    case Zero{}: b
    case Even{x}:
      match b:
        case Zero{}: shift(x)
        case Even{y}: shift(plus(x, y))
        case Odd{y}: Odd{plus(x, y)}
    case Odd{x}:
      match b:
        case Zero{}: Odd{x}
        case Even{y}: Odd{plus(x, y)}
        case Odd{y}: shift(increment(plus(x, y)))

def add(a: BigNat, b: BigNat) -> BigNat:
  plus(normalize(a), normalize(b))

def compareRaw(a: BigNat, b: BigNat) -> F.Ordering:
  match a:
    case Zero{}:
      match b:
        case Zero{}: F.Same{}
        case Even{y}: F.Less{}
        case Odd{y}: F.Less{}
    case Even{x}:
      match b:
        case Zero{}: F.More{}
        case Even{y}: compareRaw(x, y)
        case Odd{y}: F.chooseOrder(compareRaw(x, y), F.Less{})
    case Odd{x}:
      match b:
        case Zero{}: F.More{}
        case Even{y}: F.chooseOrder(compareRaw(x, y), F.More{})
        case Odd{y}: compareRaw(x, y)

def compare(a: BigNat, b: BigNat) -> F.Ordering:
  compareRaw(normalize(a), normalize(b))

def equal(a: BigNat, b: BigNat) -> F.Flag:
  F.isSame(compare(a, b))

# Internal bit subtraction. The caller establishes a >= b. A borrow is threaded
# through the low-to-high traversal. No wraparound result is a public success.
def minusBits(a: BigNat, b: BigNat, borrow: F.Flag) -> BigNat:
  match a:
    case Zero{}: Zero{}
    case Even{x}:
      match b:
        case Zero{}:
          match borrow:
            case F.No{}: shift(minusBits(x, Zero{}, F.No{}))
            case F.Yes{}: Odd{minusBits(x, Zero{}, F.Yes{})}
        case Even{y}:
          match borrow:
            case F.No{}: shift(minusBits(x, y, F.No{}))
            case F.Yes{}: Odd{minusBits(x, y, F.Yes{})}
        case Odd{y}:
          match borrow:
            case F.No{}: Odd{minusBits(x, y, F.Yes{})}
            case F.Yes{}: shift(minusBits(x, y, F.Yes{}))
    case Odd{x}:
      match b:
        case Zero{}:
          match borrow:
            case F.No{}: Odd{minusBits(x, Zero{}, F.No{})}
            case F.Yes{}: shift(minusBits(x, Zero{}, F.No{}))
        case Even{y}:
          match borrow:
            case F.No{}: Odd{minusBits(x, y, F.No{})}
            case F.Yes{}: shift(minusBits(x, y, F.No{}))
        case Odd{y}:
          match borrow:
            case F.No{}: shift(minusBits(x, y, F.No{}))
            case F.Yes{}: Odd{minusBits(x, y, F.Yes{})}

def subtractOrdered(order: F.Ordering, a: BigNat, b: BigNat) -> Subtraction:
  match order:
    case F.Less{}: Underflow{}
    case F.Same{}: Difference{Zero{}}
    case F.More{}: Difference{minusBits(a, b, F.No{})}

def subtract(+a: BigNat, +b: BigNat) -> Subtraction:
  subtractOrdered(compare(a, b), normalize(a), normalize(b))

def monusOrdered(order: F.Ordering, a: BigNat, b: BigNat) -> BigNat:
  match order:
    case F.Less{}: Zero{}
    case F.Same{}: Zero{}
    case F.More{}: minusBits(a, b, F.No{})

# Explicit truncated subtraction, distinct from checked subtract.
def monus(+a: BigNat, +b: BigNat) -> BigNat:
  monusOrdered(compare(a, b), normalize(a), normalize(b))

def times(a: BigNat, +b: BigNat) -> BigNat:
  match a:
    case Zero{}: Zero{}
    case Even{x}: shift(times(x, b))
    case Odd{x}: plus(b, shift(times(x, b)))

def multiply(a: BigNat, b: BigNat) -> BigNat:
  times(normalize(a), normalize(b))

def appendBit(bit: F.Flag, high: BigNat) -> BigNat:
  match bit:
    case F.No{}: shift(high)
    case F.Yes{}: Odd{high}

def divisionCompare(order: F.Ordering, q: BigNat, r: BigNat, d: BigNat) -> Parts:
  match order:
    case F.Less{}: Parts{q, r}
    case F.Same{}: Parts{increment(q), Zero{}}
    case F.More{}: Parts{increment(q), minusBits(r, d, F.No{})}

def divisionChoose(q: BigNat, +r: BigNat, +d: BigNat) -> Parts:
  divisionCompare(compareRaw(r, d), q, r, d)

def divisionStep(parts: Parts, d: BigNat, bit: F.Flag) -> Parts:
  match parts:
    case Parts{q, r}: divisionChoose(shift(q), appendBit(bit, r), d)

# Binary long division, structurally recursive on dividend bits. The
# denominator is canonical and nonzero at this internal boundary.
def divideBits(n: BigNat, +d: BigNat) -> Parts:
  match n:
    case Zero{}: Parts{Zero{}, Zero{}}
    case Even{h}: divisionStep(divideBits(h, d), d, F.No{})
    case Odd{h}: divisionStep(divideBits(h, d), d, F.Yes{})

def divided(parts: Parts) -> Division:
  match parts:
    case Parts{q, r}: Divided{q, r}

def divideDenominator(d: BigNat, n: BigNat) -> Division:
  match d:
    case Zero{}: DivisionByZero{}
    case Even{h}: divided(divideBits(n, Even{h}))
    case Odd{h}: divided(divideBits(n, Odd{h}))

def divmod(n: BigNat, d: BigNat) -> Division:
  divideDenominator(normalize(d), normalize(n))

def bitCount(n: BigNat) -> F.Count:
  match n:
    case Zero{}: F.Stop{}
    case Even{h}: F.Tick{bitCount(h)}
    case Odd{h}: F.Tick{bitCount(h)}

def getRemainder(parts: Parts) -> BigNat:
  match parts:
    case Parts{q, r}: r

def getQuotient(parts: Parts) -> BigNat:
  match parts:
    case Parts{q, r}: q

# Fuel is explicit: failure to finish is never reported as a GCD.
def gcdLoop(fuel: F.Count, a: BigNat, b: BigNat) -> GcdResult:
  match fuel:
    case F.Stop{}: GcdExhausted{}
    case F.Tick{rest}:
      match b:
        case Zero{}: GcdValue{a}
        case Even{+h}:
          gcdLoop(rest, Even{h}, getRemainder(divideBits(a, Even{h})))
        case Odd{+h}:
          gcdLoop(rest, Odd{h}, getRemainder(divideBits(a, Odd{h})))

def gcd(+a: BigNat, +b: BigNat) -> GcdResult:
  +bits = F.countAdd(bitCount(a), bitCount(b))
  gcdLoop(F.Tick{F.Tick{F.countAdd(bits, bits)}}, normalize(a), normalize(b))

# A positive equality decision carries real evidence about the two values.
# Unlike numeric compare, this checks raw structural identity. Public arithmetic
# outputs are normalized, so those outputs have one representation per value.
type Equality<-left: BigNat, -right: BigNat> is Data:
  Unequal{}
  Equal{proof: {left == right : BigNat}}

def evenEquality(-a: BigNat, -b: BigNat, e: Equality<a, b>) -> Equality<Even{a}, Even{b}>:
  match e:
    case Unequal{}: Unequal{}
    case Equal{p}: Equal{F.eqCong(BigNat, BigNat, x => Even{x}, a, b, p)}

def oddEquality(-a: BigNat, -b: BigNat, e: Equality<a, b>) -> Equality<Odd{a}, Odd{b}>:
  match e:
    case Unequal{}: Unequal{}
    case Equal{p}: Equal{F.eqCong(BigNat, BigNat, x => Odd{x}, a, b, p)}

def equality(a: BigNat, b: BigNat) -> Equality<a, b>:
  match a:
    case Zero{}:
      match b:
        case Zero{}: Equal{{==}}
        case Even{y}: Unequal{}
        case Odd{y}: Unequal{}
    case Even{x}:
      match b:
        case Zero{}: Unequal{}
        case Even{y}: evenEquality(x, y, equality(x, y))
        case Odd{y}: Unequal{}
    case Odd{x}:
      match b:
        case Zero{}: Unequal{}
        case Even{y}: Unequal{}
        case Odd{y}: oddEquality(x, y, equality(x, y))
