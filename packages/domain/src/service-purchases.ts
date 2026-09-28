import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description, Identifier } from "./values";
import { MinorUnits, SignedMinorUnits } from "./money";
import { roundRational } from "./purchasing";

// Pure general-rule cross-border service purchase compiler (NEXT-05). No
// database, no runtime and no default rate, box or conversion: the service
// kind, jurisdiction class, rate, boxes, rounding and both conversion
// witnesses arrive as reviewed inputs, and a bound failure is an error rather
// than a truncation. The three values the packet keeps distinct — the original
// liability in supplier currency, the book carrying value at recognition and
// the SEK reverse-charge tax base at the qualified tax point — are computed by
// separate explicit conversions and never overwritten with one another.

export const RoundingMode = Schema.Literals([
  "exact",
  "toward_zero",
  "floor",
  "half_up",
  "half_even",
]);

export type RoundingMode = typeof RoundingMode.Type;

export const Rational = Schema.Struct({
  numerator: MinorUnits,
  denominator: Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,37}$/)),
});

export type Rational = typeof Rational.Type;

export const TaxPointBasis = Schema.Literals(["document_date", "supply_date", "received_date"]);

export type TaxPointBasis = typeof TaxPointBasis.Type;

export const TaxPointDate = Schema.Struct({
  taxPointOn: AccountingDate,
  basis: TaxPointBasis,
});

export type TaxPointDate = typeof TaxPointDate.Type;

export const ServiceKind = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{2,63}$/));

export type ServiceKind = typeof ServiceKind.Type;

export const JurisdictionClass = Schema.Literals(["EU_OTHER", "NON_EU"]);

export type JurisdictionClass = typeof JurisdictionClass.Type;

export const SourceReference = Schema.Struct({
  evidenceId: Identifier,
  sourceKey: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._:-]{2,127}$/)),
});

export type SourceReference = typeof SourceReference.Type;

export const ReverseChargeBasisBox = Schema.Literals(["21", "22"]);

export type ReverseChargeBasisBox = typeof ReverseChargeBasisBox.Type;

export const ReverseChargeOutputBox = Schema.Literals(["30", "31", "32"]);

export type ReverseChargeOutputBox = typeof ReverseChargeOutputBox.Type;

// One reviewed source line. The original net is the supplier document's own
// exact amount in its own currency; the compiler never rewrites it. A nonzero
// asserted foreign tax is refused outright: retaining the whole invoice gross
// under a separate qualified treatment is later work, and dropping it from
// liability or booking it as domestic input VAT just to continue is forbidden.
export const ServicePurchaseSourceLine = Schema.Struct({
  sourceLineId: Identifier,
  expenseAccountId: Identifier,
  originalNetMinor: MinorUnits,
  originalCurrency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  originalScale: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(6)),
  sourceTaxMinor: MinorUnits,
  serviceKind: ServiceKind,
  jurisdictionClass: JurisdictionClass,
  exceptionAssessment: Schema.Literal("none"),
  deduction: Rational,
  accountingRate: Rational,
  accountingRateScheme: Description,
  taxPointRate: Rational,
  taxPointRateScheme: Description,
  sourceRefs: Schema.Array(SourceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
});

export type ServicePurchaseSourceLine = typeof ServicePurchaseSourceLine.Type;

// The qualified general-rule release selection this compilation is bound to.
// The rate, boxes and rounding are the release's reviewed choice for the
// selected rate row; the supported kinds and classes are the release's
// eligibility boundary.
export const ServiceReleaseSelection = Schema.Struct({
  rateId: Identifier,
  rate: Rational,
  euBasisBox: Schema.Literal("21"),
  nonEuBasisBox: Schema.Literal("22"),
  outputBox: ReverseChargeOutputBox,
  inputBox: Schema.Literal("48"),
  taxRounding: RoundingMode,
  deductionRounding: RoundingMode,
  supportedServiceKinds: Schema.Array(ServiceKind).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(80),
  ),
  supportedClasses: Schema.Array(JurisdictionClass).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(2),
  ),
});

export type ServiceReleaseSelection = typeof ServiceReleaseSelection.Type;

export const ServiceJournalLine = Schema.Struct({
  sourceLineId: Schema.NullOr(Identifier),
  accountId: Identifier,
  debitMinor: MinorUnits,
  creditMinor: MinorUnits,
  description: Description,
});

