import ./Foundation.bend as F
import ./BigNat.bend as N
import ./Meaning.bend as M
import ./RefinementLaws.bend as Laws

def Laws.add_zero(a):
  match a:
    case M.VZero{}: {==}
    case M.VSucc{p}: F.eqCong(M.Value, M.Value, x => M.VSucc{x}, M.add(p, M.VZero{}), p, Laws.add_zero(p))

def Laws.add_succ(a, b):
  match a:
    case M.VZero{}: {==}
    case M.VSucc{p}: F.eqCong(M.Value, M.Value, x => M.VSucc{x}, M.add(p, M.VSucc{b}), M.VSucc{M.add(p, b)}, Laws.add_succ(p, b))

def Laws.add_assoc(a, b, c):
  match a:
    case M.VZero{}: {==}
    case M.VSucc{p}: F.eqCong(M.Value, M.Value, x => M.VSucc{x}, M.add(M.add(p, b), c), M.add(p, M.add(b, c)), Laws.add_assoc(p, b, c))

def Laws.add_comm(a, b):
  match a:
    case M.VZero{}: F.eqSym(M.Value, M.add(b, M.VZero{}), b, Laws.add_zero(b))
    case M.VSucc{p}:
      F.eqTrans(M.Value, M.VSucc{M.add(p, b)}, M.VSucc{M.add(b, p)}, M.add(b, M.VSucc{p}),
        F.eqCong(M.Value, M.Value, x => M.VSucc{x}, M.add(p, b), M.add(b, p), Laws.add_comm(p, b)),
        F.eqSym(M.Value, M.add(b, M.VSucc{p}), M.VSucc{M.add(b, p)}, Laws.add_succ(b, p)))

def Laws.twice_add(a, b):
  match a:
    case M.VZero{}: {==}
    case M.VSucc{p}: F.eqCong(M.Value, M.Value, x => M.VSucc{M.VSucc{x}}, M.twice(M.add(p, b)), M.add(M.twice(p), M.twice(b)), Laws.twice_add(p, b))

def Laws.twice_sum(a):
  match a:
    case M.VZero{}: {==}
    case M.VSucc{p}:
      F.eqTrans(M.Value, M.VSucc{M.VSucc{M.twice(p)}}, M.VSucc{M.VSucc{M.add(p, p)}}, M.VSucc{M.add(p, M.VSucc{p})},
        F.eqCong(M.Value, M.Value, x => M.VSucc{M.VSucc{x}}, M.twice(p), M.add(p, p), Laws.twice_sum(p)),
        F.eqCong(M.Value, M.Value, x => M.VSucc{x}, M.VSucc{M.add(p, p)}, M.add(p, M.VSucc{p}),
          F.eqSym(M.Value, M.add(p, M.VSucc{p}), M.VSucc{M.add(p, p)}, Laws.add_succ(p, p))))

def Laws.multiply_add(a, b, c):
  match a:
    case M.VZero{}: {==}
    case M.VSucc{p}:
      F.eqTrans(M.Value, M.add(c, M.multiply(M.add(p, b), c)), M.add(c, M.add(M.multiply(p, c), M.multiply(b, c))), M.add(M.add(c, M.multiply(p, c)), M.multiply(b, c)),
        F.eqCong(M.Value, M.Value, x => M.add(c, x), M.multiply(M.add(p, b), c), M.add(M.multiply(p, c), M.multiply(b, c)), Laws.multiply_add(p, b, c)),
        F.eqSym(M.Value, M.add(M.add(c, M.multiply(p, c)), M.multiply(b, c)), M.add(c, M.add(M.multiply(p, c), M.multiply(b, c))), Laws.add_assoc(c, M.multiply(p, c), M.multiply(b, c))))

