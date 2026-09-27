import ./Foundation.bend as F
import ./BigNat.bend as N

# PRY-33: exact covering subsets of full eligible remaining capacities.
# Scope, uniqueness of IDs and matching sign/currency/scale are validated by the
# host. The host maps stable sorted resource IDs to these exact integer indexes.
type Candidates is Data:
  NoCandidates{}
  Candidate{id: N.BigNat, amount: N.BigNat, rest: Candidates}

type Selection is Data:
  NothingSelected{}
  Selected{id: N.BigNat, amount: N.BigNat, rest: Selection}

type Solutions is Data:
  NoneFound{}
  OneFound{first: Selection}
  TwoFound{first: Selection, second: Selection}

type Tasks is Data:
  NoTasks{}
  Task{remaining: N.BigNat, candidates: Candidates, slots: F.Count,
    selected: Selection, rest: Tasks}

type State is Data:
  Running{tasks: Tasks, solutions: Solutions, visited: F.Count}
  Complete{solutions: Solutions, visited: F.Count}
  Ambiguous{first: Selection, second: Selection, visited: F.Count}
  Incomplete{solutions: Solutions, visited: F.Count}

def discovered(solutions: Solutions, found: Selection, rest: Tasks, visited: F.Count) -> State:
  match solutions:
    case NoneFound{}: Running{rest, OneFound{found}, visited}
    case OneFound{first}: Ambiguous{first, found, visited}
    case TwoFound{first, second}: Ambiguous{first, second, visited}

def includeResult(subtraction: N.Subtraction, +id: N.BigNat, +amount: N.BigNat,
  +tail: Candidates, nextSlots: F.Count, +picked: Selection,
  without: Tasks, found: Solutions, visited: F.Count) -> State:
  match subtraction:
    case N.Underflow{}: Running{without, found, visited}
    case N.Difference{remaining}:
      Running{Task{remaining, tail, nextSlots, Selected{id, amount, picked}, without}, found, visited}

def expand(candidates: Candidates, slots: F.Count, +remaining: N.BigNat,
  +picked: Selection, rest: Tasks, found: Solutions, visited: F.Count) -> State:
  match candidates:
    case NoCandidates{}: Running{rest, found, visited}
    case Candidate{id, +amount, +tail}:
      match slots:
        case F.Stop{}: Running{rest, found, visited}
        case F.Tick{+nextSlots}:
          includeResult(N.subtract(remaining, amount), id, amount, tail, nextSlots, picked,
            Task{remaining, tail, F.Tick{nextSlots}, picked, rest}, found, visited)

def advance(zero: F.Flag, remaining: N.BigNat, candidates: Candidates, slots: F.Count,
  picked: Selection, rest: Tasks, found: Solutions, visited: F.Count) -> State:
  match zero:
    case F.Yes{}: discovered(found, picked, rest, visited)
    case F.No{}: expand(candidates, slots, remaining, picked, rest, found, visited)

def exhausted(state: State) -> State:
  match state:
    case Running{tasks, found, visited}:
      match tasks:
        case NoTasks{}: Complete{found, visited}
        case Task{remaining, candidates, slots, picked, rest}: Incomplete{found, visited}
    case Complete{found, visited}: Complete{found, visited}
    case Ambiguous{a, b, visited}: Ambiguous{a, b, visited}
    case Incomplete{found, visited}: Incomplete{found, visited}

# One global node budget. It is consumed once per popped task and is never
# copied between branches. Search order is deterministic but not a ranking.
def search(fuel: F.Count, state: State) -> State:
  match fuel:
    case F.Stop{}: exhausted(state)
    case F.Tick{restFuel}:
      match state:
        case Running{tasks, found, visited}:
          match tasks:
            case NoTasks{}: Complete{found, visited}
            case Task{+remaining, candidates, slots, picked, rest}:
              search(restFuel, advance(N.isZero(remaining), remaining, candidates, slots,
                picked, rest, found, F.Tick{visited}))
        case Complete{found, visited}: Complete{found, visited}
        case Ambiguous{a, b, visited}: Ambiguous{a, b, visited}
        case Incomplete{found, visited}: Incomplete{found, visited}

def solve(target: N.BigNat, candidates: Candidates, maxCardinality: F.Count, budget: F.Count) -> State:
  search(budget, Running{Task{N.normalize(target), candidates, maxCardinality,
    NothingSelected{}, NoTasks{}}, NoneFound{}, F.Stop{}})

def selectionSum(selection: Selection) -> N.BigNat:
  match selection:
    case NothingSelected{}: N.Zero{}
    case Selected{id, amount, rest}: N.add(amount, selectionSum(rest))
