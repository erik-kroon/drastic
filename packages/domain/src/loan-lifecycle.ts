import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description, Identifier } from "./values";
import { MinorUnits, SignedMinorUnits } from "./money";
import { assertBalancedJournal, type PurchaseJournalLine } from "./purchasing";

export const LoanFailureCode = Schema.Literals([
  "NegativePrincipal",
  "UnsupportedConvention",
  "EmptyCoverage",
  "IncompleteTimeline",
  "RepaymentExceedsPrincipal",
  "RepaymentExceedsInterest",
  "SplitMismatch",
  "UnbalancedJournal",
]);

export type LoanFailureCode = typeof LoanFailureCode.Type;

export const LoanFailure = Schema.Struct({
  code: LoanFailureCode,
  message: Description,
});

export type LoanFailure = typeof LoanFailure.Type;

export type Checked<A> = Result.Result<A, LoanFailure>;

function fail(code: LoanFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function amount(value: bigint) {
  return value.toString();
}

function gcd(a: bigint, b: bigint): bigint {
  const mag = a < 0n ? -a : a;
  const other = b < 0n ? -b : b;

  if (other === 0n) return mag;

  return gcd(other, mag % other);
}

export const DayCountConvention = Schema.Literals(["ACT/365F", "30/360"]);

export type DayCountConvention = typeof DayCountConvention.Type;

export const PrincipalEvent = Schema.Struct({
  effectiveOn: AccountingDate,
  deltaMinor: SignedMinorUnits,
});

export type PrincipalEvent = typeof PrincipalEvent.Type;

export const RateSegment = Schema.Struct({
  effectiveOn: AccountingDate,
  rateNumerator: Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,9})$/)),
  rateDenominator: Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,9}$/)),
});

export type RateSegment = typeof RateSegment.Type;

// reviewed opening + evidenced drawdowns - effective principal
// repayments + supported owned corrections, all effective before date.
// The profile's payment-effective-date convention is applied by the
// caller when stamping each event; it is never guessed from arrival.
export function principalAt(
  openingMinor: string,
  events: ReadonlyArray<PrincipalEvent>,
  date: string,
): Checked<string> {
  let principal = BigInt(openingMinor);

  for (const event of events) {
    if (event.effectiveOn < date) principal += BigInt(event.deltaMinor);
  }

  if (principal < 0n) {
    return fail("NegativePrincipal", "The principal timeline cannot go negative.");
  }

  return Result.succeed(amount(principal));
}

function daysBetween(from: string, to: string, convention: DayCountConvention): Checked<bigint> {
  if (convention === "ACT/365F") {
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

    if (!Number.isInteger(days) || days < 0) {
      return fail("EmptyCoverage", "A coverage segment needs valid ordered dates.");
    }

    return Result.succeed(BigInt(days));
  }

  const f = from.split("-").map(Number);
  const t = to.split("-").map(Number);

  if (f.length !== 3 || t.length !== 3 || f.some(Number.isNaN) || t.some(Number.isNaN)) {
    return fail("EmptyCoverage", "A coverage segment needs valid ordered dates.");
  }

  const fDay = Math.min(f[2] ?? 0, 30);
  const tDay = Math.min(t[2] ?? 0, 30);

  const days =
    (t[0] ?? 0) * 360 + (t[1] ?? 0) * 30 + tDay - ((f[0] ?? 0) * 360 + (f[1] ?? 0) * 30 + fDay);

  if (days < 0) {
    return fail("EmptyCoverage", "A coverage segment needs valid ordered dates.");
  }

  return Result.succeed(BigInt(days));
}

function yearLength(convention: DayCountConvention): bigint {
  return convention === "ACT/365F" ? 365n : 360n;
}

export const AccrualInput = Schema.Struct({
  coverageStartOn: AccountingDate,
  coverageEndExclusiveOn: AccountingDate,
  // Complete principal and rate timelines as of the cutoff. Different
  // explicit rates across a boundary split into exact rational segments
  // before any rounding happens.
  principalEvents: Schema.Array(PrincipalEvent),
  openingPrincipalMinor: MinorUnits,
  rateSegments: Schema.Array(RateSegment).check(Schema.isMinLength(1)),
  convention: DayCountConvention,
  priorEffectiveMinor: SignedMinorUnits,
  loanId: Identifier,
});

export type AccrualInput = typeof AccrualInput.Type;