def Laws.multiply_twice(a, b):
  F.eqTrans(M.Value, M.multiply(M.twice(a), b), M.multiply(M.add(a, a), b), M.twice(M.multiply(a, b)),
    F.eqCong(M.Value, M.Value, x => M.multiply(x, b), M.twice(a), M.add(a, a), Laws.twice_sum(a)),
    F.eqTrans(M.Value, M.multiply(M.add(a, a), b), M.add(M.multiply(a, b), M.multiply(a, b)), M.twice(M.multiply(a, b)),
      Laws.multiply_add(a, a, b), F.eqSym(M.Value, M.twice(M.multiply(a, b)), M.add(M.multiply(a, b), M.multiply(a, b)), Laws.twice_sum(M.multiply(a, b)))))

def Laws.shift_value(a):
  match a:
    case N.Zero{}: {==}
    case N.Even{p}: {==}
    case N.Odd{p}: {==}

def Laws.normalization_value(a):
  match a:
    case N.Zero{}: {==}
    case N.Even{p}:
      F.eqTrans(M.Value, M.value(N.shift(N.normalize(p))), M.twice(M.value(N.normalize(p))), M.twice(M.value(p)),
        Laws.shift_value(N.normalize(p)), F.eqCong(M.Value, M.Value, x => M.twice(x), M.value(N.normalize(p)), M.value(p), Laws.normalization_value(p)))
    case N.Odd{p}: F.eqCong(M.Value, M.Value, x => M.VSucc{M.twice(x)}, M.value(N.normalize(p)), M.value(p), Laws.normalization_value(p))

def Laws.increment_value(a):
  match a:
    case N.Zero{}: {==}
    case N.Even{p}: {==}
    case N.Odd{p}:
      F.eqTrans(M.Value, M.value(N.shift(N.increment(p))), M.twice(M.value(N.increment(p))), M.twice(M.VSucc{M.value(p)}),
        Laws.shift_value(N.increment(p)), F.eqCong(M.Value, M.Value, x => M.twice(x), M.value(N.increment(p)), M.VSucc{M.value(p)}, Laws.increment_value(p)))

