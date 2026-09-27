import ./Foundation.bend as F
import ./BigNat.bend as N
import ./BigInt.bend as I

# Equal allocation of a supplied remaining basis. No dates or prior postings are
# selected here. Magnitude remainder goes in the final supplied period.
type Amounts is Data:
  NoAmounts{}
  Amount{value: I.BigInt, rest: Amounts}

type Result is Data:
  NoPeriods{}
  Scheduled{amounts: Amounts}

def countValue(count: F.Count) -> N.BigNat:
  match count:
    case F.Stop{}: N.Zero{}
    case F.Tick{rest}: N.succ(countValue(rest))

def distribute(count: F.Count, +negative: F.Flag, +quotient: N.BigNat, remainder: N.BigNat) -> Amounts:
  match count:
    case F.Stop{}: NoAmounts{}
    case F.Tick{rest}:
      match rest:
        case F.Stop{}: Amount{I.make(negative, N.add(quotient, remainder)), NoAmounts{}}
        case F.Tick{next}: Amount{I.make(negative, quotient), distribute(F.Tick{next}, negative, quotient, remainder)}

def divided(parts: N.Division, negative: F.Flag, periods: F.Count) -> Result:
  match parts:
    case N.DivisionByZero{}: NoPeriods{}
    case N.Divided{quotient, remainder}: Scheduled{distribute(periods, negative, quotient, remainder)}

def equal(amount: I.BigInt, +periods: F.Count) -> Result:
  match amount:
    case I.Integer{negative, magnitude}: divided(N.divmod(magnitude, countValue(periods)), negative, periods)

def total(rows: Amounts) -> I.BigInt:
  match rows:
    case NoAmounts{}: I.zero()
    case Amount{value, rest}: I.add(value, total(rest))
