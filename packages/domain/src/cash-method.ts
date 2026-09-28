import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Identifier } from "./values";
import { MinorUnits } from "./money";
import { assertBalancedJournal, cumulativeRelease } from "./purchasing";

// Pure cash-method recognition for qualified domestic same-currency
// invoices. NEXT-38 leaf: partial-payment coverage, once-only year-end
// unpaid recognition, next-year settlement without repeated VAT, and the
// credit/correction boundary.
//
// Leaf-only contract: callers qualify method eligibility, original treatment,
// immutable component history and cutover. They persist returned state with
// fresh versions and financial effects atomically. Fees are separate sources.

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

export const CashMethodComponentPolicy = Schema.Literal("tax_first_cumulative_v1");

// Original amounts never change. Paid and effective recognized coverage are
// prefixes; unpaid credits consume the suffix, unrecognized coverage first.
// For G = original gross, C = credited, P = paid, R = recognized:
//   0 <= P <= R <= G-C; recognized unpaid = R-P; commercial unpaid = G-C-P.
// This policy does not support arbitrary interior credits or paid refunds.
export const CashMethodLine = Schema.Struct({
  sourceLineId: Identifier,
  netMinor: MinorUnits,
  taxMinor: MinorUnits,
  creditedGrossMinor: MinorUnits,
  paidGrossMinor: MinorUnits,
  recognizedGrossMinor: MinorUnits,
  recognizedVersion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  componentPolicy: CashMethodComponentPolicy,
  rounding: CashMethodRounding,
  // Effective deduction after recognized credit corrections. Sales use zero.
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
  newDeductibleMinor: MinorUnits,
  recognizedGrossAfterMinor: MinorUnits,
  lineAfter: CashMethodLine,
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
  totalBasis: bigint,
  coverage: bigint,
  rounding: CashMethodRounding,
  subject: string,
): Checked<bigint> {
  const released = cumulativeRelease(originalComponent, totalBasis, 0n, coverage, rounding);

  if (Result.isFailure(released)) {
    return fail("InsufficientLineCapacity", `${subject}: ${released.failure.message}`);
  }

  return Result.succeed(released.success);
}

// Round cumulative tax first; net is its gross complement. Split deduction
// within cumulative tax so every increment conserves gross and deduction
// cannot exceed the tax increment. No rate or entitlement is inferred.
function componentsAt(line: CashMethodLine, coverage: bigint) {
  const gross = BigInt(line.netMinor) + BigInt(line.taxMinor);

  const tax = releaseComponent(
    BigInt(line.taxMinor),
    gross,
    coverage,
    line.rounding,
    line.sourceLineId,
  );

  if (Result.isFailure(tax)) return Result.fail(tax.failure);

  const deductible = releaseComponent(
    BigInt(line.originalDeductibleMinor),
    BigInt(line.taxMinor),
    tax.success,
    line.rounding,
    line.sourceLineId,
  );

  if (Result.isFailure(deductible)) return Result.fail(deductible.failure);

  return Result.succeed({
    net: coverage - tax.success,
    tax: tax.success,
    deductible: deductible.success,
  });
}

function lineCoverage(direction: CashDirection, line: CashMethodLine) {
  if (line.componentPolicy !== "tax_first_cumulative_v1") {
    return fail("UnsupportedProfile", "The line needs the qualified tax-first cumulative policy.");
  }

  if (!Schema.is(CashMethodLine)(line)) {
    return fail(
      "StaleCoverage",
      "The line needs valid exact amounts and a qualified rounding rule.",
    );
  }

  const gross = BigInt(line.netMinor) + BigInt(line.taxMinor);
  const credited = BigInt(line.creditedGrossMinor);
  const paid = BigInt(line.paidGrossMinor);
  const recognized = BigInt(line.recognizedGrossMinor);
  const deductible = BigInt(line.originalDeductibleMinor);

  if (
    !Schema.is(MinorUnits)(amount(gross)) ||
    credited > gross ||
    paid > recognized ||
    recognized > gross - credited ||
    deductible > BigInt(line.taxMinor) ||
    (direction === "sale" && deductible !== 0n)
  ) {
    return fail("StaleCoverage", `Coverage or deduction of ${line.sourceLineId} is inconsistent.`);
  }

  const components = componentsAt(line, recognized);

  if (Result.isFailure(components)) return Result.fail(components.failure);

  if (BigInt(line.releasedDeductibleMinor) !== components.success.deductible) {
    return fail(
      "StaleCoverage",
      `Retained deduction of ${line.sourceLineId} does not match its policy history.`,
    );
  }

  return Result.succeed({ gross, credited, paid, recognized, components: components.success });
}

// Allocations arrive in the caller's frozen original line order. The recognized-unpaid
// part settles the payable/receivable with no new tax facts; only the newly
// recognized remainder posts expense/revenue and tax.
export function applyCashPayment(input: CashPaymentInput): Checked<CashPaymentPlan> {
  if (input.knownCashEvidenceIds.includes(input.cashEvidenceId)) {
    return fail(
      "DuplicateSourceUse",
      "This cash evidence is already used and cannot recognize again.",
    );
  }

  const lineIds = new Set<string>();

  for (const line of input.lines) {
    if (lineIds.has(line.sourceLineId)) {
      return fail("DuplicateSourceUse", `${line.sourceLineId} occurs twice in the payment basis.`);
    }

    lineIds.add(line.sourceLineId);
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

    const coverage = lineCoverage(input.direction, line);

    if (Result.isFailure(coverage)) return Result.fail(coverage.failure);
    const { gross, credited, paid, recognized } = coverage.success;
    const components = coverage.success.components;
    const recognizedUnpaid = recognized - paid;
    const unrecognized = gross - credited - recognized;

    // Only an unpaid recognized position can settle control, never paid history.
    const s = p < recognizedUnpaid ? p : recognizedUnpaid;
    const r = p - s;

    if (r > unrecognized) {
      return fail(
        "UnrecognizedCoverageExceeded",
        `Payment against ${line.sourceLineId} exceeds its unrecognized coverage.`,
      );
    }

    const after = componentsAt(line, recognized + r);

    if (Result.isFailure(after)) return Result.fail(after.failure);
    const newNet = after.success.net - components.net;
    const newTax = after.success.tax - components.tax;
    const newDeductible = after.success.deductible - components.deductible;
    const nonDeductible = newTax - newDeductible;

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
        signedMinor: newNet + nonDeductible,
        description: `Recognize expense ${line.sourceLineId}`,
      });
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.taxAccountId,
        signedMinor: newDeductible,
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
        signedMinor: -newNet,
        description: `Recognize revenue ${line.sourceLineId}`,
      });
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.taxAccountId,
        signedMinor: -newTax,
        description: `Output VAT ${line.sourceLineId}`,
      });
    }

    principal += p;
    slices.push({
      sourceLineId: line.sourceLineId,
      trigger: "actual_payment",
      settledRecognizedMinor: amount(s),
      newNetMinor: amount(newNet),
      newTaxMinor: amount(newTax),
      newDeductibleMinor: amount(newDeductible),
      recognizedGrossAfterMinor: amount(recognized + r),
      lineAfter: {
        ...line,
        paidGrossMinor: amount(paid + p),
        recognizedGrossMinor: amount(recognized + r),
        releasedDeductibleMinor: amount(after.success.deductible),
      },
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
  newDeductibleMinor: MinorUnits,
  lineAfter: CashMethodLine,
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
  const seen = new Set<string>();
  let recognized = 0n;

  for (const line of input.lines) {
    if (seen.has(line.sourceLineId)) {
      return fail(
        "DuplicateSourceUse",
        `${line.sourceLineId} occurs twice in the year-end population.`,
      );
    }

    seen.add(line.sourceLineId);
    const coverage = lineCoverage(input.direction, line);

    if (Result.isFailure(coverage)) return Result.fail(coverage.failure);
    const { gross, credited, recognized: already, components } = coverage.success;

    const u = gross - credited - already;

    if (u === 0n) continue;

    const after = componentsAt(line, already + u);

    if (Result.isFailure(after)) return Result.fail(after.failure);
    const newNet = after.success.net - components.net;
    const newTax = after.success.tax - components.tax;
    const newDeductible = after.success.deductible - components.deductible;
    const nonDeductible = newTax - newDeductible;

    if (input.direction === "purchase") {
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.expenseOrRevenueAccountId,
        signedMinor: newNet + nonDeductible,
        description: `Year-end expense ${line.sourceLineId}`,
      });
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.taxAccountId,
        signedMinor: newDeductible,
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
        signedMinor: -newNet,
        description: `Year-end revenue ${line.sourceLineId}`,
      });
      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.taxAccountId,
        signedMinor: -newTax,
        description: `Year-end output VAT ${line.sourceLineId}`,
      });
    }

    recognized += u;
    slices.push({
      sourceLineId: line.sourceLineId,
      trigger: "unpaid_year_end",
      unpaidMinor: amount(u),
      newNetMinor: amount(newNet),
      newTaxMinor: amount(newTax),
      newDeductibleMinor: amount(newDeductible),
      lineAfter: {
        ...line,
        recognizedGrossMinor: amount(already + u),
        releasedDeductibleMinor: amount(after.success.deductible),
      },
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
  creditedGrossMinor: MinorUnits,
});

