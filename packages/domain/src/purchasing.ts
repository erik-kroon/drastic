import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description, Identifier } from "./values";
import { MinorUnits, SignedMinorUnits } from "./money";

// Pure source-line recognition and credit calculation for a domestic purchase.
// No database, no runtime and no default rate: every rate, rounding mode,
// tolerance and deduction fraction arrives as a reviewed input, and a bound
// failure is an error rather than a truncation.

export const RoundingMode = Schema.Literals([
  "exact",
  "toward_zero",
  "floor",
  "half_up",
  "half_even",
]);

export type RoundingMode = typeof RoundingMode.Type;

// A reviewed non-negative exact rate. Nothing here is inferred from a brand,
// an account number or a document total.
export const Rational = Schema.Struct({
  numerator: MinorUnits,
  denominator: Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,37}$/)),
});

export type Rational = typeof Rational.Type;

export const AcceptancePolicy = Schema.Literals([
  "exact_match",
  "qualified_tolerance",
  "review_required",
]);

export type AcceptancePolicy = typeof AcceptancePolicy.Type;

export const TaxPointBasis = Schema.Literals(["document_date", "supply_date", "received_date"]);

export type TaxPointBasis = typeof TaxPointBasis.Type;

export const TaxPointDate = Schema.Struct({
  taxPointOn: AccountingDate,
  basis: TaxPointBasis,
});

export type TaxPointDate = typeof TaxPointDate.Type;

export const TreatmentId = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{2,63}$/));

export type TreatmentId = typeof TreatmentId.Type;

export const PurchaseTreatment = Schema.Struct({
  treatmentId: TreatmentId,
  rate: Rational,
  deduction: Rational,
  invoiceTaxRounding: RoundingMode,
  deductionRounding: RoundingMode,
  acceptancePolicy: AcceptancePolicy,
  toleranceMinor: MinorUnits,
  basis: Description,
});

export type PurchaseTreatment = typeof PurchaseTreatment.Type;

export const SourceReference = Schema.Struct({
  evidenceId: Identifier,
  sourceKey: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._:-]{2,127}$/)),
});

export type SourceReference = typeof SourceReference.Type;

export const CurrencyScale = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(6),
);

export type CurrencyScale = typeof CurrencyScale.Type;

