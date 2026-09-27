import ./Foundation.bend as F
import ./BigNat.bend as N

# A voucher uses the repository's paired nonnegative debit/credit model.
type Lines is Data:
  End{}
  Line{debit: N.BigNat, credit: N.BigNat, rest: Lines}

def debits(lines: Lines) -> N.BigNat:
  match lines:
    case End{}: N.Zero{}
    case Line{d, c, rest}: N.add(d, debits(rest))

def credits(lines: Lines) -> N.BigNat:
  match lines:
    case End{}: N.Zero{}
    case Line{d, c, rest}: N.add(c, credits(rest))

def validLines(lines: Lines) -> F.Flag:
  match lines:
    case End{}: F.Yes{}
    case Line{d, c, rest}:
      F.and(F.xor(N.isZero(d), N.isZero(c)), validLines(rest))

def atLeastTwo(lines: Lines) -> F.Flag:
  match lines:
    case End{}: F.No{}
    case Line{d, c, rest}:
      match rest:
        case End{}: F.No{}
        case Line{d2, c2, tail}: F.Yes{}

def reverse(lines: Lines) -> Lines:
  match lines:
    case End{}: End{}
    case Line{d, c, rest}: Line{c, d, reverse(rest)}

# Successful validation packages equal totals AND line shape AND cardinality.
# It does not claim to prove account membership, authorization or persistence.
type Voucher is Data:
  Voucher{lines: Lines,
    balanced: {debits(lines) == credits(lines) : N.BigNat},
    valid: {validLines(lines) == F.Yes{} : F.Flag},
    minimum: {atLeastTwo(lines) == F.Yes{} : F.Flag}}

type Validation is Data:
  Invalid{}
  Accepted{voucher: Voucher}

def admit(+lines: Lines,
  equality: N.Equality<debits(lines), credits(lines)>,
  valid: F.Check<validLines(lines)>,
  minimum: F.Check<atLeastTwo(lines)>) -> Validation:
  match equality:
    case N.Unequal{}: Invalid{}
    case N.Equal{p}:
      match valid:
        case F.Failed{}: Invalid{}
        case F.Passed{v}:
          match minimum:
            case F.Failed{}: Invalid{}
            case F.Passed{m}: Accepted{Voucher{lines, p, v, m}}

def validate(+lines: Lines) -> Validation:
  admit(lines, N.equality(debits(lines), credits(lines)), F.check(validLines(lines)), F.check(atLeastTwo(lines)))

# History is an immutable spine of individually certified vouchers.
type Journal is Data:
  EmptyJournal{}
  Posted{voucher: Voucher, previous: Journal}

def post(voucher: Voucher, history: Journal) -> Journal:
  Posted{voucher, history}

def previous(journal: Journal) -> Journal:
  match journal:
    case EmptyJournal{}: EmptyJournal{}
    case Posted{voucher, previous}: previous

def VoucherBalance(voucher: Voucher) -> Data:
  match voucher:
    case Voucher{lines, balance, valid, minimum}: {debits(lines) == credits(lines) : N.BigNat}

def VoucherLineShape(voucher: Voucher) -> Data:
  match voucher:
    case Voucher{lines, balance, valid, minimum}: {validLines(lines) == F.Yes{} : F.Flag}

def VoucherMinimum(voucher: Voucher) -> Data:
  match voucher:
    case Voucher{lines, balance, valid, minimum}: {atLeastTwo(lines) == F.Yes{} : F.Flag}