export const AccrualWitnessSegment = Schema.Struct({
  fromOn: AccountingDate,
  toExclusiveOn: AccountingDate,
  principalMinor: MinorUnits,
  rateNumerator: RateSegment.fields.rateNumerator,
  rateDenominator: RateSegment.fields.rateDenominator,
  days: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type AccrualWitnessSegment = typeof AccrualWitnessSegment.Type;

export const InterestCalculation = Schema.Struct({
  loanId: Identifier,
  targetMinor: SignedMinorUnits,
  deltaMinor: SignedMinorUnits,
  priorEffectiveMinor: SignedMinorUnits,
  segments: Schema.Array(AccrualWitnessSegment),
});

export type InterestCalculation = typeof InterestCalculation.Type;

// The cumulative target is rounded half-up exactly once from the exact
// rational sum — never per day. Accruing the same coverage twice yields
// delta 0 (a replay, not a second charge). A backdated principal or rate
// change recomputes over stable coverage; its delta is explicit and prior
// statements are preserved by the caller.
export function calculateInterest(input: AccrualInput): Checked<InterestCalculation> {
  if (input.coverageStartOn >= input.coverageEndExclusiveOn) {
    return fail("EmptyCoverage", "Interest coverage needs start before end.");
  }

  const boundaries = new Set<string>([input.coverageStartOn, input.coverageEndExclusiveOn]);

  for (const event of input.principalEvents) {
    if (
      event.effectiveOn > input.coverageStartOn &&
      event.effectiveOn < input.coverageEndExclusiveOn
    ) {
      boundaries.add(event.effectiveOn);
    }
  }

  for (const segment of input.rateSegments) {
    if (
      segment.effectiveOn > input.coverageStartOn &&
      segment.effectiveOn < input.coverageEndExclusiveOn
    ) {
      boundaries.add(segment.effectiveOn);
    }
  }

  const ordered = [...boundaries].sort();
  const rates = [...input.rateSegments].sort((a, b) => (a.effectiveOn < b.effectiveOn ? -1 : 1));

  if (new Set(rates.map((rate) => rate.effectiveOn)).size !== rates.length) {
    return fail("IncompleteTimeline", "An effective date must have exactly one evidenced rate.");
  }

  let numerator = 0n;
  let denominator = 1n;
  const witness: Array<AccrualWitnessSegment> = [];

  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const from = ordered[index];
    const to = ordered[index + 1];

    if (from === undefined || to === undefined) {
      return fail("IncompleteTimeline", "A coverage boundary is missing.");
    }

    const principal = principalAt(input.openingPrincipalMinor, input.principalEvents, to);

    if (Result.isFailure(principal)) {
      return Result.fail(principal.failure);
    }

    let rate: RateSegment | undefined;

    for (const candidate of rates) {
      if (candidate.effectiveOn <= from) rate = candidate;
    }

    if (rate === undefined) {
      return fail("IncompleteTimeline", "No applicable rate covers the segment.");
    }

    const days = daysBetween(from, to, input.convention);

    if (Result.isFailure(days)) {
      return Result.fail(days.failure);
    }

    const termNumerator = BigInt(principal.success) * BigInt(rate.rateNumerator) * days.success;
    const termDenominator = BigInt(rate.rateDenominator) * yearLength(input.convention);

    numerator = numerator * termDenominator + termNumerator * denominator;
    denominator *= termDenominator;

    const divisor = gcd(numerator, denominator);

    numerator /= divisor;
    denominator /= divisor;

    witness.push({
      fromOn: from,
      toExclusiveOn: to,
      principalMinor: principal.success,
      rateNumerator: rate.rateNumerator,
      rateDenominator: rate.rateDenominator,
      days: Number(days.success),
    });
  }

  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const target = quotient + ((magnitude % denominator) * 2n >= denominator ? 1n : 0n);
  const rounded = negative ? -target : target;
  const delta = rounded - BigInt(input.priorEffectiveMinor);

  return Result.succeed({
    loanId: input.loanId,
    targetMinor: amount(rounded),
    deltaMinor: amount(delta),
    priorEffectiveMinor: input.priorEffectiveMinor,
    segments: witness,
  });
}

export const AccrualRoles = Schema.Struct({
  interestExpenseAccountId: Identifier,
  accruedInterestLiabilityAccountId: Identifier,
});

export type AccrualRoles = typeof AccrualRoles.Type;

// Debit interest expense, credit accrued interest liability. A zero
// delta (same-coverage replay) yields no journal and consumes no
// voucher; a negative delta needs an approved correction reason.
export function compileAccrualJournal(
  deltaMinor: string,
  roles: AccrualRoles,
  correctionApproved: boolean,
): Checked<ReadonlyArray<PurchaseJournalLine>> {
  const delta = BigInt(deltaMinor);

  if (delta === 0n) return Result.succeed([]);

  if (delta < 0n && !correctionApproved) {
    return fail("SplitMismatch", "A negative accrual delta needs an approved correction reason.");
  }

  const journal: Array<PurchaseJournalLine> = [];

  if (delta > 0n) {
    journal.push({
      sourceLineId: null,
      accountId: roles.interestExpenseAccountId,
      debitMinor: amount(delta),
      creditMinor: "0",
      description: "Accrued loan interest",
    });

    journal.push({
      sourceLineId: null,
      accountId: roles.accruedInterestLiabilityAccountId,
      debitMinor: "0",
      creditMinor: amount(delta),
      description: "Accrued interest liability",
    });
  } else {
    journal.push({
      sourceLineId: null,
      accountId: roles.accruedInterestLiabilityAccountId,
      debitMinor: amount(-delta),
      creditMinor: "0",
      description: "Accrual correction",
    });

    journal.push({
      sourceLineId: null,
      accountId: roles.interestExpenseAccountId,
      debitMinor: "0",
      creditMinor: amount(-delta),
      description: "Accrual correction",
    });
  }

  const finished = assertBalancedJournal(journal, 2);

  if (Result.isFailure(finished)) {
    return fail("UnbalancedJournal", finished.failure.message);
  }

  return Result.succeed(finished.success);
}

export const RepaymentInput = Schema.Struct({
  principalRemainingMinor: MinorUnits,
  interestRemainingMinor: MinorUnits,
  principalPartMinor: MinorUnits,
  interestPartMinor: MinorUnits,
  feePartMinor: MinorUnits,
  cashMinor: MinorUnits,
  principalLiabilityAccountId: Identifier,
  interestLiabilityAccountId: Identifier,
  feeExpenseAccountId: Identifier,
  bankAccountId: Identifier,
});

export type RepaymentInput = typeof RepaymentInput.Type;

// The split is the explicit reviewed principal/interest/fee allocation
// or the agreement's qualified deterministic waterfall, resolved by the
// caller. The parts must equal the actual cash amount exactly.
export function compileRepayment(
  input: RepaymentInput,
): Checked<ReadonlyArray<PurchaseJournalLine>> {
  if (BigInt(input.principalPartMinor) > BigInt(input.principalRemainingMinor)) {
    return fail("RepaymentExceedsPrincipal", "The principal part exceeds the remaining principal.");
  }

  if (BigInt(input.interestPartMinor) > BigInt(input.interestRemainingMinor)) {
    return fail(
      "RepaymentExceedsInterest",
      "The interest part exceeds the recognized interest; accrue the missing part first.",
    );
  }

  const parts =
    BigInt(input.principalPartMinor) + BigInt(input.interestPartMinor) + BigInt(input.feePartMinor);

  if (parts !== BigInt(input.cashMinor)) {
    return fail(
      "SplitMismatch",
      "Principal, interest and fee parts must equal the actual cash amount.",
    );
  }

  const journal: Array<PurchaseJournalLine> = [];

  const push = (accountId: string, debit: bigint, description: string) => {
    if (debit === 0n) return;

    journal.push({
      sourceLineId: null,
      accountId,
      debitMinor: amount(debit),
      creditMinor: "0",
      description,
    });
  };

  push(input.principalLiabilityAccountId, BigInt(input.principalPartMinor), "Repay loan principal");
  push(input.interestLiabilityAccountId, BigInt(input.interestPartMinor), "Pay loan interest");
  push(input.feeExpenseAccountId, BigInt(input.feePartMinor), "Repayment fee");

  if (BigInt(input.cashMinor) === 0n) {
    return fail("SplitMismatch", "A repayment needs a positive cash amount.");
  }

  journal.push({
    sourceLineId: null,
    accountId: input.bankAccountId,
    debitMinor: "0",
    creditMinor: input.cashMinor,
    description: "Loan repayment cash",
  });

  const finished = assertBalancedJournal(journal, 2);

  if (Result.isFailure(finished)) {
    return fail("UnbalancedJournal", finished.failure.message);
  }

  return Result.succeed(finished.success);
}

export const PrincipalAdoption = Schema.Struct({
  ledgerDeltaMinor: MinorUnits,
});

export type PrincipalAdoption = typeof PrincipalAdoption.Type;

// Adopting an already-posted shareholder principal supplies the opening
// loan basis with evidence and no new journal: ledger delta 0.
export function adoptPostedPrincipal(): PrincipalAdoption {
  return { ledgerDeltaMinor: "0" };
}