// One reviewed source line. Net, asserted tax and asserted gross are the source
// document's own exact amounts; the compiler never rewrites them.
export const PurchaseSourceLine = Schema.Struct({
  sourceLineId: Identifier,
  expenseAccountId: Identifier,
  netMinor: MinorUnits,
  sourceTaxMinor: MinorUnits,
  sourceGrossMinor: MinorUnits,
  treatment: PurchaseTreatment,
  sourceRefs: Schema.Array(SourceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
});

export type PurchaseSourceLine = typeof PurchaseSourceLine.Type;

export const PurchaseFunding = Schema.Struct({
  accountId: Identifier,
  role: TreatmentId,
  inputVatAccountId: Schema.NullOr(Identifier),
});

export type PurchaseFunding = typeof PurchaseFunding.Type;

export const TaxComponentRole = Schema.Literals(["input_tax"]);

export type TaxComponentRole = typeof TaxComponentRole.Type;

export const PurchaseTaxFact = Schema.Struct({
  sourceLineId: Identifier,
  componentRole: TaxComponentRole,
  taxComponentId: Identifier,
  signedBaseMinor: SignedMinorUnits,
  signedOutputTaxMinor: SignedMinorUnits,
  signedDeductibleTaxMinor: SignedMinorUnits,
  sourceTaxMinor: MinorUnits,
  nonDeductibleTaxMinor: MinorUnits,
  treatmentId: TreatmentId,
  taxPointOn: AccountingDate,
  reportingObligationId: Schema.NullOr(Identifier),
  ruleReleaseId: Schema.NullOr(Identifier),
  sourceRefs: Schema.Array(SourceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  adjustsTaxFactId: Schema.NullOr(Identifier),
});

export type PurchaseTaxFact = typeof PurchaseTaxFact.Type;

export const PurchaseJournalLine = Schema.Struct({
  sourceLineId: Schema.NullOr(Identifier),
  accountId: Identifier,
  debitMinor: MinorUnits,
  creditMinor: MinorUnits,
  description: Description,
});

export type PurchaseJournalLine = typeof PurchaseJournalLine.Type;

export const PurchaseRecognitionLine = Schema.Struct({
  sourceLineId: Identifier,
  expenseAccountId: Identifier,
  netMinor: MinorUnits,
  sourceTaxMinor: MinorUnits,
  deductibleTaxMinor: MinorUnits,
  nonDeductibleTaxMinor: MinorUnits,
  expenseMinor: MinorUnits,
  taxComponentId: Identifier,
  taxFactId: Identifier,
  taxPointOn: AccountingDate,
  recognitionDate: AccountingDate,
  taxDiscrepancyMinor: SignedMinorUnits,
  taxDiscrepancyOutcome: Schema.Literals(["exact_match", "retained_discrepancy"]),
});

export type PurchaseRecognitionLine = typeof PurchaseRecognitionLine.Type;

export const PurchaseRecognitionPlan = Schema.Struct({
  currencyScale: CurrencyScale,
  recognitionDate: AccountingDate,
  totalNetMinor: MinorUnits,
  totalSourceTaxMinor: MinorUnits,
  totalDeductibleTaxMinor: MinorUnits,
  totalNonDeductibleTaxMinor: MinorUnits,
  payableMinor: MinorUnits,
  funding: PurchaseFunding,
  lines: Schema.Array(PurchaseRecognitionLine).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  taxFacts: Schema.Array(PurchaseTaxFact).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  journal: Schema.Array(PurchaseJournalLine).check(Schema.isMinLength(2), Schema.isMaxLength(200)),
});

export type PurchaseRecognitionPlan = typeof PurchaseRecognitionPlan.Type;

export const OriginalLineCapacity = Schema.Struct({
  sourceLineId: Identifier,
  expenseAccountId: Identifier,
  inputVatAccountId: Schema.NullOr(Identifier),
  originalNetMinor: MinorUnits,
  originalSourceTaxMinor: MinorUnits,
  originalDeductibleTaxMinor: MinorUnits,
  creditedNetMinor: MinorUnits,
  creditedSourceTaxMinor: MinorUnits,
  releasedDeductionMinor: MinorUnits,
  treatment: PurchaseTreatment,
  taxFactId: Identifier,
});

export type OriginalLineCapacity = typeof OriginalLineCapacity.Type;

export const CreditLineRequest = Schema.Struct({
  sourceLineId: Identifier,
  creditNetMinor: MinorUnits,
  creditSourceTaxMinor: MinorUnits,
});

export type CreditLineRequest = typeof CreditLineRequest.Type;

export const PurchaseCreditLineRelease = Schema.Struct({
  sourceLineId: Identifier,
  expenseAccountId: Identifier,
  inputVatAccountId: Schema.NullOr(Identifier),
  creditNetMinor: MinorUnits,
  creditSourceTaxMinor: MinorUnits,
  releasedDeductionMinor: MinorUnits,
  expenseMinor: MinorUnits,
  taxComponentId: Identifier,
  creditedNetAfterMinor: MinorUnits,
  creditedSourceTaxAfterMinor: MinorUnits,
  releasedDeductionAfterMinor: MinorUnits,
  taxAdjustment: PurchaseTaxFact,
});

export type PurchaseCreditLineRelease = typeof PurchaseCreditLineRelease.Type;

// The reusable line compiler selects no payable or refund counterpart, so its
// reversals are deliberately one-sided until a consumer balances them.
export const PurchaseCreditLinePlan = Schema.Struct({
  currencyScale: CurrencyScale,
  creditGrossMinor: MinorUnits,
  lines: Schema.Array(PurchaseCreditLineRelease).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  taxAdjustments: Schema.Array(PurchaseTaxFact).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  reversals: Schema.Array(PurchaseJournalLine).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(100),
  ),
});

export type PurchaseCreditLinePlan = typeof PurchaseCreditLinePlan.Type;

export const UnpaidPurchaseCreditPlan = Schema.Struct({
  ...PurchaseCreditLinePlan.fields,
  payableAccountId: Identifier,
  unpaidResidualMinor: MinorUnits,
  journal: Schema.Array(PurchaseJournalLine).check(Schema.isMinLength(2), Schema.isMaxLength(200)),
});

export type UnpaidPurchaseCreditPlan = typeof UnpaidPurchaseCreditPlan.Type;

export const PurchaseFailureCode = Schema.Literals([
  "UnsupportedTreatment",
  "UnsupportedRounding",
  "IncompleteSourceSelection",
  "SourceAmountMismatch",
  "SourceTaxMismatch",
  "DeductionOutOfRange",
  "NonPositiveTotal",
  "UnbalancedJournal",
  "DuplicateSourceLine",
  "InsufficientLineCapacity",
  "InsufficientDeductionRelease",
  "DuplicateCreditLine",
  "UnpaidResidualExceeded",
]);

export type PurchaseFailureCode = typeof PurchaseFailureCode.Type;

export const PurchaseFailure = Schema.Struct({
  code: PurchaseFailureCode,
  message: Description,
});

export type PurchaseFailure = typeof PurchaseFailure.Type;

export type Checked<A> = Result.Result<A, PurchaseFailure>;

type SignedLine = {
  readonly sourceLineId: string | null;
  readonly accountId: string;
  readonly signedMinor: bigint;
  readonly description: string;
};

function fail(code: PurchaseFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

// A failed earlier stage keeps its own reason; it never reaches a caller's success type.
function refuse<A>(result: Checked<A>): Checked<never> {
  return Result.isFailure(result)
    ? Result.fail(result.failure)
    : fail("UnsupportedTreatment", "A checked stage unexpectedly succeeded.");
}

function amount(value: bigint) {
  return value.toString();
}

function minorCeiling(currencyScale: number) {
  return 10n ** BigInt(38 - currencyScale);
}

function roundingStep(
  mode: RoundingMode,
  denominator: bigint,
  doubledRemainder: bigint,
  remainder: bigint,
  oddQuotient: boolean,
) {
  if (mode === "floor") return remainder === 0n ? 0n : 1n;

  if (mode === "half_up") return doubledRemainder >= denominator ? 1n : 0n;

  if (mode === "half_even") {
    return doubledRemainder > denominator || (doubledRemainder === denominator && oddQuotient)
      ? 1n
      : 0n;
  }

  return 0n;
}

function withinBounds(value: bigint, ceiling: bigint) {
  return value >= 0n && value < ceiling;
}

// Nearest with ties away from zero, the truncation modes, and an exact mode
// that refuses a residual instead of dropping it.
export function roundRational(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode,
): Checked<bigint> {
  if (denominator <= 0n) {
    return fail("UnsupportedRounding", "A rational denominator must be positive.");
  }

  if (mode === "exact" && numerator % denominator !== 0n) {
    return fail("UnsupportedRounding", "An exact rounding mode requires an integral result.");
  }

  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const doubled = remainder * 2n;

  const step = roundingStep(mode, denominator, doubled, remainder, quotient % 2n === 1n);

  const result = quotient + step;

  return Result.succeed(negative ? -result : result);
}

function applyRate(value: bigint, rate: Rational, mode: RoundingMode): Checked<bigint> {
  return roundRational(value * BigInt(rate.numerator), BigInt(rate.denominator), mode);
}

// Release part of a bounded original amount. The final consume of the whole
// basis releases exactly what is left, so no residual is ever concealed.
export function cumulativeRelease(
  originalCapacity: bigint,
  totalBasis: bigint,
  consumedBefore: bigint,
  consumeNow: bigint,
  mode: RoundingMode,
): Checked<bigint> {
  if (originalCapacity < 0n || totalBasis < 0n) {
    return fail("InsufficientDeductionRelease", "A release basis cannot be negative.");
  }

  if (consumedBefore < 0n || consumedBefore > totalBasis) {
    return fail("InsufficientDeductionRelease", "Consumed basis is outside its total.");
  }

  if (consumeNow < 0n || consumedBefore + consumeNow > totalBasis) {
    return fail("InsufficientDeductionRelease", "Requested release exceeds the remaining basis.");
  }

  if (totalBasis === 0n) {
    return consumeNow === 0n
      ? Result.succeed(0n)
      : fail("InsufficientDeductionRelease", "A zero basis cannot release anything.");
  }

  const before = roundRational(originalCapacity * consumedBefore, totalBasis, mode);

  if (Result.isFailure(before)) return refuse(before);

  const consumedAfter = consumedBefore + consumeNow;

  const after =
    consumedAfter === totalBasis
      ? Result.succeed(originalCapacity)
      : roundRational(originalCapacity * consumedAfter, totalBasis, mode);

  if (Result.isFailure(after)) return refuse(after);

  return Result.succeed(after.success - before.success);
}

function addSigned(lines: Array<PurchaseJournalLine>, line: SignedLine) {
  if (line.signedMinor === 0n) return;

  lines.push({
    sourceLineId: line.sourceLineId,
    accountId: line.accountId,
    debitMinor: amount(line.signedMinor > 0n ? line.signedMinor : 0n),
    creditMinor: amount(line.signedMinor < 0n ? -line.signedMinor : 0n),
    description: line.description,
  });
}

export function journalBalance(lines: ReadonlyArray<PurchaseJournalLine>) {
  return lines.reduce(
    (total, line) => total + BigInt(line.debitMinor) - BigInt(line.creditMinor),
    0n,
  );
}

// Every line carries exactly one positive side, and a complete group balances.
export function assertBalancedJournal(
  lines: ReadonlyArray<PurchaseJournalLine>,
  minimum: number,
): Checked<ReadonlyArray<PurchaseJournalLine>> {
  const malformed = lines.find((line) => {
    const debit = BigInt(line.debitMinor);
    const credit = BigInt(line.creditMinor);

    return debit === credit || debit < 0n || credit < 0n;
  });

  if (malformed !== undefined) {
    return fail("UnbalancedJournal", "A journal line needs exactly one positive side.");
  }

  if (lines.length < minimum) {
    return fail("UnbalancedJournal", `A complete group needs at least ${minimum} journal lines.`);
  }

  return journalBalance(lines) === 0n
    ? Result.succeed(lines)
    : fail("UnbalancedJournal", "Journal lines must balance exactly.");
}

type Discrepancy = {
  readonly difference: bigint;
  readonly outcome: "exact_match" | "retained_discrepancy";
};

// An asserted tax that differs from the reviewed rate is an exact match, a
// qualified tolerance with the difference retained, or a review case. The
// invoice amount is never rewritten to fit the calculator.
function checkSourceTaxDifference(
  subject: string,
  asserted: bigint,
  expected: bigint,
  treatment: PurchaseTreatment,
): Checked<Discrepancy> {
  const difference = asserted - expected;

  if (difference === 0n) return Result.succeed({ difference, outcome: "exact_match" });

  const magnitude = difference < 0n ? -difference : difference;

  if (treatment.acceptancePolicy === "review_required") {
    return fail(
      "SourceTaxMismatch",
      `Asserted tax on ${subject} differs from the reviewed rate by ${amount(magnitude)}.`,
    );
  }

  const allowed =
    treatment.acceptancePolicy === "qualified_tolerance" &&
    magnitude <= BigInt(treatment.toleranceMinor);

  return allowed
    ? Result.succeed({ difference, outcome: "retained_discrepancy" })
    : fail(
        "SourceTaxMismatch",
        `Asserted tax on ${subject} is outside the reviewed acceptance policy.`,
      );
}

function exactSourceAmounts(
  line: PurchaseSourceLine,
  ceiling: bigint,
): Checked<{ readonly net: bigint; readonly tax: bigint; readonly gross: bigint }> {
  const net = BigInt(line.netMinor);
  const tax = BigInt(line.sourceTaxMinor);
  const gross = BigInt(line.sourceGrossMinor);

  if (!withinBounds(net, ceiling) || !withinBounds(tax, ceiling) || !withinBounds(gross, ceiling)) {
    return fail("SourceAmountMismatch", `Source amounts on ${line.sourceLineId} are not exact.`);
  }

  if (gross !== net + tax) {
    return fail(
      "SourceAmountMismatch",
      `Source gross does not equal net plus asserted tax on ${line.sourceLineId}.`,
    );
  }

  return Result.succeed({ net, tax, gross });
}

function deductibleTax(
  subject: string,
  sourceTax: bigint,
  treatment: PurchaseTreatment,
): Checked<bigint> {
  const deducted = applyRate(sourceTax, treatment.deduction, treatment.deductionRounding);

  if (Result.isFailure(deducted)) return refuse(deducted);

  if (deducted.success < 0n || deducted.success > sourceTax) {
    return fail(
      "DeductionOutOfRange",
      `Deducted tax on ${subject} is outside the asserted source tax.`,
    );
  }

  return deducted;
}

function taxComponent(prefix: string, sourceLineId: string) {
  return `${prefix}_${sourceLineId}`;
}

export const PurchaseRecognitionInput = Schema.Struct({
  currencyScale: CurrencyScale,
  recognitionDate: AccountingDate,
  taxPoint: TaxPointDate,
  funding: PurchaseFunding,
  reportingObligationId: Schema.NullOr(Identifier),
  ruleReleaseId: Schema.NullOr(Identifier),
  taxComponentPrefix: Identifier,
  lines: Schema.Array(PurchaseSourceLine).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
});

export type PurchaseRecognitionInput = typeof PurchaseRecognitionInput.Type;

type RecognitionTotals = {
  net: bigint;
  sourceTax: bigint;
  deductible: bigint;
  nonDeductible: bigint;
};

function recognizeLine(
  input: PurchaseRecognitionInput,
  line: PurchaseSourceLine,
  ceiling: bigint,
): Checked<{
  readonly recognition: PurchaseRecognitionLine;
  readonly taxFact: PurchaseTaxFact;
  readonly expense: bigint;
}> {
  const amounts = exactSourceAmounts(line, ceiling);

  if (Result.isFailure(amounts)) return refuse(amounts);

  const expected = applyRate(
    amounts.success.net,
    line.treatment.rate,
    line.treatment.invoiceTaxRounding,
  );

  if (Result.isFailure(expected)) return refuse(expected);

  const discrepancy = checkSourceTaxDifference(
    line.sourceLineId,
    amounts.success.tax,
    expected.success,
    line.treatment,
  );

  if (Result.isFailure(discrepancy)) return refuse(discrepancy);

  const deductible = deductibleTax(line.sourceLineId, amounts.success.tax, line.treatment);

  if (Result.isFailure(deductible)) return refuse(deductible);

  const nonDeductible = amounts.success.tax - deductible.success;
  const component = taxComponent(input.taxComponentPrefix, line.sourceLineId);
  const fact = `${component}_fact`;

  return Result.succeed({
    recognition: {
      sourceLineId: line.sourceLineId,
      expenseAccountId: line.expenseAccountId,
      netMinor: line.netMinor,
      sourceTaxMinor: line.sourceTaxMinor,
      deductibleTaxMinor: amount(deductible.success),
      nonDeductibleTaxMinor: amount(nonDeductible),
      expenseMinor: amount(amounts.success.net + nonDeductible),
      taxComponentId: component,
      taxFactId: fact,
      taxPointOn: input.taxPoint.taxPointOn,
      recognitionDate: input.recognitionDate,
      taxDiscrepancyMinor: amount(discrepancy.success.difference),
      taxDiscrepancyOutcome: discrepancy.success.outcome,
    },
    taxFact: {
      sourceLineId: line.sourceLineId,
      componentRole: "input_tax",
      taxComponentId: component,
      signedBaseMinor: amount(amounts.success.net),
      signedOutputTaxMinor: "0",
      signedDeductibleTaxMinor: amount(deductible.success),
      sourceTaxMinor: line.sourceTaxMinor,
      nonDeductibleTaxMinor: amount(nonDeductible),
      treatmentId: line.treatment.treatmentId,
      taxPointOn: input.taxPoint.taxPointOn,
      reportingObligationId: input.reportingObligationId,
      ruleReleaseId: input.ruleReleaseId,
      sourceRefs: line.sourceRefs,
      adjustsTaxFactId: null,
    },
    expense: amounts.success.net + nonDeductible,
  });
}

// A domestic purchase recognition: the exact signed journal group, the exact
// payable, the per-source-line deductible decision and one immutable tax
// component per source line.
export function compileDomesticPurchase(
  input: PurchaseRecognitionInput,
): Checked<PurchaseRecognitionPlan> {
  const ceiling = minorCeiling(input.currencyScale);
  const seen = new Set<string>();
  const journal: Array<PurchaseJournalLine> = [];
  const lines: Array<PurchaseRecognitionLine> = [];
  const taxFacts: Array<PurchaseTaxFact> = [];
  const totals: RecognitionTotals = { net: 0n, sourceTax: 0n, deductible: 0n, nonDeductible: 0n };

  for (const line of input.lines) {
    if (seen.has(line.sourceLineId)) {
      return fail("DuplicateSourceLine", `${line.sourceLineId} appears twice.`);
    }

    seen.add(line.sourceLineId);

    const recognized = recognizeLine(input, line, ceiling);

    if (Result.isFailure(recognized)) return refuse(recognized);

    addSigned(journal, {
      sourceLineId: line.sourceLineId,
      accountId: line.expenseAccountId,
      signedMinor: recognized.success.expense,
      description: `Supplier purchase ${line.sourceLineId}`,
    });

    if (BigInt(recognized.success.recognition.deductibleTaxMinor) > 0n) {
      if (input.funding.inputVatAccountId === null) {
        return fail(
          "UnsupportedTreatment",
          "A deductible purchase needs a reviewed input VAT account.",
        );
      }

      addSigned(journal, {
        sourceLineId: line.sourceLineId,
        accountId: input.funding.inputVatAccountId,
        signedMinor: BigInt(recognized.success.recognition.deductibleTaxMinor),
        description: `Input VAT ${line.sourceLineId}`,
      });
    }

    lines.push(recognized.success.recognition);
    taxFacts.push(recognized.success.taxFact);
    totals.net += BigInt(recognized.success.recognition.netMinor);
    totals.sourceTax += BigInt(recognized.success.recognition.sourceTaxMinor);
    totals.deductible += BigInt(recognized.success.recognition.deductibleTaxMinor);
    totals.nonDeductible += BigInt(recognized.success.recognition.nonDeductibleTaxMinor);
  }

  const payable = totals.net + totals.sourceTax;

  if (payable <= 0n) {
    return fail("NonPositiveTotal", "A recognized purchase needs a positive gross amount.");
  }

  addSigned(journal, {
    sourceLineId: null,
    accountId: input.funding.accountId,
    signedMinor: -payable,
    description: `Supplier payable ${input.funding.role}`,
  });

  const finished = assertBalancedJournal(journal, 2);

  if (Result.isFailure(finished)) return refuse(finished);

  return Result.succeed({
    currencyScale: input.currencyScale,
    recognitionDate: input.recognitionDate,
    totalNetMinor: amount(totals.net),
    totalSourceTaxMinor: amount(totals.sourceTax),
    totalDeductibleTaxMinor: amount(totals.deductible),
    totalNonDeductibleTaxMinor: amount(totals.nonDeductible),
    payableMinor: amount(payable),
    funding: input.funding,
    lines,
    taxFacts,
    journal: finished.success,
  });
}

export const PurchaseCreditInput = Schema.Struct({
  currencyScale: CurrencyScale,
  taxPoint: TaxPointDate,
  reportingObligationId: Schema.NullOr(Identifier),
  ruleReleaseId: Schema.NullOr(Identifier),
  taxComponentPrefix: Identifier,
  creditEvidence: SourceReference,
  original: Schema.Array(OriginalLineCapacity).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  requested: Schema.Array(CreditLineRequest).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
});

export type PurchaseCreditInput = typeof PurchaseCreditInput.Type;

export const UnpaidPurchaseCreditInput = Schema.Struct({
  ...PurchaseCreditInput.fields,
  payableAccountId: Identifier,
  unpaidResidualMinor: MinorUnits,
});

export type UnpaidPurchaseCreditInput = typeof UnpaidPurchaseCreditInput.Type;

function creditLineRelease(
  input: PurchaseCreditInput,
  request: CreditLineRequest,
  original: OriginalLineCapacity,
  ceiling: bigint,
): Checked<PurchaseCreditLineRelease> {
  const net = BigInt(request.creditNetMinor);
  const tax = BigInt(request.creditSourceTaxMinor);

  if (!withinBounds(net, ceiling) || !withinBounds(tax, ceiling)) {
    return fail("SourceAmountMismatch", "Credited amounts must be exact minor units.");
  }

  if (net === 0n && tax === 0n) {
    return fail("SourceAmountMismatch", `Credit line ${request.sourceLineId} releases nothing.`);
  }

  const expected = applyRate(net, original.treatment.rate, original.treatment.invoiceTaxRounding);

  if (Result.isFailure(expected)) return refuse(expected);

  const discrepancy = checkSourceTaxDifference(
    request.sourceLineId,
    tax,
    expected.success,
    original.treatment,
  );

  if (Result.isFailure(discrepancy)) return refuse(discrepancy);

  const creditedNet = BigInt(original.creditedNetMinor);
  const creditedTax = BigInt(original.creditedSourceTaxMinor);

  if (creditedNet + net > BigInt(original.originalNetMinor)) {
    return fail(
      "InsufficientLineCapacity",
      `Credited net exceeds the original net of ${request.sourceLineId}.`,
    );
  }

  if (creditedTax + tax > BigInt(original.originalSourceTaxMinor)) {
    return fail(
      "InsufficientLineCapacity",
      `Credited tax exceeds the original source tax of ${request.sourceLineId}.`,
    );
  }

  // Deduction is released in proportion to the credited source tax, so a final
  // credit releases exactly the deduction the original recognition recorded.
  const released = cumulativeRelease(
    BigInt(original.originalDeductibleTaxMinor),
    BigInt(original.originalSourceTaxMinor),
    creditedTax,
    tax,
    original.treatment.deductionRounding,
  );

  if (Result.isFailure(released)) return refuse(released);

  const releasedBefore = BigInt(original.releasedDeductionMinor);
  const releasedAfter = releasedBefore + released.success;

  if (releasedAfter > BigInt(original.originalDeductibleTaxMinor) || released.success > tax) {
    return fail(
      "InsufficientDeductionRelease",
      `Released deduction exceeds the recognized deduction of ${request.sourceLineId}.`,
    );
  }

  const nonDeductible = tax - released.success;
  const component = taxComponent(input.taxComponentPrefix, request.sourceLineId);

  return Result.succeed({
    sourceLineId: request.sourceLineId,
    expenseAccountId: original.expenseAccountId,
    inputVatAccountId: original.inputVatAccountId,
    creditNetMinor: request.creditNetMinor,
    creditSourceTaxMinor: request.creditSourceTaxMinor,
    releasedDeductionMinor: amount(released.success),
    expenseMinor: amount(net + nonDeductible),
    taxComponentId: component,
    creditedNetAfterMinor: amount(creditedNet + net),
    creditedSourceTaxAfterMinor: amount(creditedTax + tax),
    releasedDeductionAfterMinor: amount(releasedAfter),
    taxAdjustment: {
      sourceLineId: request.sourceLineId,
      componentRole: "input_tax",
      taxComponentId: component,
      signedBaseMinor: amount(-net),
      signedOutputTaxMinor: "0",
      signedDeductibleTaxMinor: amount(-released.success),
      sourceTaxMinor: request.creditSourceTaxMinor,
      nonDeductibleTaxMinor: amount(nonDeductible),
      treatmentId: original.treatment.treatmentId,
      taxPointOn: input.taxPoint.taxPointOn,
      reportingObligationId: input.reportingObligationId,
      ruleReleaseId: input.ruleReleaseId,
      sourceRefs: [input.creditEvidence],
      adjustsTaxFactId: original.taxFactId,
    },
  });
}

function creditLineReleases(
  input: PurchaseCreditInput,
  ceiling: bigint,
): Checked<ReadonlyArray<PurchaseCreditLineRelease>> {
  const seen = new Set<string>();
  const released: Array<PurchaseCreditLineRelease> = [];

  for (const request of input.requested) {
    if (seen.has(request.sourceLineId)) {
      return fail("DuplicateCreditLine", `${request.sourceLineId} is credited twice.`);
    }

    seen.add(request.sourceLineId);

    const original = input.original.find((line) => line.sourceLineId === request.sourceLineId);

    if (original === undefined) {
      return fail(
        "IncompleteSourceSelection",
        `${request.sourceLineId} is not an original source line of this purchase.`,
      );
    }

    const release = creditLineRelease(input, request, original, ceiling);

    if (Result.isFailure(release)) return refuse(release);

    released.push(release.success);
  }

  return Result.succeed(released);
}

// Reusable original-line credit math. It selects no payable or refund
// counterpart, so its reversals stay one-sided until a consumer balances them.
export function compilePurchaseCreditLines(
  input: PurchaseCreditInput,
): Checked<PurchaseCreditLinePlan> {
  const ceiling = minorCeiling(input.currencyScale);
  const released = creditLineReleases(input, ceiling);

  if (Result.isFailure(released)) return refuse(released);

  const reversals: Array<PurchaseJournalLine> = [];
  let gross = 0n;

  for (const line of released.success) {
    addSigned(reversals, {
      sourceLineId: line.sourceLineId,
      accountId: line.expenseAccountId,
      signedMinor: -BigInt(line.expenseMinor),
      description: `Supplier credit ${line.sourceLineId}`,
    });

    if (BigInt(line.releasedDeductionMinor) > 0n) {
      if (line.inputVatAccountId === null) {
        return fail(
          "InsufficientDeductionRelease",
          "A released deduction needs the original reviewed input VAT account.",
        );
      }

      addSigned(reversals, {
        sourceLineId: line.sourceLineId,
        accountId: line.inputVatAccountId,
        signedMinor: -BigInt(line.releasedDeductionMinor),
        description: `Input VAT credit ${line.sourceLineId}`,
      });
    }

    gross += BigInt(line.creditNetMinor) + BigInt(line.creditSourceTaxMinor);
  }

  if (gross <= 0n) {
    return fail("NonPositiveTotal", "A supplier credit needs a positive gross amount.");
  }

  return Result.succeed({
    currencyScale: input.currencyScale,
    creditGrossMinor: amount(gross),
    lines: released.success,
    taxAdjustments: released.success.map((line) => line.taxAdjustment),
    reversals,
  });
}

// The unpaid bounded credit: the same line releases plus the payable debit,
// refused when the credit exceeds the current unpaid principal.
export function compileUnpaidPurchaseCredit(
  input: UnpaidPurchaseCreditInput,
): Checked<UnpaidPurchaseCreditPlan> {
  const compiled = compilePurchaseCreditLines(input);

  if (Result.isFailure(compiled)) return refuse(compiled);

  const gross = BigInt(compiled.success.creditGrossMinor);
  const residual = BigInt(input.unpaidResidualMinor);

  if (gross > residual) {
    return fail(
      "UnpaidResidualExceeded",
      `A credit of ${amount(gross)} exceeds the unpaid residual of ${amount(residual)}.`,
    );
  }

  const journal = [
    ...compiled.success.reversals,
    {
      sourceLineId: null,
      accountId: input.payableAccountId,
      debitMinor: amount(gross),
      creditMinor: "0",
      description: "Reduce supplier payable",
    },
  ];

  const finished = assertBalancedJournal(journal, 2);

  if (Result.isFailure(finished)) return refuse(finished);

  return Result.succeed({
    ...compiled.success,
    payableAccountId: input.payableAccountId,
    unpaidResidualMinor: input.unpaidResidualMinor,
    journal: finished.success,
  });
}
