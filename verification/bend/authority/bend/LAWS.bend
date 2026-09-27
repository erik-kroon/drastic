import ./Foundation.bend as F
import ./BigNat.bend as N
import ./BigInt.bend as I
import ./Rational.bend as R
import ./Ledger.bend as L
import ./Allocation.bend as A

# This is the human-reviewable proof surface. It is deliberately narrower than
# a claim that the ERP, its compiler or every arithmetic algorithm is verified.

law normalize_shift:
  for n: N.BigNat
  {N.normalize(N.shift(n)) == N.shift(N.normalize(n)) : N.BigNat}

law normalize_idempotent:
  for n: N.BigNat
  {N.normalize(N.normalize(n)) == N.normalize(n) : N.BigNat}

law add_zero_left:
  for n: N.BigNat
  {N.add(N.Zero{}, n) == N.normalize(n) : N.BigNat}

law plus_shift_zero:
  for n: N.BigNat
  {N.plus(N.shift(n), N.Zero{}) == N.shift(n) : N.BigNat}

law add_zero_right:
  for n: N.BigNat
  {N.add(n, N.Zero{}) == N.normalize(n) : N.BigNat}

law reversal_involution:
  for lines: L.Lines
  {L.reverse(L.reverse(lines)) == lines : L.Lines}

law reversal_debits:
  for lines: L.Lines
  {L.debits(L.reverse(lines)) == L.credits(lines) : N.BigNat}

law reversal_credits:
  for lines: L.Lines
  {L.credits(L.reverse(lines)) == L.debits(lines) : N.BigNat}

law reversal_balanced:
  for +lines: L.Lines
  for balanced: {L.debits(lines) == L.credits(lines) : N.BigNat}
  {L.debits(L.reverse(lines)) == L.credits(L.reverse(lines)) : N.BigNat}

law append_preserves_history:
  for voucher: L.Voucher
  for history: L.Journal
  {L.previous(L.post(voucher, history)) == history : L.Journal}

# Safety of accepted certificates, not completeness of their validators.
law voucher_balance:
  for voucher: L.Voucher
  L.VoucherBalance(voucher)

law voucher_line_shape:
  for voucher: L.Voucher
  L.VoucherLineShape(voucher)

law voucher_minimum:
  for voucher: L.Voucher
  L.VoucherMinimum(voucher)

law allocation_source_conservation:
  for allocation: A.Allocation
  A.SourceConservation(allocation)

law allocation_target_conservation:
  for allocation: A.Allocation
  A.TargetConservation(allocation)

law restoration_source:
  for allocation: A.Allocation
  A.SourceRestoration(allocation)

law restoration_target:
  for allocation: A.Allocation
  A.TargetRestoration(allocation)

# The negative exact-division regression found in actual.ts cannot occur in
# this decision: no remainder means floor must not increment the magnitude.
law floor_exact_no_increment:
  for q: N.BigNat
  for d: N.BigNat
  {R.roundingIncrement(R.Floor{}, F.Yes{}, q, N.Zero{}, d) == F.No{} : F.Flag}

law half_even_tie:
  for q: N.BigNat
  {R.nearestChoice(F.Same{}, N.isOdd(q)) == N.isOdd(q) : F.Flag}

law zero_has_no_negative_sign:
  for sign: F.Flag
  {I.make(sign, N.Zero{}) == I.zero() : I.BigInt}
