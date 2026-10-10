import ./Foundation.bend as F
import ./BigNat.bend as N
import ./BigInt.bend as I
import ./Rational.bend as R
import ./Ledger.bend as L
import ./Allocation.bend as A
import ./LAWS.bend as Laws
import ./RefinementProof.bend as Refined

def Laws.normalize_shift(n):
  match n:
    case N.Zero{}: {==}
    case N.Even{+h}: {==}
    case N.Odd{h}: {==}

def Laws.normalize_idempotent(n):
  match n:
    case N.Zero{}: {==}
    case N.Even{+h}:
      F.eqTrans(N.BigNat,
        N.normalize(N.shift(N.normalize(h))),
        N.shift(N.normalize(N.normalize(h))),
        N.shift(N.normalize(h)),
        Laws.normalize_shift(N.normalize(h)),
        F.eqCong(N.BigNat, N.BigNat, x => N.shift(x),
          N.normalize(N.normalize(h)), N.normalize(h), Laws.normalize_idempotent(h)))
    case N.Odd{h}:
      F.eqCong(N.BigNat, N.BigNat, x => N.Odd{x},
        N.normalize(N.normalize(h)), N.normalize(h), Laws.normalize_idempotent(h))

def Laws.add_zero_left(n):
  {==}

def Laws.plus_shift_zero(n):
  match n:
    case N.Zero{}: {==}
    case N.Even{+h}: {==}
    case N.Odd{h}: {==}

def Laws.add_zero_right(n):
  match n:
    case N.Zero{}: {==}
    case N.Even{+h}: Laws.plus_shift_zero(N.normalize(h))
    case N.Odd{h}: {==}

def Laws.reversal_involution(lines):
  match lines:
    case L.End{}: {==}
    case L.Line{d, c, rest}:
      F.eqCong(L.Lines, L.Lines, x => L.Line{d, c, x},
        L.reverse(L.reverse(rest)), rest, Laws.reversal_involution(rest))

def Laws.reversal_debits(lines):
  match lines:
    case L.End{}: {==}
    case L.Line{d, c, rest}:
      F.eqCong(N.BigNat, N.BigNat, x => N.add(c, x),
        L.debits(L.reverse(rest)), L.credits(rest), Laws.reversal_debits(rest))

def Laws.reversal_credits(lines):
  match lines:
    case L.End{}: {==}
    case L.Line{d, c, rest}:
      F.eqCong(N.BigNat, N.BigNat, x => N.add(d, x),
        L.credits(L.reverse(rest)), L.debits(rest), Laws.reversal_credits(rest))

def Laws.reversal_balanced(lines, balanced):
  F.eqTrans(N.BigNat, L.debits(L.reverse(lines)), L.credits(lines), L.credits(L.reverse(lines)),
    Laws.reversal_debits(lines),
    F.eqTrans(N.BigNat, L.credits(lines), L.debits(lines), L.credits(L.reverse(lines)),
      F.eqSym(N.BigNat, L.debits(lines), L.credits(lines), balanced),
      F.eqSym(N.BigNat, L.credits(L.reverse(lines)), L.debits(lines), Laws.reversal_credits(lines))))

def Laws.append_preserves_history(voucher, history):
  {==}

def Laws.voucher_balance(voucher):
  match voucher:
    case L.Voucher{lines, balance, valid, minimum}: balance

def Laws.voucher_line_shape(voucher):
  match voucher:
    case L.Voucher{lines, balance, valid, minimum}: valid

def Laws.voucher_minimum(voucher):
  match voucher:
    case L.Voucher{lines, balance, valid, minimum}: minimum

def Laws.allocation_source_conservation(allocation):
  match allocation:
    case A.Allocation{amount, source, target, sa, ta, sp, tp}: sp

def Laws.allocation_target_conservation(allocation):
  match allocation:
    case A.Allocation{amount, source, target, sa, ta, sp, tp}: tp

def Laws.restoration_source(allocation):
  match allocation:
    case A.Allocation{amount, source, target, sa, ta, sp, tp}: sp

def Laws.restoration_target(allocation):
  match allocation:
    case A.Allocation{amount, source, target, sa, ta, sp, tp}: tp

def Laws.floor_exact_no_increment(q, d):
  {==}

def Laws.half_even_tie(q):
  {==}

def Laws.zero_has_no_negative_sign(sign):
  {==}
