# Small self-contained foundation. No native integer or foreign arithmetic.
type Flag is Data:
  No{}
  Yes{}

type Ordering is Data:
  Less{}
  Same{}
  More{}

# Structural fuel is for resource bounds, never a representation of money.
type Count is Data:
  Stop{}
  Tick{rest: Count}

def not(x: Flag) -> Flag:
  match x:
    case No{}: Yes{}
    case Yes{}: No{}

def and(x: Flag, y: Flag) -> Flag:
  match x:
    case No{}: No{}
    case Yes{}: y

def xor(x: Flag, y: Flag) -> Flag:
  match x:
    case No{}: y
    case Yes{}: not(y)

def chooseOrder(x: Ordering, tie: Ordering) -> Ordering:
  match x:
    case Less{}: Less{}
    case Same{}: tie
    case More{}: More{}

def isSame(x: Ordering) -> Flag:
  match x:
    case Same{}: Yes{}
    case Less{}: No{}
    case More{}: No{}

def countAdd(a: Count, b: Count) -> Count:
  match a:
    case Stop{}: b
    case Tick{p}: Tick{countAdd(p, b)}

# Equality eliminators. Their type arguments are erased, not assumed axioms.
def eqSym(-A: Data, -a: A, -b: A, e: {a == b : A}) -> {b == a : A}:
  %e : {_ == a : A}
  {==}

def eqTrans(-A: Data, -a: A, -b: A, -c: A, ab: {a == b : A}, bc: {b == c : A}) -> {a == c : A}:
  %bc : {a == _ : A}
  ab

def eqCong(-A: Data, -B: Data, -f: A -> B, -a: A, -b: A, e: {a == b : A}) -> {f(a) == f(b) : B}:
  %e : {f(a) == f(_) : B}
  {==}

type Check<-value: Flag> is Data:
  Failed{}
  Passed{proof: {value == Yes{} : Flag}}

def check(value: Flag) -> Check<value>:
  match value:
    case No{}: Failed{}
    case Yes{}: Passed{{==}}
