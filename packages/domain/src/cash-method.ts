import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Identifier } from "./values";
import { MinorUnits } from "./money";
import {
  assertBalancedJournal,
  cumulativeRelease,
  type RoundingMode,
} from "./purchasing";

// Pure cash-method recognition for qualified domestic same-currency
// invoices. NEXT-38 leaf: partial-payment coverage, once-only year-end
// unpaid recognition, next-year settlement without repeated VAT, and the
// credit/correction boundary.
//
// Accrual effects are never relabeled: per source line, disjoint recognized
// coverage keeps the paid and year-end paths from recognizing the same
// portion twice. Method eligibility and cutover are separately reviewed;
// this compiler takes them as inputs and refuses anything outside the
// qualified ordinary profile. Fees are separate sources and effects.

export const CashMethodFailureCode = Schema.Literals([
  "UnrecognizedCoverageExceeded",
  "StaleCoverage",
  "DuplicateSourceUse",
  "NonPositiveAmount",
  "InsufficientLineCapacity",
  "UnbalancedJournal",
  "IncompletePopulation",
  "InvalidatedAssessment",
  "UnsupportedProfile",
]);

export type CashMethodFailureCode = typeof CashMethodFailureCode.Type;

export const CashMethodFailure = Schema.Struct({
  code: CashMethodFailureCode,
  message: Description,
});

export type CashMethodFailure = typeof CashMethodFailure.Type;

export type Checked<A> = Result.Result<A, CashMethodFailure>;

