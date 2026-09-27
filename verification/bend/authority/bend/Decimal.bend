import ./Foundation.bend as F
import ./BigNat.bend as N

# Decimal digits are typed constructors, not machine-word integers. The JS wire
# adapter performs strict string syntax validation before constructing digits.
type Digit is Data:
  D0{}
  D1{}
  D2{}
  D3{}
  D4{}
  D5{}
  D6{}
  D7{}
  D8{}
  D9{}

type Digits is Data:
  EndDigits{}
  Digit{digit: Digit, rest: Digits}

type DigitResult is Data:
  InvalidDigit{}
  DecimalDigit{digit: Digit}

type Conversion is Data:
  Converting{number: N.BigNat, digits: Digits}
  Converted{digits: Digits}
  ConversionExhausted{}
  ConversionInvalid{}

def digitValue(d: Digit) -> N.BigNat:
  match d:
    case D0{}: N.Zero{}
    case D1{}: N.Odd{N.Zero{}}
    case D2{}: N.Even{N.Odd{N.Zero{}}}
    case D3{}: N.Odd{N.Odd{N.Zero{}}}
    case D4{}: N.Even{N.Even{N.Odd{N.Zero{}}}}
    case D5{}: N.Odd{N.Even{N.Odd{N.Zero{}}}}
    case D6{}: N.Even{N.Odd{N.Odd{N.Zero{}}}}
    case D7{}: N.Odd{N.Odd{N.Odd{N.Zero{}}}}
    case D8{}: N.Even{N.Even{N.Even{N.Odd{N.Zero{}}}}}
    case D9{}: N.Odd{N.Even{N.Even{N.Odd{N.Zero{}}}}}

def ten() -> N.BigNat:
  N.Even{N.Odd{N.Even{N.Odd{N.Zero{}}}}}

def fromDigitsAcc(digits: Digits, acc: N.BigNat) -> N.BigNat:
  match digits:
    case EndDigits{}: acc
    case Digit{digit, rest}: fromDigitsAcc(rest, N.add(N.multiply(acc, ten()), digitValue(digit)))

def fromDigits(digits: Digits) -> N.BigNat:
  fromDigitsAcc(digits, N.Zero{})

def toDigit(n: N.BigNat) -> DigitResult:
  match n:
    case N.Zero{}: DecimalDigit{D0{}}
    case N.Odd{N.Zero{}}: DecimalDigit{D1{}}
    case N.Even{N.Odd{N.Zero{}}}: DecimalDigit{D2{}}
    case N.Odd{N.Odd{N.Zero{}}}: DecimalDigit{D3{}}
    case N.Even{N.Even{N.Odd{N.Zero{}}}}: DecimalDigit{D4{}}
    case N.Odd{N.Even{N.Odd{N.Zero{}}}}: DecimalDigit{D5{}}
    case N.Even{N.Odd{N.Odd{N.Zero{}}}}: DecimalDigit{D6{}}
    case N.Odd{N.Odd{N.Odd{N.Zero{}}}}: DecimalDigit{D7{}}
    case N.Even{N.Even{N.Even{N.Odd{N.Zero{}}}}}: DecimalDigit{D8{}}
    case N.Odd{N.Even{N.Even{N.Odd{N.Zero{}}}}}: DecimalDigit{D9{}}
    case other: InvalidDigit{}

def decimalStepDigit(result: DigitResult, q: N.BigNat, digits: Digits) -> Conversion:
  match result:
    case InvalidDigit{}: ConversionInvalid{}
    case DecimalDigit{d}: Converting{q, Digit{d, digits}}

def decimalStepParts(parts: N.Parts, digits: Digits) -> Conversion:
  match parts:
    case N.Parts{q, r}: decimalStepDigit(toDigit(r), q, digits)

def decimalStep(number: N.BigNat, digits: Digits) -> Conversion:
  decimalStepParts(N.divideBits(number, ten()), digits)

def decimalEnd(state: Conversion) -> Conversion:
  match state:
    case Converting{number, digits}:
      match number:
        case N.Zero{}: Converted{digits}
        case N.Even{h}: ConversionExhausted{}
        case N.Odd{h}: ConversionExhausted{}
    case Converted{digits}: Converted{digits}
    case ConversionExhausted{}: ConversionExhausted{}
    case ConversionInvalid{}: ConversionInvalid{}

def toDigitsLoop(fuel: F.Count, state: Conversion) -> Conversion:
  match fuel:
    case F.Stop{}: decimalEnd(state)
    case F.Tick{rest}:
      match state:
        case Converting{number, digits}:
          match number:
            case N.Zero{}: Converted{digits}
            case N.Even{h}: toDigitsLoop(rest, decimalStep(N.Even{h}, digits))
            case N.Odd{h}: toDigitsLoop(rest, decimalStep(N.Odd{h}, digits))
        case Converted{digits}: Converted{digits}
        case ConversionExhausted{}: ConversionExhausted{}
        case ConversionInvalid{}: ConversionInvalid{}

def toDigitsNormalized(number: N.BigNat) -> Conversion:
  match number:
    case N.Zero{}: Converted{Digit{D0{}, EndDigits{}}}
    case N.Even{+h}: toDigitsLoop(F.Tick{N.bitCount(h)}, Converting{N.Even{h}, EndDigits{}})
    case N.Odd{+h}: toDigitsLoop(F.Tick{N.bitCount(h)}, Converting{N.Odd{h}, EndDigits{}})

def toDigits(number: N.BigNat) -> Conversion:
  toDigitsNormalized(N.normalize(number))