export type ServiceJournalLine = typeof ServiceJournalLine.Type;

export const ServiceTaxFact = Schema.Struct({
  sourceLineId: Identifier,
  componentRole: Schema.Literal("reverse_charge"),
  taxComponentId: Identifier,
  taxFactId: Identifier,
  signedBaseMinor: SignedMinorUnits,
  signedOutputTaxMinor: SignedMinorUnits,
  signedDeductibleTaxMinor: SignedMinorUnits,
  sourceTaxMinor: MinorUnits,
  nonDeductibleTaxMinor: MinorUnits,
  serviceKind: ServiceKind,
  jurisdictionClass: JurisdictionClass,
  rateId: Identifier,
  basisBox: ReverseChargeBasisBox,
  outputBox: ReverseChargeOutputBox,
  inputBox: Schema.Literal("48"),
  originalNetMinor: MinorUnits,
  originalCurrency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  originalScale: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(6)),
  accountingRate: Rational,
  accountingRateScheme: Description,
  accountingResidualMinor: SignedMinorUnits,
  taxPointRate: Rational,
  taxPointRateScheme: Description,
  taxBaseResidualMinor: SignedMinorUnits,
  taxPointOn: AccountingDate,
  reportingObligationId: Schema.NullOr(Identifier),
  ruleReleaseId: Schema.NullOr(Identifier),
  sourceRefs: Schema.Array(SourceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  adjustsTaxFactId: Schema.NullOr(Identifier),
});

export type ServiceTaxFact = typeof ServiceTaxFact.Type;

export const ServiceRecognitionLine = Schema.Struct({
  sourceLineId: Identifier,
  expenseAccountId: Identifier,
  originalNetMinor: MinorUnits,
  originalCurrency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  accountingValueMinor: MinorUnits,
  taxBaseMinor: MinorUnits,
  outputTaxMinor: MinorUnits,
  deductibleTaxMinor: MinorUnits,
  nonDeductibleTaxMinor: MinorUnits,
  expenseMinor: MinorUnits,
  taxComponentId: Identifier,
  taxFactId: Identifier,
  taxPointOn: AccountingDate,
  recognitionDate: AccountingDate,
});

export type ServiceRecognitionLine = typeof ServiceRecognitionLine.Type;

export const ServicePurchasePlan = Schema.Struct({
  currencyScale: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(6)),
  bookCurrency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  recognitionDate: AccountingDate,
  totalAccountingValueMinor: MinorUnits,
  totalTaxBaseMinor: MinorUnits,
  totalOutputTaxMinor: MinorUnits,
  totalDeductibleTaxMinor: MinorUnits,
  totalNonDeductibleTaxMinor: MinorUnits,
  payableMinor: MinorUnits,
  payableAccountId: Identifier,
  inputVatAccountId: Identifier,
  outputVatAccountId: Identifier,
  lines: Schema.Array(ServiceRecognitionLine).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  taxFacts: Schema.Array(ServiceTaxFact).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  journal: Schema.Array(ServiceJournalLine).check(Schema.isMinLength(2), Schema.isMaxLength(200)),
});

export type ServicePurchasePlan = typeof ServicePurchasePlan.Type;

export const ServicePurchaseInput = Schema.Struct({
  currencyScale: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(6)),
  bookCurrency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  recognitionDate: AccountingDate,
  taxPoint: TaxPointDate,
  payableAccountId: Identifier,
  inputVatAccountId: Identifier,
  outputVatAccountId: Identifier,
  reportingObligationId: Schema.NullOr(Identifier),
  ruleReleaseId: Schema.NullOr(Identifier),
  taxComponentPrefix: Identifier,
  release: ServiceReleaseSelection,
  lines: Schema.Array(ServicePurchaseSourceLine).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
});

export type ServicePurchaseInput = typeof ServicePurchaseInput.Type;

export const ServiceFailureCode = Schema.Literals([
  "UnsupportedServiceKind",
  "UnsupportedJurisdictionClass",
  "PlaceOfSupplyException",
  "UnsupportedForeignTax",
  "UnsupportedConversion",
  "ConversionOutOfBounds",
  "DeductionOutOfRange",
  "NonPositiveTotal",
  "UnbalancedJournal",
  "DuplicateSourceLine",
  "StaleTaxPoint",
]);

