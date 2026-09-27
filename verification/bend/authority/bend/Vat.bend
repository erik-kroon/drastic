import ./Foundation.bend as F
import ./BigNat.bend as N
import ./BigInt.bend as I
import ./Rational.bend as R

# Monetary projection of already-qualified contributions. Eligibility, source
# coverage, rule activation and filing authority remain OpenERP responsibilities.
type Box is Data:
  Basis05{}
  Output10{}
  Output11{}
  Output12{}
  Input48{}
  Net49{}

type Contributions is Data:
  NoContributions{}
  Contribution{box: Box, amount: I.BigInt, included: F.Flag, rest: Contributions}

type Total is Data:
  Total{present: F.Flag, amount: I.BigInt}

type Rows is Data:
  NoRows{}
  Row{box: Box, exact: I.BigInt, reported: I.BigInt, residual: I.BigInt, rest: Rows}

type Result is Data:
  InvalidFilingUnit{}
  InexactFiling{}
  Calculated{rows: Rows}

def sameBox(a: Box, b: Box) -> F.Flag:
  match a:
    case Basis05{}:
      match b:
        case Basis05{}: F.Yes{}
        case Output10{}: F.No{}
        case Output11{}: F.No{}
        case Output12{}: F.No{}
        case Input48{}: F.No{}
        case Net49{}: F.No{}
    case Output10{}:
      match b:
        case Basis05{}: F.No{}
        case Output10{}: F.Yes{}
        case Output11{}: F.No{}
        case Output12{}: F.No{}
        case Input48{}: F.No{}
        case Net49{}: F.No{}
    case Output11{}:
      match b:
        case Basis05{}: F.No{}
        case Output10{}: F.No{}
        case Output11{}: F.Yes{}
        case Output12{}: F.No{}
        case Input48{}: F.No{}
        case Net49{}: F.No{}
    case Output12{}:
      match b:
        case Basis05{}: F.No{}
        case Output10{}: F.No{}
        case Output11{}: F.No{}
        case Output12{}: F.Yes{}
        case Input48{}: F.No{}
        case Net49{}: F.No{}
    case Input48{}:
      match b:
        case Basis05{}: F.No{}
        case Output10{}: F.No{}
        case Output11{}: F.No{}
        case Output12{}: F.No{}
        case Input48{}: F.Yes{}
        case Net49{}: F.No{}
    case Net49{}:
      match b:
        case Basis05{}: F.No{}
        case Output10{}: F.No{}
        case Output11{}: F.No{}
        case Output12{}: F.No{}
        case Input48{}: F.No{}
        case Net49{}: F.Yes{}

def accumulate(selected: F.Flag, amount: I.BigInt, total: Total) -> Total:
  match selected:
    case F.No{}: total
    case F.Yes{}:
      match total:
        case Total{present, previous}: Total{F.Yes{}, I.add(amount, previous)}

def total(contributions: Contributions, +box: Box) -> Total:
  match contributions:
    case NoContributions{}: Total{F.No{}, I.zero()}
    case Contribution{ownBox, amount, included, rest}:
      accumulate(F.and(included, sameBox(ownBox, box)), amount, total(rest, box))

def attachRounded(rounded: R.RoundedResult, box: Box, exact: I.BigInt, tail: Result) -> Result:
  match rounded:
    case R.RoundingZeroDenominator{}: InvalidFilingUnit{}
    case R.Inexact{}: InexactFiling{}
    case R.Rounded{reported, residual, denominator}:
      match tail:
        case InvalidFilingUnit{}: InvalidFilingUnit{}
        case InexactFiling{}: InexactFiling{}
        case Calculated{rows}: Calculated{Row{box, exact, reported, residual, rows}}

def emit(total: Total, box: Box, unit: N.BigNat, mode: R.RoundingMode, tail: Result) -> Result:
  match total:
    case Total{present, +exact}:
      match present:
        case F.No{}: tail
        case F.Yes{}: attachRounded(R.round(exact, unit, mode), box, exact, tail)

def signedNetContribution(box: Box, value: I.BigInt) -> I.BigInt:
  match box:
    case Basis05{}: I.zero()
    case Output10{}: value
    case Output11{}: value
    case Output12{}: value
    case Input48{}: I.negate(value)
    case Net49{}: I.zero()

def exactNet(rows: Rows) -> I.BigInt:
  match rows:
    case NoRows{}: I.zero()
    case Row{box, exact, reported, residual, rest}:
      I.add(signedNetContribution(box, exact), exactNet(rest))

def reportedNet(rows: Rows) -> I.BigInt:
  match rows:
    case NoRows{}: I.zero()
    case Row{box, exact, reported, residual, rest}:
      I.add(signedNetContribution(box, reported), reportedNet(rest))

def appendNet(rows: Rows, exact: I.BigInt, reported: I.BigInt, residual: I.BigInt) -> Rows:
  match rows:
    case NoRows{}: Row{Net49{}, exact, reported, residual, NoRows{}}
    case Row{box, e, p, r, rest}: Row{box, e, p, r, appendNet(rest, exact, reported, residual)}

def addNetValues(rows: Rows, +exact: I.BigInt, +reported: I.BigInt, unit: N.BigNat) -> Rows:
  appendNet(rows, exact, reported, I.subtract(exact, I.multiplyNat(reported, unit)))

def addNet(result: Result, unit: N.BigNat, declareNet: F.Flag) -> Result:
  match result:
    case InvalidFilingUnit{}: InvalidFilingUnit{}
    case InexactFiling{}: InexactFiling{}
    case Calculated{+rows}:
      match declareNet:
        case F.No{}: Calculated{rows}
        case F.Yes{}: Calculated{addNetValues(rows, exactNet(rows), reportedNet(rows), unit)}

def calculateChecked(zeroUnit: F.Flag, +contributions: Contributions, +unit: N.BigNat,
  +mode: R.RoundingMode, declareNet: F.Flag) -> Result:
  match zeroUnit:
    case F.Yes{}: InvalidFilingUnit{}
    case F.No{}:
      addNet(
        emit(total(contributions, Basis05{}), Basis05{}, unit, mode,
        emit(total(contributions, Output10{}), Output10{}, unit, mode,
        emit(total(contributions, Output11{}), Output11{}, unit, mode,
        emit(total(contributions, Output12{}), Output12{}, unit, mode,
        emit(total(contributions, Input48{}), Input48{}, unit, mode,
        Calculated{NoRows{}}))))), unit, declareNet)

def calculate(contributions: Contributions, +unit: N.BigNat, mode: R.RoundingMode, declareNet: F.Flag) -> Result:
  calculateChecked(N.isZero(unit), contributions, N.normalize(unit), mode, declareNet)
