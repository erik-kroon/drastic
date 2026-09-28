import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Identifier } from "./values";
import { MinorUnits, SignedMinorUnits } from "./money";
import { CurrencyCode, CurrencyScale, PositiveRatePart } from "./exchange-rates";
import { cumulativeRelease, type RoundingMode } from "./purchasing";

// Pure foreign-currency cash holdings and transfers. NEXT-40 leaf: native
// cash balances with their book carrying values, distinct from foreign
// obligations. A SEK account receiving a foreign invoice payment is not a
// foreign-cash account merely because the source invoice used EUR.
//
// The initial profile permits nonnegative balances only; an overdraft needs
// another qualified profile. Foreign-to-foreign exchange refuses while
// foreign-to-book exchange works. Late valuation after a later withdrawal
// belongs to the NEXT-41 chain repair, not to a blind rewrite here. Cash
// mutation, once-only source identity and reconciliation stay with the
// banking/application owners.

export const ForeignCashFailureCode = Schema.Literals([
  "NegativeHolding",
  "NotForeignCashAccount",
  "OpeningMismatch",
  "ResidualCarryingWithoutUnits",
  "OverWithdrawal",
  "NonPositiveAmount",
  "AmountOutOfRange",
  "UnsupportedRounding",
  "UnsupportedExchange",
  "UnsupportedRate",
  "ConsumedHistoryValuation",
  "UnbalancedJournal",
]);

export type ForeignCashFailureCode = typeof ForeignCashFailureCode.Type;

export const ForeignCashFailure = Schema.Struct({
  code: ForeignCashFailureCode,
  message: Description,
});

export type ForeignCashFailure = typeof ForeignCashFailure.Type;

export type Checked<A> = Result.Result<A, ForeignCashFailure>;