function fail(code: CashMethodFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function amount(value: bigint) {
  return value.toString();
}

export const CashDirection = Schema.Literals(["purchase", "sale"]);

export type CashDirection = typeof CashDirection.Type;

export const CashMethodRounding = Schema.Literals(["exact", "half_up"]);

export type CashMethodRounding = typeof CashMethodRounding.Type;

// One original source line with its cumulative recognized gross coverage.
// Net/tax splits of any new coverage derive from these exact totals, so the
// final consumption releases exact residuals instead of rounding drift.
export const CashMethodLine = Schema.Struct({
  sourceLineId: Identifier,
  netMinor: MinorUnits,
  taxMinor: MinorUnits,
  recognizedGrossMinor: MinorUnits,
  recognizedVersion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  // Original deductible total and its released part, for purchase lines.
  // Sale lines post the full output tax and leave both at zero.
  originalDeductibleMinor: MinorUnits,
  releasedDeductibleMinor: MinorUnits,
});

export type CashMethodLine = typeof CashMethodLine.Type;

export const CashPaymentAllocation = Schema.Struct({
  sourceLineId: Identifier,
  paidGrossMinor: MinorUnits,
});

export type CashPaymentAllocation = typeof CashPaymentAllocation.Type;

export const CashPaymentInput = Schema.Struct({
  direction: CashDirection,
  lines: Schema.Array(CashMethodLine).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  allocations: Schema.Array(CashPaymentAllocation).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  rounding: CashMethodRounding,
  settlementControlAccountId: Identifier,
  expenseOrRevenueAccountId: Identifier,
  taxAccountId: Identifier,
  bankAccountId: Identifier,
  cashEvidenceId: Identifier,
  knownCashEvidenceIds: Schema.Array(Identifier),
});

export type CashPaymentInput = typeof CashPaymentInput.Type;

export const RecognizedSlice = Schema.Struct({
  sourceLineId: Identifier,
  trigger: Schema.Literal("actual_payment"),
  settledRecognizedMinor: MinorUnits,
  newNetMinor: MinorUnits,
  newTaxMinor: MinorUnits,
  recognizedGrossAfterMinor: MinorUnits,
});

export type RecognizedSlice = typeof RecognizedSlice.Type;

export const CashJournalLine = Schema.Struct({
  sourceLineId: Schema.NullOr(Identifier),
  accountId: Identifier,
  debitMinor: MinorUnits,
  creditMinor: MinorUnits,
  description: Description,
});

export type CashJournalLine = typeof CashJournalLine.Type;

export const CashJournalLines = Schema.Array(CashJournalLine);

export type CashJournalLines = typeof CashJournalLines.Type;

export const CashPaymentPlan = Schema.Struct({
  cashPrincipalMinor: MinorUnits,
  slices: Schema.Array(RecognizedSlice),
  journal: CashJournalLines,
});

export type CashPaymentPlan = typeof CashPaymentPlan.Type;

type JournalLine = CashJournalLine;

function addSigned(
  lines: Array<JournalLine>,
  line: {
    readonly sourceLineId: string | null;
    readonly accountId: string;
    readonly signedMinor: bigint;
    readonly description: string;
  },
) {
  if (line.signedMinor === 0n) return;

  lines.push({
    sourceLineId: line.sourceLineId,
    accountId: line.accountId,
    debitMinor: amount(line.signedMinor > 0n ? line.signedMinor : 0n),
    creditMinor: amount(line.signedMinor < 0n ? -line.signedMinor : 0n),
    description: line.description,
  });
}

function releaseComponent(
  originalComponent: bigint,
  originalGross: bigint,
  recognizedBefore: bigint,
  newCoverage: bigint,
  rounding: RoundingMode,
  subject: string,
): Checked<bigint> {
  const released = cumulativeRelease(
    originalComponent,
    originalGross,
    recognizedBefore,
    newCoverage,
    rounding,
  );

  if (Result.isFailure(released)) {
    return fail("InsufficientLineCapacity", `${subject}: ${released.failure.message}`);
  }

  return Result.succeed(released.success);
}

// A partial payment in frozen original line order. The already-recognized
// part settles the payable/receivable with no new tax facts; only the newly
// recognized remainder posts expense/revenue and tax.
export function applyCashPayment(input: CashPaymentInput): Checked<CashPaymentPlan> {
  if (input.knownCashEvidenceIds.includes(input.cashEvidenceId)) {
    return fail(
      "DuplicateSourceUse",
      "This cash evidence is already used and cannot recognize again.",
    );
  }

  const seen = new Set<string>();
  const journal: Array<JournalLine> = [];
  const slices: Array<RecognizedSlice> = [];
  let principal = 0n;

  for (const allocation of input.allocations) {
    if (seen.has(allocation.sourceLineId)) {
      return fail("InsufficientLineCapacity", `${allocation.sourceLineId} is paid twice.`);
    }

    seen.add(allocation.sourceLineId);

    const line = input.lines.find(
      (candidate) => candidate.sourceLineId === allocation.sourceLineId,
    );

    if (line === undefined) {
      return fail(
        "InsufficientLineCapacity",
        `${allocation.sourceLineId} is not an original source line.`,
      );
    }

    const p = BigInt(allocation.paidGrossMinor);

    if (p <= 0n) {
      return fail("NonPositiveAmount", `Payment against ${line.sourceLineId} must be positive.`);
    }

    const gross = BigInt(line.netMinor) + BigInt(line.taxMinor);
    const recognized = BigInt(line.recognizedGrossMinor);

    if (recognized < 0n || recognized > gross) {
      return fail(
        "StaleCoverage",
        `Recognized coverage of ${line.sourceLineId} is outside its gross.`,
      );
    }

    const unrecognized = gross - recognized;

    // s settles previously recognized coverage; r is newly recognized now.
    const s = p < recognized ? p : recognized;
    const r = p - s;

    if (r > unrecognized) {
      return fail(
        "UnrecognizedCoverageExceeded",
        `Payment against ${line.sourceLineId} exceeds its unrecognized coverage.`,
      );
    }

    const newNet = releaseComponent(
      BigInt(line.netMinor),
      gross,
      recognized,
      r,
      input.rounding,
      line.sourceLineId,
    );

    if (Result.isFailure(newNet)) return Result.fail(newNet.failure);

    const newTax = releaseComponent(
      BigInt(line.taxMinor),
      gross,
      recognized,
      r,
      input.rounding,
      line.sourceLineId,
    );

    if (Result.isFailure(newTax)) return Result.fail(newTax.failure);

    const newDeductible = releaseComponent(
      BigInt(line.originalDeductibleMinor),
      gross,
      recognized,
      r,
      input.rounding,
      line.sourceLineId,
    );

    if (Result.isFailure(newDeductible)) return Result.fail(newDeductible.failure);

    if (
      newDeductible.success < 0n ||
      newDeductible.success > newTax.success ||
      BigInt(line.releasedDeductibleMinor) + newDeductible.success >
        BigInt(line.originalDeductibleMinor)
    ) {
      return fail(
        "InsufficientLineCapacity",
        `Released deduction of ${line.sourceLineId} is outside its original deductible.`,
      );
    }

    const nonDeductible = newTax.success - newDeductible.success;

    if (input.direction === "purchase") {
      // Debit payable for the already-recognized part; recognize the
      // remainder as expense plus deductible tax; credit the bank in full.
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.settlementControlAccountId,
        signedMinor: s,
        description: `Settle payable ${line.sourceLineId}`,
      });
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.expenseOrRevenueAccountId,
        signedMinor: newNet.success + nonDeductible,
        description: `Recognize expense ${line.sourceLineId}`,
      });
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.taxAccountId,
        signedMinor: newDeductible.success,
        description: `Deductible input VAT ${line.sourceLineId}`,
      });
      addSigned(journal, {
        sourceLineId: null,
        accountId: input.bankAccountId,
        signedMinor: -p,
        description: `Supplier payment ${line.sourceLineId}`,
      });
    } else {
      // Debit the bank in full; settle the recognized receivable part and
      // recognize the remainder as revenue plus output tax.
      addSigned(journal, {
        sourceLineId: null,
        accountId: input.bankAccountId,
        signedMinor: p,
        description: `Customer payment ${line.sourceLineId}`,
      });
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.settlementControlAccountId,
        signedMinor: -s,
        description: `Settle receivable ${line.sourceLineId}`,
      });
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.expenseOrRevenueAccountId,
        signedMinor: -newNet.success,
        description: `Recognize revenue ${line.sourceLineId}`,
      });
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.taxAccountId,
        signedMinor: -newTax.success,
        description: `Output VAT ${line.sourceLineId}`,
      });
    }

    principal += p;
    slices.push({
      sourceLineId: line.sourceLineId,
      trigger: "actual_payment",
      settledRecognizedMinor: amount(s),
      newNetMinor: amount(newNet.success),
      newTaxMinor: amount(newTax.success),
      recognizedGrossAfterMinor: amount(recognized + r),
    });
  }

  const finished = assertBalancedJournal(journal, 2);

  if (Result.isFailure(finished)) {
    return fail("UnbalancedJournal", finished.failure.message);
  }

  return Result.succeed({
    cashPrincipalMinor: amount(principal),
    slices,
    journal: finished.success,
  });
}

