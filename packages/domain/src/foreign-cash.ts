import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Identifier } from "./values";
import { MinorUnits } from "./money";
import { CurrencyCode, CurrencyScale } from "./exchange-rates";
import { cumulativeRelease, type RoundingMode } from "./purchasing";

// Pure foreign-currency cash holdings and transfers. NEXT-40 leaf: native
// cash balances with their book carrying values, distinct from foreign
// obligations. A SEK account receiving a foreign invoice payment is not a
// foreign-cash account merely because the source invoice used EUR.
//
// The initial profile permits nonnegative balances only; an overdraft needs
// another qualified profile. Foreign-to-foreign exchange may refuse while
// foreign-to-book exchange works. Late valuation after a later withdrawal
// belongs to the NEXT-41 chain repair, not to a blind rewrite here. Cash
// mutation, once-only source identity and reconciliation stay with the
// banking/application owners.

export const ForeignCashFailureCode = Schema.Literals([
  "NegativeHolding",
  "ResidualCarryingWithoutUnits",
  "OverWithdrawal",
  "NonPositiveAmount",
  "UnsupportedExchange",
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
  capacityVersion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});

export type CashHoldingBasis = typeof CashHoldingBasis.Type;

export const RemainingHolding = Schema.Struct({
  nativeUnitsMinor: MinorUnits,
  carryingMinor: MinorUnits,
});

export type RemainingHolding = typeof RemainingHolding.Type;

// The captured basis: original native units and carrying with their
// consumed and released parts. Remaining empty units with leftover
// carrying is a corrupt state, never a rounding tolerance.
export function captureCashBasis(
  account: ForeignCashAccount,
  basis: CashHoldingBasis,
): Checked<RemainingHolding> {
  if (account.nativeCurrency === account.bookCurrency) {
    return fail(
      "NegativeHolding",
      "A foreign-cash account must be denominated away from the book currency.",
    );
  }

  const native = BigInt(basis.originalNativeMinor) - BigInt(basis.consumedNativeMinor);
  const carrying = BigInt(basis.originalCarryingMinor) - BigInt(basis.releasedCarryingMinor);

  if (native < 0n || carrying < 0n) {
    return fail("NegativeHolding", "A cash holding cannot be negative in this profile.");
  }

  if (native === 0n && carrying !== 0n) {
    return fail(
      "ResidualCarryingWithoutUnits",
      "Empty native units with leftover carrying refuses instead of rounding away.",
    );
  }

  return Result.succeed({ nativeUnitsMinor: amount(native), carryingMinor: amount(carrying) });
}

export const CashWithdrawalPlan = Schema.Struct({
  nativeConsumedMinor: MinorUnits,
  carryingReleasedMinor: MinorUnits,
});

export type CashWithdrawalPlan = typeof CashWithdrawalPlan.Type;