export type ServiceFailureCode = typeof ServiceFailureCode.Type;

export const ServiceFailure = Schema.Struct({
  code: ServiceFailureCode,
  message: Description,
});

export type ServiceFailure = typeof ServiceFailure.Type;

export type ServiceChecked<A> = Result.Result<A, ServiceFailure>;

type SignedLine = {
  readonly sourceLineId: string | null;
  readonly accountId: string;
  readonly signedMinor: bigint;
  readonly description: string;
};

function fail(code: ServiceFailureCode, message: string): ServiceChecked<never> {
  return Result.fail({ code, message });
}

function refuse<A>(result: ServiceChecked<A>): ServiceChecked<never> {
  return Result.isFailure(result)
    ? Result.fail(result.failure)
    : fail("UnsupportedServiceKind", "A checked stage unexpectedly succeeded.");
}

function amount(value: bigint) {
  return value.toString();
}

function minorCeiling(currencyScale: number) {
  return 10n ** BigInt(38 - currencyScale);
}

function withinBounds(value: bigint, ceiling: bigint) {
  return value >= 0n && value < ceiling;
}

// C1 conversion with the residual retained. The caller keeps the residual as
// evidence that the conversion was exact or explicitly rounded; a residual is
// never posted as a plug.
function convertMinor(
  sourceMinor: bigint,
  sourceScale: number,
  targetScale: number,
  rate: Rational,
  mode: RoundingMode,
): ServiceChecked<{ readonly minor: bigint; readonly residualNumerator: bigint }> {
  const numerator = sourceMinor * BigInt(rate.numerator) * 10n ** BigInt(targetScale);
  const denominator = BigInt(rate.denominator) * 10n ** BigInt(sourceScale);
  const converted = roundRational(numerator, denominator, mode);

  if (Result.isFailure(converted)) {
    return fail("UnsupportedConversion", "The reviewed conversion rate cannot be applied.");
  }

  return Result.succeed({
    minor: converted.success,
    residualNumerator: numerator - converted.success * denominator,
  });
}

function addSigned(lines: Array<ServiceJournalLine>, line: SignedLine) {
  if (line.signedMinor === 0n) return;

  lines.push({
    sourceLineId: line.sourceLineId,
    accountId: line.accountId,
    debitMinor: amount(line.signedMinor > 0n ? line.signedMinor : 0n),
    creditMinor: amount(line.signedMinor < 0n ? -line.signedMinor : 0n),
    description: line.description,
  });
}

function journalBalance(lines: ReadonlyArray<ServiceJournalLine>) {
  return lines.reduce(
    (total, line) => total + BigInt(line.debitMinor) - BigInt(line.creditMinor),
    0n,
  );
}