export const YearEndInput = Schema.Struct({
  direction: CashDirection,
  fiscalYearId: Identifier,
  accountingCutoff: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  complete: Schema.Boolean,
  expectedInvoiceCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  invoiceCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  lines: Schema.Array(CashMethodLine).check(Schema.isMaxLength(500)),
  rounding: CashMethodRounding,
  settlementControlAccountId: Identifier,
  expenseOrRevenueAccountId: Identifier,
  taxAccountId: Identifier,
});

export type YearEndInput = typeof YearEndInput.Type;

export const YearEndSlice = Schema.Struct({
  sourceLineId: Identifier,
  trigger: Schema.Literal("unpaid_year_end"),
  unpaidMinor: MinorUnits,
  newNetMinor: MinorUnits,
  newTaxMinor: MinorUnits,
});

export type YearEndSlice = typeof YearEndSlice.Type;

export const YearEndPlan = Schema.Struct({
  recognizedMinor: MinorUnits,
  slices: Schema.Array(YearEndSlice),
  journal: CashJournalLines,
  consumesVoucher: Schema.Boolean,
});

export type YearEndPlan = typeof YearEndPlan.Type;

// Once-only year-end recognition of the commercial unpaid coverage that is
// not already recognized. Later payment consumes the positions created here
// and must not repeat their VAT.
export function prepareYearEnd(input: YearEndInput): Checked<YearEndPlan> {
  if (input.complete !== true || input.invoiceCount !== input.expectedInvoiceCount) {
    return fail(
      "IncompletePopulation",
      "Year-end recognition needs the complete eligible unpaid population, not a page of it.",
    );
  }

  const journal: Array<JournalLine> = [];
  const slices: Array<YearEndSlice> = [];
  let recognized = 0n;

  for (const line of input.lines) {
    const gross = BigInt(line.netMinor) + BigInt(line.taxMinor);
    const already = BigInt(line.recognizedGrossMinor);

    if (already < 0n || already > gross) {
      return fail(
        "StaleCoverage",
        `Recognized coverage of ${line.sourceLineId} is outside its gross.`,
      );
    }

    const u = gross - already;

    if (u === 0n) continue;

    const newNet = releaseComponent(
      BigInt(line.netMinor),
      gross,
      already,
      u,
      input.rounding,
      line.sourceLineId,
    );

    if (Result.isFailure(newNet)) return Result.fail(newNet.failure);

    const newTax = releaseComponent(
      BigInt(line.taxMinor),
      gross,
      already,
      u,
      input.rounding,
      line.sourceLineId,
    );

    if (Result.isFailure(newTax)) return Result.fail(newTax.failure);

    const newDeductible = releaseComponent(
      BigInt(line.originalDeductibleMinor),
      gross,
      already,
      u,
      input.rounding,
      line.sourceLineId,
    );

    if (Result.isFailure(newDeductible)) return Result.fail(newDeductible.failure);

    if (
      newDeductible.success < 0n ||
      newDeductible.success > newTax.success ||
      BigInt(line.releasedDeductibleMinor) + newDeductible.success >
        BigInt(line.originalDeductibleMinor)
    ) {
      return fail(
        "InsufficientLineCapacity",
        `Released deduction of ${line.sourceLineId} is outside its original deductible.`,
      );
    }

    const nonDeductible = newTax.success - newDeductible.success;

    if (input.direction === "purchase") {
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.expenseOrRevenueAccountId,
        signedMinor: newNet.success + nonDeductible,
        description: `Year-end expense ${line.sourceLineId}`,
      });
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.taxAccountId,
        signedMinor: newDeductible.success,
        description: `Year-end input VAT ${line.sourceLineId}`,
      });
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.settlementControlAccountId,
        signedMinor: -u,
        description: `Year-end payable ${line.sourceLineId}`,
      });
    } else {
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.settlementControlAccountId,
        signedMinor: u,
        description: `Year-end receivable ${line.sourceLineId}`,
      });
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.expenseOrRevenueAccountId,
        signedMinor: -newNet.success,
        description: `Year-end revenue ${line.sourceLineId}`,
      });
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.taxAccountId,
        signedMinor: -newTax.success,
        description: `Year-end output VAT ${line.sourceLineId}`,
      });
    }

    recognized += u;
    slices.push({
      sourceLineId: line.sourceLineId,
      trigger: "unpaid_year_end",
      unpaidMinor: amount(u),
      newNetMinor: amount(newNet.success),
      newTaxMinor: amount(newTax.success),
    });
  }

  const finished = assertBalancedJournal(journal, 0);

  if (Result.isFailure(finished)) {
    return fail("UnbalancedJournal", finished.failure.message);
  }

  return Result.succeed({
    recognizedMinor: amount(recognized),
    slices,
    journal: finished.success,
    consumesVoucher: finished.success.length > 0,
  });
}