export type RecognizedPosition = typeof RecognizedPosition.Type;

// Payment in the next year against a year-end recognized position: bank
// versus AP/AR only, with zero new revenue, expense or tax facts. This is an
// alternative journal compiler to applyCashPayment, not an additional posting.
// Callers project its settlement and owned credits into line coverage atomically.
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
  readonly positionAfter: RecognizedPosition;
}> {
  if (!Schema.is(RecognizedPosition)(position) || !Schema.is(MinorUnits)(paymentGrossMinor)) {
    return fail("StaleCoverage", "A recognized position needs valid exact amounts.");
  }

  const payment = BigInt(paymentGrossMinor);
  const settled = BigInt(position.settledGrossMinor);

  const remaining =
    BigInt(position.initialGrossMinor) - settled - BigInt(position.creditedGrossMinor);

  if (remaining < 0n) {
    return fail("StaleCoverage", "The recognized position history exceeds its original capacity.");
  }

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
    positionAfter: { ...position, settledGrossMinor: amount(settled + payment) },
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
    sealed.recognizedGrossMinor !== current.recognizedGrossMinor ||
    sealed.paidGrossMinor !== current.paidGrossMinor ||
    sealed.creditedGrossMinor !== current.creditedGrossMinor ||
    sealed.netMinor !== current.netMinor ||
    sealed.taxMinor !== current.taxMinor ||
    sealed.originalDeductibleMinor !== current.originalDeductibleMinor ||
    sealed.releasedDeductibleMinor !== current.releasedDeductibleMinor ||
    sealed.componentPolicy !== current.componentPolicy ||
    sealed.rounding !== current.rounding
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
  // Must match the recognized-unpaid suffix removed by this credit. The
  // unrecognized portion has no accounting to reverse; paid credits refuse.
  recognizedPortionMinor: MinorUnits,
  // Paid-principal credits route to the qualified refund extension; until
  // cash-method reporting there is qualified this branch refuses.
  paidPrincipal: Schema.Boolean,
});