def Laws.plus_value(a, b):
  match a:
    case N.Zero{}: {==}
    case N.Even{x}:
      match b:
        case N.Zero{}:
          F.eqTrans(M.Value, M.value(N.shift(x)), M.twice(M.value(x)), M.add(M.twice(M.value(x)), M.VZero{}),
            Laws.shift_value(x), F.eqSym(M.Value, M.add(M.twice(M.value(x)), M.VZero{}), M.twice(M.value(x)), Laws.add_zero(M.twice(M.value(x)))))
        case N.Even{y}:
          F.eqTrans(M.Value, M.value(N.shift(N.plus(x, y))), M.twice(M.value(N.plus(x, y))), M.add(M.twice(M.value(x)), M.twice(M.value(y))),
            Laws.shift_value(N.plus(x, y)),
            F.eqTrans(M.Value, M.twice(M.value(N.plus(x, y))), M.twice(M.add(M.value(x), M.value(y))), M.add(M.twice(M.value(x)), M.twice(M.value(y))),
              F.eqCong(M.Value, M.Value, v => M.twice(v), M.value(N.plus(x, y)), M.add(M.value(x), M.value(y)), Laws.plus_value(x, y)), Laws.twice_add(M.value(x), M.value(y))))
        case N.Odd{y}:
          F.eqTrans(M.Value, M.VSucc{M.twice(M.value(N.plus(x, y)))}, M.VSucc{M.add(M.twice(M.value(x)), M.twice(M.value(y)))}, M.add(M.twice(M.value(x)), M.VSucc{M.twice(M.value(y))}),
            F.eqCong(M.Value, M.Value, v => M.VSucc{v}, M.twice(M.value(N.plus(x, y))), M.add(M.twice(M.value(x)), M.twice(M.value(y))),
              F.eqTrans(M.Value, M.twice(M.value(N.plus(x, y))), M.twice(M.add(M.value(x), M.value(y))), M.add(M.twice(M.value(x)), M.twice(M.value(y))),
                F.eqCong(M.Value, M.Value, v => M.twice(v), M.value(N.plus(x, y)), M.add(M.value(x), M.value(y)), Laws.plus_value(x, y)), Laws.twice_add(M.value(x), M.value(y)))),
            F.eqSym(M.Value, M.add(M.twice(M.value(x)), M.VSucc{M.twice(M.value(y))}), M.VSucc{M.add(M.twice(M.value(x)), M.twice(M.value(y)))}, Laws.add_succ(M.twice(M.value(x)), M.twice(M.value(y)))))
    case N.Odd{x}:
      match b:
        case N.Zero{}: F.eqSym(M.Value, M.add(M.VSucc{M.twice(M.value(x))}, M.VZero{}), M.VSucc{M.twice(M.value(x))}, Laws.add_zero(M.VSucc{M.twice(M.value(x))}))
        case N.Even{y}:
          F.eqCong(M.Value, M.Value, v => M.VSucc{v}, M.twice(M.value(N.plus(x, y))), M.add(M.twice(M.value(x)), M.twice(M.value(y))),
            F.eqTrans(M.Value, M.twice(M.value(N.plus(x, y))), M.twice(M.add(M.value(x), M.value(y))), M.add(M.twice(M.value(x)), M.twice(M.value(y))),
              F.eqCong(M.Value, M.Value, v => M.twice(v), M.value(N.plus(x, y)), M.add(M.value(x), M.value(y)), Laws.plus_value(x, y)), Laws.twice_add(M.value(x), M.value(y))))
        case N.Odd{y}:
          F.eqTrans(M.Value, M.value(N.shift(N.increment(N.plus(x, y)))), M.twice(M.VSucc{M.value(N.plus(x, y))}), M.add(M.VSucc{M.twice(M.value(x))}, M.VSucc{M.twice(M.value(y))}),
            F.eqTrans(M.Value, M.value(N.shift(N.increment(N.plus(x, y)))), M.twice(M.value(N.increment(N.plus(x, y)))), M.twice(M.VSucc{M.value(N.plus(x, y))}),
              Laws.shift_value(N.increment(N.plus(x, y))), F.eqCong(M.Value, M.Value, v => M.twice(v), M.value(N.increment(N.plus(x, y))), M.VSucc{M.value(N.plus(x, y))}, Laws.increment_value(N.plus(x, y)))),
            F.eqTrans(M.Value, M.VSucc{M.VSucc{M.twice(M.value(N.plus(x, y)))}}, M.VSucc{M.VSucc{M.add(M.twice(M.value(x)), M.twice(M.value(y)))}}, M.VSucc{M.add(M.twice(M.value(x)), M.VSucc{M.twice(M.value(y))})},
              F.eqCong(M.Value, M.Value, v => M.VSucc{M.VSucc{v}}, M.twice(M.value(N.plus(x, y))), M.add(M.twice(M.value(x)), M.twice(M.value(y))),
                F.eqTrans(M.Value, M.twice(M.value(N.plus(x, y))), M.twice(M.add(M.value(x), M.value(y))), M.add(M.twice(M.value(x)), M.twice(M.value(y))),
                  F.eqCong(M.Value, M.Value, v => M.twice(v), M.value(N.plus(x, y)), M.add(M.value(x), M.value(y)), Laws.plus_value(x, y)), Laws.twice_add(M.value(x), M.value(y)))),
              F.eqCong(M.Value, M.Value, v => M.VSucc{v}, M.VSucc{M.add(M.twice(M.value(x)), M.twice(M.value(y)))}, M.add(M.twice(M.value(x)), M.VSucc{M.twice(M.value(y))}),
                F.eqSym(M.Value, M.add(M.twice(M.value(x)), M.VSucc{M.twice(M.value(y))}), M.VSucc{M.add(M.twice(M.value(x)), M.twice(M.value(y)))}, Laws.add_succ(M.twice(M.value(x)), M.twice(M.value(y)))))))

