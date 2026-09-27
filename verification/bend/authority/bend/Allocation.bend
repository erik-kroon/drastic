import ./Foundation.bend as F
import ./BigNat.bend as N

# An allocation certificate covers both capacities independently. An immutable
# application identity still controls whether this effect has already run.
type Allocation is Data:
  Allocation{amount: N.BigNat, sourceBefore: N.BigNat, targetBefore: N.BigNat,
    sourceAfter: N.BigNat, targetAfter: N.BigNat,
    sourceConserved: {N.add(amount, sourceAfter) == N.normalize(sourceBefore) : N.BigNat},
    targetConserved: {N.add(amount, targetAfter) == N.normalize(targetBefore) : N.BigNat}}

type Result is Data:
  ZeroAmount{}
  CapacityExceeded{}
  ConservationFailure{}
  Allocated{allocation: Allocation}

def certify(+amount: N.BigNat, +source: N.BigNat, +target: N.BigNat,
  +sourceAfter: N.BigNat, +targetAfter: N.BigNat,
  sourceProof: N.Equality<N.add(amount, sourceAfter), N.normalize(source)>,
  targetProof: N.Equality<N.add(amount, targetAfter), N.normalize(target)>) -> Result:
  match sourceProof:
    case N.Unequal{}: ConservationFailure{}
    case N.Equal{s}:
      match targetProof:
        case N.Unequal{}: ConservationFailure{}
        case N.Equal{t}: Allocated{Allocation{amount, source, target, sourceAfter, targetAfter, s, t}}

def remainders(sourceResult: N.Subtraction, targetResult: N.Subtraction,
  +amount: N.BigNat, +source: N.BigNat, +target: N.BigNat) -> Result:
  match sourceResult:
    case N.Underflow{}: CapacityExceeded{}
    case N.Difference{+sa}:
      match targetResult:
        case N.Underflow{}: CapacityExceeded{}
        case N.Difference{+ta}:
          certify(amount, source, target, sa, ta,
            N.equality(N.add(amount, sa), N.normalize(source)),
            N.equality(N.add(amount, ta), N.normalize(target)))

def nonzero(zero: F.Flag, +amount: N.BigNat, +source: N.BigNat, +target: N.BigNat) -> Result:
  match zero:
    case F.Yes{}: ZeroAmount{}
    case F.No{}: remainders(N.subtract(source, amount), N.subtract(target, amount), amount, source, target)

def allocate(+amount: N.BigNat, source: N.BigNat, target: N.BigNat) -> Result:
  nonzero(N.isZero(amount), N.normalize(amount), N.normalize(source), N.normalize(target))

type Restored is Data:
  Restored{source: N.BigNat, target: N.BigNat}

# Reverses exactly this immutable allocation's arithmetic. Not an idempotency
# authority: the host must consume a unique unallocation effect once.
def restore(allocation: Allocation) -> Restored:
  match allocation:
    case Allocation{+amount, source, target, sa, ta, sp, tp}:
      Restored{N.add(amount, sa), N.add(amount, ta)}

def SourceConservation(allocation: Allocation) -> Data:
  match allocation:
    case Allocation{amount, source, target, sa, ta, sp, tp}:
      {N.add(amount, sa) == N.normalize(source) : N.BigNat}

def TargetConservation(allocation: Allocation) -> Data:
  match allocation:
    case Allocation{amount, source, target, sa, ta, sp, tp}:
      {N.add(amount, ta) == N.normalize(target) : N.BigNat}

def restoredSource(restored: Restored) -> N.BigNat:
  match restored:
    case Restored{source, target}: source

def restoredTarget(restored: Restored) -> N.BigNat:
  match restored:
    case Restored{source, target}: target

def SourceRestoration(+allocation: Allocation) -> Data:
  match allocation:
    case Allocation{amount, source, target, sa, ta, sp, tp}:
      {restoredSource(restore(allocation)) == N.normalize(source) : N.BigNat}

def TargetRestoration(+allocation: Allocation) -> Data:
  match allocation:
    case Allocation{amount, source, target, sa, ta, sp, tp}:
      {restoredTarget(restore(allocation)) == N.normalize(target) : N.BigNat}