function assertBalancedJournal(
  lines: ReadonlyArray<ServiceJournalLine>,
  minimum: number,
): ServiceChecked<ReadonlyArray<ServiceJournalLine>> {
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

function applyRate(value: bigint, rate: Rational, mode: RoundingMode): ServiceChecked<bigint> {
  const applied = roundRational(value * BigInt(rate.numerator), BigInt(rate.denominator), mode);

  if (Result.isFailure(applied)) {
    return fail("UnsupportedConversion", "The reviewed rate cannot be applied.");
  }

  return Result.succeed(applied.success);
}

function taxComponent(prefix: string, sourceLineId: string) {
  return `${prefix}_${sourceLineId}`;
}

function taxFactId(component: string) {
  return `${component}_fact`;
}

function classifyLine(
  line: ServicePurchaseSourceLine,
  release: ServiceReleaseSelection,
): ServiceChecked<{ readonly basisBox: ReverseChargeBasisBox }> {
  if (!release.supportedServiceKinds.includes(line.serviceKind)) {
    return fail(
      "UnsupportedServiceKind",
      `${line.serviceKind} is not a supported general-rule service.`,
    );
  }

  if (!release.supportedClasses.includes(line.jurisdictionClass)) {
    return fail(
      "UnsupportedJurisdictionClass",
      `${line.jurisdictionClass} is not a supported service origin class.`,
    );
  }

  return Result.succeed({
    basisBox: line.jurisdictionClass === "EU_OTHER" ? release.euBasisBox : release.nonEuBasisBox,
  });
}

function recognizeLine(
  input: ServicePurchaseInput,
  line: ServicePurchaseSourceLine,
  ceiling: bigint,
  bookCeiling: bigint,
): ServiceChecked<{
  readonly recognition: ServiceRecognitionLine;
  readonly taxFact: ServiceTaxFact;
  readonly expense: bigint;
  readonly accountingValue: bigint;
}> {
  const originalNet = BigInt(line.originalNetMinor);
  const sourceTax = BigInt(line.sourceTaxMinor);

  if (
    !withinBounds(originalNet, ceiling) ||
    !withinBounds(sourceTax, ceiling) ||
    originalNet <= 0n
  ) {
    return fail(
      "UnsupportedConversion",
      `Source amounts on ${line.sourceLineId} are not exact positive minor units.`,
    );
  }

  if (sourceTax !== 0n) {
    return fail(
      "UnsupportedForeignTax",
      `Source tax on ${line.sourceLineId} is retained in full and refused: no qualified treatment handles it.`,
    );
  }

  const classified = classifyLine(line, input.release);

  if (Result.isFailure(classified)) return refuse(classified);

  const accounting = convertMinor(
    originalNet,
    line.originalScale,
    input.currencyScale,
    line.accountingRate,
    input.release.taxRounding,
  );

  if (Result.isFailure(accounting)) return refuse(accounting);

  const taxBase = convertMinor(
    originalNet,
    line.originalScale,
    input.currencyScale,
    line.taxPointRate,
    input.release.taxRounding,
  );

  if (Result.isFailure(taxBase)) return refuse(taxBase);

  if (
    !withinBounds(accounting.success.minor, bookCeiling) ||
    !withinBounds(taxBase.success.minor, bookCeiling) ||
    accounting.success.minor <= 0n ||
    taxBase.success.minor <= 0n
  ) {
    return fail(
      "ConversionOutOfBounds",
      `Converted amounts on ${line.sourceLineId} are outside the book codec.`,
    );
  }

  const output = applyRate(taxBase.success.minor, input.release.rate, input.release.taxRounding);

  if (Result.isFailure(output)) return refuse(output);

  const deductible = applyRate(output.success, line.deduction, input.release.deductionRounding);

  if (Result.isFailure(deductible)) return refuse(deductible);

  if (deductible.success < 0n || deductible.success > output.success) {
    return fail(
      "DeductionOutOfRange",
      `Deducted tax on ${line.sourceLineId} is outside the reverse-charge output tax.`,
    );
  }

  const nonDeductible = output.success - deductible.success;
  const component = taxComponent(input.taxComponentPrefix, line.sourceLineId);
  const fact = taxFactId(component);
  const expense = accounting.success.minor + nonDeductible;

  return Result.succeed({
    recognition: {
      sourceLineId: line.sourceLineId,
      expenseAccountId: line.expenseAccountId,
      originalNetMinor: line.originalNetMinor,
      originalCurrency: line.originalCurrency,
      accountingValueMinor: amount(accounting.success.minor),
      taxBaseMinor: amount(taxBase.success.minor),
      outputTaxMinor: amount(output.success),
      deductibleTaxMinor: amount(deductible.success),
      nonDeductibleTaxMinor: amount(nonDeductible),
      expenseMinor: amount(expense),
      taxComponentId: component,
      taxFactId: fact,
      taxPointOn: input.taxPoint.taxPointOn,
      recognitionDate: input.recognitionDate,
    },
    taxFact: {
      sourceLineId: line.sourceLineId,
      componentRole: "reverse_charge",
      taxComponentId: component,
      taxFactId: fact,
      signedBaseMinor: amount(taxBase.success.minor),
      signedOutputTaxMinor: amount(output.success),
      signedDeductibleTaxMinor: amount(deductible.success),
      sourceTaxMinor: line.sourceTaxMinor,
      nonDeductibleTaxMinor: amount(nonDeductible),
      serviceKind: line.serviceKind,
      jurisdictionClass: line.jurisdictionClass,
      rateId: input.release.rateId,
      basisBox: classified.success.basisBox,
      outputBox: input.release.outputBox,
      inputBox: input.release.inputBox,
      originalNetMinor: line.originalNetMinor,
      originalCurrency: line.originalCurrency,
      originalScale: line.originalScale,
      accountingRate: line.accountingRate,
      accountingRateScheme: line.accountingRateScheme,
      accountingResidualMinor: amount(accounting.success.residualNumerator),
      taxPointRate: line.taxPointRate,
      taxPointRateScheme: line.taxPointRateScheme,
      taxBaseResidualMinor: amount(taxBase.success.residualNumerator),
      taxPointOn: input.taxPoint.taxPointOn,
      reportingObligationId: input.reportingObligationId,
      ruleReleaseId: input.ruleReleaseId,
      sourceRefs: line.sourceRefs,
      adjustsTaxFactId: null,
    },
    expense,
    accountingValue: accounting.success.minor,
  });
}

// A general-rule cross-border service purchase: the exact signed journal
// group, the exact book-currency payable, the per-line reverse-charge decision
// and one immutable tax component per source line. The original supplier
// liability, the book carrying value and the SEK tax base stay distinct all
// the way through; a later settlement changes carrying and FX but never the
// sealed original tax fact.
export function compileCrossBorderService(
  input: ServicePurchaseInput,
): ServiceChecked<ServicePurchasePlan> {
  if (input.taxPoint.taxPointOn > input.recognitionDate) {
    return fail("StaleTaxPoint", "The tax point cannot follow the recognition date.");
  }

  const bookCeiling = minorCeiling(input.currencyScale);
  const seen = new Set<string>();
  const journal: Array<ServiceJournalLine> = [];
  const lines: Array<ServiceRecognitionLine> = [];
  const taxFacts: Array<ServiceTaxFact> = [];
  const totals = { accounting: 0n, base: 0n, output: 0n, deductible: 0n, nonDeductible: 0n };

  for (const line of input.lines) {
    if (seen.has(line.sourceLineId)) {
      return fail("DuplicateSourceLine", `${line.sourceLineId} appears twice.`);
    }

    seen.add(line.sourceLineId);

    const recognized = recognizeLine(input, line, minorCeiling(line.originalScale), bookCeiling);

    if (Result.isFailure(recognized)) return refuse(recognized);

    addSigned(journal, {
      sourceLineId: line.sourceLineId,
      accountId: line.expenseAccountId,
      signedMinor: recognized.success.expense,
      description: `Cross-border service ${line.sourceLineId}`,
    });

    addSigned(journal, {
      sourceLineId: line.sourceLineId,
      accountId: input.inputVatAccountId,
      signedMinor: BigInt(recognized.success.recognition.deductibleTaxMinor),
      description: `Reverse-charge input ${line.sourceLineId}`,
    });

    addSigned(journal, {
      sourceLineId: line.sourceLineId,
      accountId: input.outputVatAccountId,
      signedMinor: -BigInt(recognized.success.recognition.outputTaxMinor),
      description: `Reverse-charge output ${line.sourceLineId}`,
    });

    lines.push(recognized.success.recognition);
    taxFacts.push(recognized.success.taxFact);
    totals.accounting += recognized.success.accountingValue;
    totals.base += BigInt(recognized.success.recognition.taxBaseMinor);
    totals.output += BigInt(recognized.success.recognition.outputTaxMinor);
    totals.deductible += BigInt(recognized.success.recognition.deductibleTaxMinor);
    totals.nonDeductible += BigInt(recognized.success.recognition.nonDeductibleTaxMinor);
  }

  if (totals.accounting <= 0n) {
    return fail("NonPositiveTotal", "A recognized service purchase needs a positive payable.");
  }

  addSigned(journal, {
    sourceLineId: null,
    accountId: input.payableAccountId,
    signedMinor: -totals.accounting,
    description: "Cross-border service payable",
  });

  const finished = assertBalancedJournal(journal, 2);

  if (Result.isFailure(finished)) return refuse(finished);

  return Result.succeed({
    currencyScale: input.currencyScale,
    bookCurrency: input.bookCurrency,
    recognitionDate: input.recognitionDate,
    totalAccountingValueMinor: amount(totals.accounting),
    totalTaxBaseMinor: amount(totals.base),
    totalOutputTaxMinor: amount(totals.output),
    totalDeductibleTaxMinor: amount(totals.deductible),
    totalNonDeductibleTaxMinor: amount(totals.nonDeductible),
    payableMinor: amount(totals.accounting),
    payableAccountId: input.payableAccountId,
    inputVatAccountId: input.inputVatAccountId,
    outputVatAccountId: input.outputVatAccountId,
    lines,
    taxFacts,
    journal: finished.success,
  });
}