export type CashCreditInput = typeof CashCreditInput.Type;

// An unpaid credit consumes the linked original line's remaining suffix.
// Return exact correction components and effective state, not a posted credit.
export function applyCashCredit(input: CashCreditInput): Checked<{
  readonly commercialRevisionMinor: string;
  readonly recognizedCorrectionMinor: string;
  readonly correctionNetMinor: string;
  readonly correctionTaxMinor: string;
  readonly correctionDeductibleMinor: string;
  readonly lineAfter: CashMethodLine;
}> {
  if (input.paidPrincipal) {
    return fail(
      "UnsupportedProfile",
      "Paid-principal credits need the qualified cash-method refund extension.",
    );
  }

  const coverage = lineCoverage(input.direction, input.line);

  if (Result.isFailure(coverage)) return Result.fail(coverage.failure);
  const { gross, credited, paid, recognized } = coverage.success;
  const components = coverage.success.components;
  const credit = BigInt(input.creditGrossMinor);
  const recognizedPortion = BigInt(input.recognizedPortionMinor);

  if (credit <= 0n) {
    return fail("NonPositiveAmount", "A cash-method credit needs a positive amount.");
  }

  if (credit > gross - credited - paid) {
    return fail("InsufficientLineCapacity", "The credit exceeds the linked source-line coverage.");
  }

  const effectiveGrossAfter = gross - credited - credit;
  const recognizedAfter = recognized < effectiveGrossAfter ? recognized : effectiveGrossAfter;

  if (recognizedPortion !== recognized - recognizedAfter) {
    return fail(
      "InsufficientLineCapacity",
      "The recognized portion must match the remaining recognized-unpaid suffix.",
    );
  }

  const after = componentsAt(input.line, recognizedAfter);

  if (Result.isFailure(after)) return Result.fail(after.failure);

  return Result.succeed({
    commercialRevisionMinor: amount(credit - recognizedPortion),
    recognizedCorrectionMinor: amount(recognizedPortion),
    correctionNetMinor: amount(components.net - after.success.net),
    correctionTaxMinor: amount(components.tax - after.success.tax),
    correctionDeductibleMinor: amount(components.deductible - after.success.deductible),
    lineAfter: {
      ...input.line,
      creditedGrossMinor: amount(credited + credit),
      recognizedGrossMinor: amount(recognizedAfter),
      releasedDeductibleMinor: amount(after.success.deductible),
    },
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