def Laws.addition_value(a, b):
  F.eqTrans(M.Value, M.value(N.add(a, b)), M.add(M.value(N.normalize(a)), M.value(N.normalize(b))), M.add(M.value(a), M.value(b)),
    Laws.plus_value(N.normalize(a), N.normalize(b)),
    F.eqTrans(M.Value, M.add(M.value(N.normalize(a)), M.value(N.normalize(b))), M.add(M.value(a), M.value(N.normalize(b))), M.add(M.value(a), M.value(b)),
      F.eqCong(M.Value, M.Value, v => M.add(v, M.value(N.normalize(b))), M.value(N.normalize(a)), M.value(a), Laws.normalization_value(a)),
      F.eqCong(M.Value, M.Value, v => M.add(M.value(a), v), M.value(N.normalize(b)), M.value(b), Laws.normalization_value(b))))

def Laws.times_value(a, b):
  match a:
    case N.Zero{}: {==}
    case N.Even{x}:
      F.eqTrans(M.Value, M.value(N.shift(N.times(x, b))), M.twice(M.multiply(M.value(x), M.value(b))), M.multiply(M.twice(M.value(x)), M.value(b)),
        F.eqTrans(M.Value, M.value(N.shift(N.times(x, b))), M.twice(M.value(N.times(x, b))), M.twice(M.multiply(M.value(x), M.value(b))),
          Laws.shift_value(N.times(x, b)), F.eqCong(M.Value, M.Value, v => M.twice(v), M.value(N.times(x, b)), M.multiply(M.value(x), M.value(b)), Laws.times_value(x, b))),
        F.eqSym(M.Value, M.multiply(M.twice(M.value(x)), M.value(b)), M.twice(M.multiply(M.value(x), M.value(b))), Laws.multiply_twice(M.value(x), M.value(b))))
    case N.Odd{x}:
      F.eqTrans(M.Value, M.value(N.plus(b, N.shift(N.times(x, b)))), M.add(M.value(b), M.value(N.shift(N.times(x, b)))), M.add(M.value(b), M.multiply(M.twice(M.value(x)), M.value(b))),
        Laws.plus_value(b, N.shift(N.times(x, b))),
        F.eqCong(M.Value, M.Value, v => M.add(M.value(b), v), M.value(N.shift(N.times(x, b))), M.multiply(M.twice(M.value(x)), M.value(b)),
          F.eqTrans(M.Value, M.value(N.shift(N.times(x, b))), M.twice(M.multiply(M.value(x), M.value(b))), M.multiply(M.twice(M.value(x)), M.value(b)),
            F.eqTrans(M.Value, M.value(N.shift(N.times(x, b))), M.twice(M.value(N.times(x, b))), M.twice(M.multiply(M.value(x), M.value(b))),
              Laws.shift_value(N.times(x, b)), F.eqCong(M.Value, M.Value, v => M.twice(v), M.value(N.times(x, b)), M.multiply(M.value(x), M.value(b)), Laws.times_value(x, b))),
            F.eqSym(M.Value, M.multiply(M.twice(M.value(x)), M.value(b)), M.twice(M.multiply(M.value(x), M.value(b))), Laws.multiply_twice(M.value(x), M.value(b))))))

def Laws.multiplication_value(a, b):
  F.eqTrans(M.Value, M.value(N.multiply(a, b)), M.multiply(M.value(N.normalize(a)), M.value(N.normalize(b))), M.multiply(M.value(a), M.value(b)),
    Laws.times_value(N.normalize(a), N.normalize(b)),
    F.eqTrans(M.Value, M.multiply(M.value(N.normalize(a)), M.value(N.normalize(b))), M.multiply(M.value(a), M.value(N.normalize(b))), M.multiply(M.value(a), M.value(b)),
      F.eqCong(M.Value, M.Value, v => M.multiply(v, M.value(N.normalize(b))), M.value(N.normalize(a)), M.value(a), Laws.normalization_value(a)),
      F.eqCong(M.Value, M.Value, v => M.multiply(M.value(a), v), M.value(N.normalize(b)), M.value(b), Laws.normalization_value(b))))
