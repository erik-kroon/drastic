import ./BigNat.bend as N
import ./Meaning.bend as M

law add_zero:
  for +a: M.Value
  {M.add(a, M.VZero{}) == a : M.Value}

law add_succ:
  for +a: M.Value
  for +b: M.Value
  {M.add(a, M.VSucc{b}) == M.VSucc{M.add(a, b)} : M.Value}

law add_assoc:
  for +a: M.Value
  for +b: M.Value
  for +c: M.Value
  {M.add(M.add(a, b), c) == M.add(a, M.add(b, c)) : M.Value}

law add_comm:
  for +a: M.Value
  for +b: M.Value
  {M.add(a, b) == M.add(b, a) : M.Value}

law twice_add:
  for +a: M.Value
  for +b: M.Value
  {M.twice(M.add(a, b)) == M.add(M.twice(a), M.twice(b)) : M.Value}

law twice_sum:
  for +a: M.Value
  {M.twice(a) == M.add(a, a) : M.Value}

law multiply_add:
  for +a: M.Value
  for +b: M.Value
  for +c: M.Value
  {M.multiply(M.add(a, b), c) == M.add(M.multiply(a, c), M.multiply(b, c)) : M.Value}

law multiply_twice:
  for +a: M.Value
  for +b: M.Value
  {M.multiply(M.twice(a), b) == M.twice(M.multiply(a, b)) : M.Value}

law shift_value:
  for +a: N.BigNat
  {M.value(N.shift(a)) == M.twice(M.value(a)) : M.Value}

law normalization_value:
  for +a: N.BigNat
  {M.value(N.normalize(a)) == M.value(a) : M.Value}

law increment_value:
  for +a: N.BigNat
  {M.value(N.increment(a)) == M.VSucc{M.value(a)} : M.Value}

law plus_value:
  for +a: N.BigNat
  for +b: N.BigNat
  {M.value(N.plus(a, b)) == M.add(M.value(a), M.value(b)) : M.Value}

law addition_value:
  for +a: N.BigNat
  for +b: N.BigNat
  {M.value(N.add(a, b)) == M.add(M.value(a), M.value(b)) : M.Value}

law times_value:
  for +a: N.BigNat
  for +b: N.BigNat
  {M.value(N.times(a, b)) == M.multiply(M.value(a), M.value(b)) : M.Value}

law multiplication_value:
  for +a: N.BigNat
  for +b: N.BigNat
  {M.value(N.multiply(a, b)) == M.multiply(M.value(a), M.value(b)) : M.Value}
