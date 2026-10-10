import ./BigNat.bend as N

# Unbounded mathematical naturals used only by specifications. Not the runtime
# money representation and not Base.Nat, whose compiled backend has a cap.
type Value is Data:
  VZero{}
  VSucc{prior: Value}

def add(a: Value, b: Value) -> Value:
  match a:
    case VZero{}: b
    case VSucc{rest}: VSucc{add(rest, b)}

def twice(a: Value) -> Value:
  match a:
    case VZero{}: VZero{}
    case VSucc{rest}: VSucc{VSucc{twice(rest)}}

def multiply(a: Value, +b: Value) -> Value:
  match a:
    case VZero{}: VZero{}
    case VSucc{rest}: add(b, multiply(rest, b))

def value(a: N.BigNat) -> Value:
  match a:
    case N.Zero{}: VZero{}
    case N.Even{rest}: twice(value(rest))
    case N.Odd{rest}: VSucc{twice(value(rest))}