export const RecognizedPosition = Schema.Struct({
  recognitionSliceId: Identifier,
  initialGrossMinor: MinorUnits,
  settledGrossMinor: MinorUnits,
});

export type RecognizedPosition = typeof RecognizedPosition.Type;

// Payment in the next year against a year-end recognized position: bank
// versus AP/AR only, with zero new revenue, expense or tax facts.
export function settleRecognizedPosition(
  position: RecognizedPosition,
  paymentGrossMinor: string,
  bankAccountId: string,
  settlementControlAccountId: string,
  direction: CashDirection,
): Checked<{
  readonly settledMinor: string;
  readonly taxDeltaMinor: "0";
  readonly journal: CashJournalLines;
}> {
  const payment = BigInt(paymentGrossMinor);
  const remaining = BigInt(position.initialGrossMinor) - BigInt(position.settledGrossMinor);

  if (payment <= 0n) {
    return fail("NonPositiveAmount", "A settlement payment must be positive.");
  }

  if (payment > remaining) {
    return fail(
      "UnrecognizedCoverageExceeded",
      "The settlement exceeds the recognized remaining position.",
    );
  }

  const journal: Array<JournalLine> = [];

  if (direction === "purchase") {
    addSigned(journal, {
      sourceLineId: null,
      accountId: settlementControlAccountId,
      signedMinor: payment,
      description: `Settle recognized payable ${position.recognitionSliceId}`,
    });
    addSigned(journal, {
      sourceLineId: null,
      accountId: bankAccountId,
      signedMinor: -payment,
      description: `Recognized payment ${position.recognitionSliceId}`,
    });
  } else {
    addSigned(journal, {
      sourceLineId: null,
      accountId: bankAccountId,
      signedMinor: payment,
      description: `Recognized receipt ${position.recognitionSliceId}`,
    });
    addSigned(journal, {
      sourceLineId: null,
      accountId: settlementControlAccountId,
      signedMinor: -payment,
      description: `Settle recognized receivable ${position.recognitionSliceId}`,
    });
  }

  return Result.succeed({
    settledMinor: amount(payment),
    taxDeltaMinor: "0",
    journal,
  });
}