function fail(code: ForeignCashFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function amount(value: bigint) {
  return value.toString();
}

// Every monetary input is an exact integer minor-unit string. A value that is
// not one, or that leaves the codec's own 38-digit posting bound, is a range
// failure instead of a coercion or an out-of-codec posting.
function minorAmount(value: string, subject: string): Checked<bigint> {
  if (!Schema.is(SignedMinorUnits)(value)) {
    return fail("AmountOutOfRange", `${subject} must be an exact minor-unit integer string.`);
  }

  const parsed = BigInt(value);
  const magnitude = amount(parsed < 0n ? -parsed : parsed);

  return Schema.is(MinorUnits)(magnitude)
    ? Result.succeed(parsed)
    : fail("AmountOutOfRange", `${subject} exceeds the money codec.`);
}

// A release, receipt or fee never moves backwards, and a quantity that has to
// move is positive. A negative settlement amount is refused rather than
// posting as the opposite entry.
function magnitude(value: string, subject: string, positive: boolean): Checked<bigint> {
  const parsed = minorAmount(value, subject);

  if (Result.isFailure(parsed)) return Result.fail(parsed.failure);

  if (parsed.success < 0n || (positive && parsed.success === 0n)) {
    return fail(
      "NonPositiveAmount",
      `${subject} must be ${positive ? "positive" : "nonnegative"} minor units.`,
    );
  }

  return Result.succeed(parsed.success);
}

export const CapacityVersion = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

export const ForeignCashAccount = Schema.Struct({
  sourceAccountId: Identifier,
  nativeCurrency: CurrencyCode,
  bookCurrency: CurrencyCode,
  nativeScale: CurrencyScale,
  reviewedOpeningNativeMinor: MinorUnits,
  reviewedOpeningCarryingMinor: MinorUnits,
});

export type ForeignCashAccount = typeof ForeignCashAccount.Type;

export const CashHoldingBasis = Schema.Struct({
  originalNativeMinor: MinorUnits,
  originalCarryingMinor: MinorUnits,
  consumedNativeMinor: MinorUnits,
  releasedCarryingMinor: MinorUnits,
  capacityVersion: CapacityVersion,
});

export type CashHoldingBasis = typeof CashHoldingBasis.Type;

export const RemainingHolding = Schema.Struct({
  nativeUnitsMinor: MinorUnits,
  carryingMinor: MinorUnits,
  capacityVersion: CapacityVersion,
});

export type RemainingHolding = typeof RemainingHolding.Type;

type Holding = { readonly native: bigint; readonly carrying: bigint };

function remainingHolding(basis: CashHoldingBasis): Holding {
  return {
    native: BigInt(basis.originalNativeMinor) - BigInt(basis.consumedNativeMinor),
    carrying: BigInt(basis.originalCarryingMinor) - BigInt(basis.releasedCarryingMinor),
  };
}

// The captured basis: original native units and carrying with their consumed
// and released parts. Remaining empty units with leftover carrying is a
// corrupt state, never a rounding tolerance. The captured capacity version
// travels with the remaining amounts so a later plan can be bound to it.
export function captureCashBasis(
  account: ForeignCashAccount,
  basis: CashHoldingBasis,
): Checked<RemainingHolding> {
  if (account.nativeCurrency === account.bookCurrency) {
    return fail(
      "NotForeignCashAccount",
      "A foreign-cash account must be denominated away from the book currency.",
    );
  }

  if (
    account.reviewedOpeningNativeMinor !== basis.originalNativeMinor ||
    account.reviewedOpeningCarryingMinor !== basis.originalCarryingMinor
  ) {
    return fail(
      "OpeningMismatch",
      "The captured basis must fold from the account's reviewed opening amounts.",
    );
  }

  const remaining = remainingHolding(basis);

  if (remaining.native < 0n || remaining.carrying < 0n) {
    return fail("NegativeHolding", "A cash holding cannot be negative in this profile.");
  }

  if (remaining.native === 0n && remaining.carrying !== 0n) {
    return fail(
      "ResidualCarryingWithoutUnits",
      "Empty native units with leftover carrying refuses instead of rounding away.",
    );
  }

  return Result.succeed({
    nativeUnitsMinor: amount(remaining.native),
    carryingMinor: amount(remaining.carrying),
    capacityVersion: basis.capacityVersion,
  });
}

export const CashWithdrawalPlan = Schema.Struct({
  nativeConsumedMinor: MinorUnits,
  carryingReleasedMinor: MinorUnits,
  capacityVersion: CapacityVersion,
});

export type CashWithdrawalPlan = typeof CashWithdrawalPlan.Type;

// Withdrawing native units releases carrying through the shared exact paired
// release: a full withdrawal consumes all remaining carrying with no residual
// öre, a partial one releases the exact proportional share. The plan echoes
// the basis capacity version it was computed against.
export function planCashWithdrawal(
  basis: CashHoldingBasis,
  withdrawNativeMinor: string,
  rounding: RoundingMode,
): Checked<CashWithdrawalPlan> {
  const requested = magnitude(withdrawNativeMinor, "A native withdrawal", true);

  if (Result.isFailure(requested)) return Result.fail(requested.failure);

  const remaining = remainingHolding(basis);

  if (remaining.native < 0n || remaining.carrying < 0n) {
    return fail("NegativeHolding", "A cash holding cannot be negative in this profile.");
  }

  if (requested.success > remaining.native) {
    return fail("OverWithdrawal", "The withdrawal exceeds the remaining native holding.");
  }

  const released = cumulativeRelease(
    BigInt(basis.originalCarryingMinor),
    BigInt(basis.originalNativeMinor),
    BigInt(basis.consumedNativeMinor),
    requested.success,
    rounding,
  );

  if (Result.isFailure(released)) {
    return fail("UnsupportedRounding", released.failure.message);
  }

  if (released.success > remaining.carrying) {
    return fail("OverWithdrawal", "The released carrying exceeds the remaining book carrying.");
  }

  return Result.succeed({
    nativeConsumedMinor: amount(requested.success),
    carryingReleasedMinor: amount(released.success),
    capacityVersion: basis.capacityVersion,
  });
}

export const ForeignCashJournalLine = Schema.Struct({
  sourceLineId: Schema.NullOr(Identifier),
  accountId: Identifier,
  debitMinor: MinorUnits,
  creditMinor: MinorUnits,
  description: Description,
});

export type ForeignCashJournalLine = typeof ForeignCashJournalLine.Type;

export const ForeignCashJournalLines = Schema.Array(ForeignCashJournalLine);

export type ForeignCashJournalLines = typeof ForeignCashJournalLines.Type;

type JournalLine = ForeignCashJournalLine;

function addSigned(
  lines: Array<JournalLine>,
  line: {
    readonly accountId: string;
    readonly signedMinor: bigint;
    readonly description: string;
  },
) {
  if (line.signedMinor === 0n) return;

  lines.push({
    sourceLineId: null,
    accountId: line.accountId,
    debitMinor: amount(line.signedMinor > 0n ? line.signedMinor : 0n),
    creditMinor: amount(line.signedMinor < 0n ? -line.signedMinor : 0n),
    description: line.description,
  });
}

// The realized result is the difference between the two book-currency
// magnitudes: a credit to gain when positive, a debit to loss when negative.
function realized(
  lines: Array<JournalLine>,
  gainAccountId: string,
  lossAccountId: string,
  difference: bigint,
) {
  addSigned(lines, {
    accountId: difference >= 0n ? gainAccountId : lossAccountId,
    signedMinor: -difference,
    description: difference >= 0n ? "Realized FX gain" : "Realized FX loss",
  });
}

// One chokepoint for every emitted journal: each line must satisfy the journal
// line schema, carry exactly one positive side, and the group must balance.
function balanced(lines: Array<JournalLine>, subject: string): Checked<ForeignCashJournalLines> {
  for (const line of lines) {
    if (!Schema.is(ForeignCashJournalLine)(line)) {
      return fail(
        "UnbalancedJournal",
        `${subject} lines need a bounded account reference and minor units.`,
      );
    }

    const oneSide =
      BigInt(line.debitMinor) > 0n
        ? BigInt(line.creditMinor) === 0n
        : BigInt(line.creditMinor) > 0n;

    if (!oneSide) {
      return fail("UnbalancedJournal", `${subject} lines need exactly one positive side.`);
    }
  }

  const net = lines.reduce(
    (sum, line) => sum + BigInt(line.debitMinor) - BigInt(line.creditMinor),
    0n,
  );

  return net === 0n
    ? Result.succeed(lines)
    : fail("UnbalancedJournal", `${subject} lines must balance exactly.`);
}

// Settling an already recognized same-native-currency payable from foreign
// cash: the payable carrying release and the cash holding release apply in
// one journal with the gain or loss between them.
export function compilePayableFromForeignCash(
  payableControlAccountId: string,
  cashControlAccountId: string,
  gainAccountId: string,
  lossAccountId: string,
  payableReleaseMinor: string,
  cashReleaseMinor: string,
): Checked<ForeignCashJournalLines> {
  const payable = magnitude(payableReleaseMinor, "A payable carrying release", false);

  if (Result.isFailure(payable)) return Result.fail(payable.failure);

  const cash = magnitude(cashReleaseMinor, "A cash carrying release", false);

  if (Result.isFailure(cash)) return Result.fail(cash.failure);

  const journal: Array<JournalLine> = [];

  addSigned(journal, {
    accountId: payableControlAccountId,
    signedMinor: payable.success,
    description: "Settle foreign payable",
  });
  addSigned(journal, {
    accountId: cashControlAccountId,
    signedMinor: -cash.success,
    description: "Release foreign cash",
  });
  realized(journal, gainAccountId, lossAccountId, payable.success - cash.success);

  return balanced(journal, "Foreign-cash settlement");
}

// An incoming receipt in foreign cash: the holding grows at the qualified
// receipt-date book value K while AR carrying releases bR.
export function receiveForeignCash(
  cashControlAccountId: string,
  receivableControlAccountId: string,
  gainAccountId: string,
  lossAccountId: string,
  receiptBookValueMinor: string,
  receivableReleaseMinor: string,
): Checked<ForeignCashJournalLines> {
  const receipt = magnitude(receiptBookValueMinor, "A receipt book value", false);

  if (Result.isFailure(receipt)) return Result.fail(receipt.failure);

  const released = magnitude(receivableReleaseMinor, "A receivable carrying release", false);

  if (Result.isFailure(released)) return Result.fail(released.failure);

  const journal: Array<JournalLine> = [];

  addSigned(journal, {
    accountId: cashControlAccountId,
    signedMinor: receipt.success,
    description: "Foreign cash receipt",
  });
  addSigned(journal, {
    accountId: receivableControlAccountId,
    signedMinor: -released.success,
    description: "Release foreign receivable",
  });
  realized(journal, gainAccountId, lossAccountId, receipt.success - released.success);

  return balanced(journal, "Foreign-cash receipt");
}

// Same-currency transfer between two owned accounts: the sender releases
// native units and carrying, the receiver adds exactly the same pair. There is
// no economic gain in moving identical owned currency, so a transfer without
// carrying has no book line at all.
export function transferForeignCash(
  senderCashAccountId: string,
  receiverCashAccountId: string,
  nativeMinor: string,
  carryingMinor: string,
): Checked<ForeignCashJournalLines> {
  const native = magnitude(nativeMinor, "A transferred native amount", true);

  if (Result.isFailure(native)) return Result.fail(native.failure);

  const carrying = magnitude(carryingMinor, "A transferred carrying amount", false);

  if (Result.isFailure(carrying)) return Result.fail(carrying.failure);

  const journal: Array<JournalLine> = [];

  addSigned(journal, {
    accountId: senderCashAccountId,
    signedMinor: -carrying.success,
    description: "Foreign-cash transfer out",
  });
  addSigned(journal, {
    accountId: receiverCashAccountId,
    signedMinor: carrying.success,
    description: "Foreign-cash transfer in",
  });

  return balanced(journal, "Foreign-cash transfer");
}

// Exchanging foreign cash for book-currency cash with an explicit fee. The
// caller reviews that the receiving account is the book-currency cash
// account; a foreign-to-foreign exchange has no qualified book consideration
// in this profile and refuses.
export function exchangeToBookCash(
  foreignCashAccountId: string,
  bookCashAccountId: string,
  feeAccountId: string,
  gainAccountId: string,
  lossAccountId: string,
  releasedCarryingMinor: string,
  actualBookReceiptMinor: string,
  feeMinor: string,
  targetIsBookCurrency: boolean,
): Checked<ForeignCashJournalLines> {
  if (!targetIsBookCurrency) {
    return fail(
      "UnsupportedExchange",
      "A foreign-to-foreign exchange needs a qualified book consideration and refuses here.",
    );
  }

  const carrying = magnitude(releasedCarryingMinor, "A released carrying amount", false);

  if (Result.isFailure(carrying)) return Result.fail(carrying.failure);

  const receipt = magnitude(actualBookReceiptMinor, "An actual book receipt", false);

  if (Result.isFailure(receipt)) return Result.fail(receipt.failure);

  const fee = magnitude(feeMinor, "An exchange fee", false);

  if (Result.isFailure(fee)) return Result.fail(fee.failure);

  if (receipt.success - fee.success < 0n) {
    return fail("NonPositiveAmount", "An exchange needs a non-negative net book receipt.");
  }

  const journal: Array<JournalLine> = [];

  addSigned(journal, {
    accountId: bookCashAccountId,
    signedMinor: receipt.success - fee.success,
    description: "Book-cash exchange receipt",
  });
  addSigned(journal, {
    accountId: feeAccountId,
    signedMinor: fee.success,
    description: "Exchange fee",
  });
  addSigned(journal, {
    accountId: foreignCashAccountId,
    signedMinor: -carrying.success,
    description: "Release exchanged foreign cash",
  });
  realized(journal, gainAccountId, lossAccountId, receipt.success - carrying.success);

  return balanced(journal, "Foreign-cash exchange");
}

export const CashValuation = Schema.Struct({
  targetMinor: MinorUnits,
  deltaMinor: SignedMinorUnits,
});

export type CashValuation = typeof CashValuation.Type;

// The owner's qualified quote converts native units into book minor units, so
// the two currency scales decide the conversion. This profile refuses a
// fractional book minor rather than rounding a carrying value silently.
function targetCarrying(
  units: bigint,
  numerator: string,
  denominator: string,
  nativeScale: typeof CurrencyScale.Type,
  bookScale: typeof CurrencyScale.Type,
): Checked<bigint> {
  if (!Schema.is(PositiveRatePart)(numerator) || !Schema.is(PositiveRatePart)(denominator)) {
    return fail(
      "UnsupportedRate",
      "A reporting rate needs a positive exact numerator and denominator.",
    );
  }

  if (!Schema.is(CurrencyScale)(nativeScale) || !Schema.is(CurrencyScale)(bookScale)) {
    return fail("UnsupportedRate", "A reporting conversion needs a reviewed currency scale.");
  }

  const scaled = units * BigInt(numerator) * 10n ** BigInt(bookScale);
  const divisor = BigInt(denominator) * 10n ** BigInt(nativeScale);

  if (scaled % divisor !== 0n) {
    return fail(
      "UnsupportedRate",
      "The reporting rate cannot produce an exact book minor unit for these units.",
    );
  }

  const target = scaled / divisor;

  return Schema.is(MinorUnits)(amount(target))
    ? Result.succeed(target)
    : fail("AmountOutOfRange", "The target carrying exceeds the money codec.");
}

// Reporting-date valuation posts only target minus current carrying. Native
// units never change and the difference is signed, so a downward revaluation
// is posted as a loss rather than clamped. A withdrawal after the cutoff makes
// this a consumed-history case for the NEXT-41 repair instead.
export function valueCashHolding(
  nativeUnitsMinor: string,
  currentCarryingMinor: string,
  reportingRateNumerator: string,
  reportingRateDenominator: string,
  withdrawnAfterCutoff: boolean,
  nativeScale: typeof CurrencyScale.Type,
  bookScale: typeof CurrencyScale.Type,
): Checked<CashValuation> {
  if (withdrawnAfterCutoff) {
    return fail(
      "ConsumedHistoryValuation",
      "A withdrawal after the cutoff needs the owned chain repair.",
    );
  }

  const units = minorAmount(nativeUnitsMinor, "Native holding units");

  if (Result.isFailure(units)) return Result.fail(units.failure);

  if (units.success < 0n) {
    return fail("NegativeHolding", "A cash holding cannot be negative in this profile.");
  }

  const carrying = magnitude(currentCarryingMinor, "A current book carrying value", false);

  if (Result.isFailure(carrying)) return Result.fail(carrying.failure);

  const target = targetCarrying(
    units.success,
    reportingRateNumerator,
    reportingRateDenominator,
    nativeScale,
    bookScale,
  );

  if (Result.isFailure(target)) return Result.fail(target.failure);

  const difference = target.success - carrying.success;
  const magnitudeWithinCodec = amount(difference < 0n ? -difference : difference);

  if (!Schema.is(MinorUnits)(magnitudeWithinCodec)) {
    return fail("AmountOutOfRange", "The valuation difference exceeds the money codec.");
  }

  return Result.succeed({
    targetMinor: amount(target.success),
    deltaMinor: amount(difference),
  });
}