// Withdrawing native units releases carrying through the shared exact
// paired release: a full withdrawal consumes all remaining carrying with
// no residual öre, a partial one releases the exact proportional share.
export function planCashWithdrawal(
  basis: CashHoldingBasis,
  withdrawNativeMinor: string,
  rounding: RoundingMode,
): Checked<CashWithdrawalPlan> {
  const total = BigInt(basis.originalNativeMinor);
  const consumedBefore = BigInt(basis.consumedNativeMinor);
  const q = BigInt(withdrawNativeMinor);

  if (q <= 0n) {
    return fail("NonPositiveAmount", "A withdrawal needs positive native units.");
  }

  if (consumedBefore + q > total) {
    return fail("OverWithdrawal", "The withdrawal exceeds the remaining native holding.");
  }

  const released = cumulativeRelease(
    BigInt(basis.originalCarryingMinor),
    total,
    consumedBefore,
    q,
    rounding,
  );

  if (Result.isFailure(released)) {
    return fail("OverWithdrawal", released.failure.message);
  }

  return Result.succeed({
    nativeConsumedMinor: amount(q),
    carryingReleasedMinor: amount(released.success),
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

function addSigned(lines: Array<JournalLine>, line: {
  readonly accountId: string;
  readonly signedMinor: bigint;
  readonly description: string;
}) {
  if (line.signedMinor === 0n) return;

  lines.push({
    sourceLineId: null,
    accountId: line.accountId,
    debitMinor: amount(line.signedMinor > 0n ? line.signedMinor : 0n),
    creditMinor: amount(line.signedMinor < 0n ? -line.signedMinor : 0n),
    description: line.description,
  });
}

function balanced(lines: Array<JournalLine>, subject: string): Checked<Array<JournalLine>> {
  const total = lines.reduce(
    (sum, line) => sum + BigInt(line.debitMinor) - BigInt(line.creditMinor),
    0n,
  );

  if (total !== 0n) {
    return fail("UnbalancedJournal", `${subject} lines must balance exactly.`);
  }

  return Result.succeed(lines);
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
  const payable = BigInt(payableReleaseMinor);
  const cash = BigInt(cashReleaseMinor);
  const gain = payable - cash;
  const journal: Array<JournalLine> = [];

  addSigned(journal, {
    accountId: payableControlAccountId,
    signedMinor: payable,
    description: "Settle foreign payable",
  });
  addSigned(journal, {
    accountId: cashControlAccountId,
    signedMinor: -cash,
    description: "Release foreign cash",
  });
  addSigned(journal, {
    accountId: gain >= 0n ? gainAccountId : lossAccountId,
    signedMinor: gain >= 0n ? -gain : -gain,
    description: gain >= 0n ? "Realized FX gain" : "Realized FX loss",
  });

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
  const receipt = BigInt(receiptBookValueMinor);
  const released = BigInt(receivableReleaseMinor);
  const gain = receipt - released;
  const journal: Array<JournalLine> = [];

  addSigned(journal, {
    accountId: cashControlAccountId,
    signedMinor: receipt,
    description: "Foreign cash receipt",
  });
  addSigned(journal, {
    accountId: receivableControlAccountId,
    signedMinor: -released,
    description: "Release foreign receivable",
  });
  addSigned(journal, {
    accountId: gain >= 0n ? gainAccountId : lossAccountId,
    signedMinor: -gain,
    description: gain >= 0n ? "Realized FX gain" : "Realized FX loss",
  });

  return balanced(journal, "Foreign-cash receipt");
}

// Same-currency transfer between two owned accounts: the sender releases
// native units and carrying, the receiver adds exactly the same pair.
// There is no economic gain in moving identical owned currency.
export function transferForeignCash(
  senderCashAccountId: string,
  receiverCashAccountId: string,
  nativeMinor: string,
  carryingMinor: string,
): Checked<ForeignCashJournalLines> {
  const native = BigInt(nativeMinor);
  const carrying = BigInt(carryingMinor);

  if (native <= 0n || carrying < 0n) {
    return fail("NonPositiveAmount", "A transfer needs positive native units.");
  }

  return Result.succeed([
    {
      sourceLineId: null,
      accountId: senderCashAccountId,
      debitMinor: "0",
      creditMinor: amount(carrying),
      description: "Foreign-cash transfer out",
    },
    {
      sourceLineId: null,
      accountId: receiverCashAccountId,
      debitMinor: amount(carrying),
      creditMinor: "0",
      description: "Foreign-cash transfer in",
    },
  ]);
}

// Exchanging foreign cash for book-currency cash with an explicit fee.
// Foreign-to-foreign exchange refuses in this profile.
export function exchangeToBookCash(
  foreignCashAccountId: string,
  bookCashAccountId: string,
  feeAccountId: string,
  gainAccountId: string,
  lossAccountId: string,
  releasedCarryingMinor: string,
  actualBookReceiptMinor: string,
  feeMinor: string,
): Checked<ForeignCashJournalLines> {
  const carrying = BigInt(releasedCarryingMinor);
  const receipt = BigInt(actualBookReceiptMinor);
  const fee = BigInt(feeMinor);

  if (fee < 0n || receipt - fee < 0n) {
    return fail("NonPositiveAmount", "An exchange needs a non-negative net book receipt.");
  }

  const gain = receipt - carrying;
  const journal: Array<JournalLine> = [];

  addSigned(journal, {
    accountId: bookCashAccountId,
    signedMinor: receipt - fee,
    description: "Book-cash exchange receipt",
  });
  addSigned(journal, {
    accountId: feeAccountId,
    signedMinor: fee,
    description: "Exchange fee",
  });
  addSigned(journal, {
    accountId: foreignCashAccountId,
    signedMinor: -carrying,
    description: "Release exchanged foreign cash",
  });
  addSigned(journal, {
    accountId: gain >= 0n ? gainAccountId : lossAccountId,
    signedMinor: -gain,
    description: gain >= 0n ? "Realized FX gain" : "Realized FX loss",
  });

  return balanced(journal, "Foreign-cash exchange");
}

// Reporting-date valuation posts only target minus current carrying.
// Native units never change. A withdrawal after the cutoff makes this a
// consumed-history case for the NEXT-41 repair instead.
export function valueCashHolding(
  nativeUnitsMinor: string,
  currentCarryingMinor: string,
  reportingRateNumerator: string,
  reportingRateDenominator: string,
  withdrawnAfterCutoff: boolean,
): Checked<{ readonly targetMinor: string; readonly deltaMinor: string }> {
  if (withdrawnAfterCutoff) {
    return fail(
      "ConsumedHistoryValuation",
      "A withdrawal after the cutoff needs the owned chain repair.",
    );
  }

  const denominator = BigInt(reportingRateDenominator);

  if (denominator <= 0n) {
    return fail("ConsumedHistoryValuation", "The reporting rate needs a positive denominator.");
  }

  const target =
    (BigInt(nativeUnitsMinor) * BigInt(reportingRateNumerator)) / denominator;

  if ((BigInt(nativeUnitsMinor) * BigInt(reportingRateNumerator)) % denominator !== 0n) {
    return fail(
      "ConsumedHistoryValuation",
      "The valuation refuses a fractional minor instead of rounding it silently.",
    );
  }

  return Result.succeed({
    targetMinor: amount(target),
    deltaMinor: amount(target - BigInt(currentCarryingMinor)),
  });
}