// Payment and year-end compete for the same coverage: the loser sees a
// changed recognized version and must recompute instead of posting over it.
export function assertCoverageVersion(
  sealed: CashMethodLine,
  current: CashMethodLine,
): Checked<CashMethodLine> {
  if (
    sealed.sourceLineId !== current.sourceLineId ||
    sealed.recognizedVersion !== current.recognizedVersion ||
    sealed.recognizedGrossMinor !== current.recognizedGrossMinor
  ) {
    return fail(
      "StaleCoverage",
      `Coverage of ${sealed.sourceLineId} changed after the plan was sealed.`,
    );
  }

  return Result.succeed(current);
}

export const CashCreditInput = Schema.Struct({
  direction: CashDirection,
  line: CashMethodLine,
  creditGrossMinor: MinorUnits,
  // True when the credited portion was already recognized (paid or
  // year-end). An unrecognized portion only revises the commercial
  // residual with no reversal of nonexistent accounting.
  recognizedPortionMinor: MinorUnits,
  // Paid-principal credits route to the qualified refund extension; until
  // cash-method reporting there is qualified this branch refuses.
  paidPrincipal: Schema.Boolean,
});

export type CashCreditInput = typeof CashCreditInput.Type;

// An unpaid credit consumes explicitly linked source-line coverage.
export function applyCashCredit(input: CashCreditInput): Checked<{
  readonly commercialRevisionMinor: string;
  readonly recognizedCorrectionMinor: string;
}> {
  const gross = BigInt(input.line.netMinor) + BigInt(input.line.taxMinor);
  const credit = BigInt(input.creditGrossMinor);
  const recognizedPortion = BigInt(input.recognizedPortionMinor);

  if (credit <= 0n) {
    return fail("NonPositiveAmount", "A cash-method credit needs a positive amount.");
  }

  if (credit > gross - BigInt(input.line.recognizedGrossMinor) + recognizedPortion) {
    return fail("InsufficientLineCapacity", "The credit exceeds the linked source-line coverage.");
  }

  if (recognizedPortion < 0n || recognizedPortion > credit) {
    return fail("InsufficientLineCapacity", "The recognized portion must stay within the credit.");
  }

  if (recognizedPortion > BigInt(input.line.recognizedGrossMinor)) {
    return fail(
      "InsufficientLineCapacity",
      "The recognized portion exceeds the recognized coverage.",
    );
  }

  if (input.paidPrincipal) {
    return fail(
      "UnsupportedProfile",
      "Paid-principal credits need the qualified cash-method refund extension.",
    );
  }

  return Result.succeed({
    commercialRevisionMinor: amount(credit - recognizedPortion),
    recognizedCorrectionMinor: amount(recognizedPortion),
  });
}

// A backdated payment or newly discovered prior-year invoice invalidates the
// relevant year-end assessment: the old receipt is preserved and an owned
// amendment is required, never a silent recompute.
export function refuseBackdatedChange(assessmentSealed: boolean): Checked<"amendment_required"> {
  if (assessmentSealed) {
    return fail(
      "InvalidatedAssessment",
      "A backdated change invalidates the sealed year-end assessment; an owned amendment is required.",
    );
  }

  return Result.succeed("amendment_required");
}
