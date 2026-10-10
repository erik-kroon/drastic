import * as Schema from "effect/Schema";
import * as A from "./accounting";
import { PurchaseCategorySection } from "./vat-purchase-categories";

// The qualified VAT filing release. A rate, a report box, a filing unit and a
// rounding mode are reviewed executable inputs carried by the one `vat` rule
// release the company admission owner already resolves, so there is exactly one
// rule-release authority. Nothing here is a default: a release that omits a
// rate, a box, a mapping or the filing unit cannot calculate and is refused.

// The supported report boxes: the domestic set plus the general-rule
// reverse-charge set. A reverse-charge basis declares box 21 for an EU service
// and box 22 for a non-EU service; the corresponding output tax declares box
// 30, 31 or 32 by rate; the deductible input still lands in box 48. Every
// other statutory case needs an explicit mapping a reviewed release carries
// before it can be declared.
export const VatReportBox = Schema.Literals([
  "05",
  "10",
  "11",
  "12",
  "21",
  "22",
  "30",
  "31",
  "32",
  "48",
]);

export const VatSourceFamily = Schema.Literals([
  "sales_ledger",
  "purchase_ledger",
  "credit_notes",
  "external_imports",
]);

const PositiveInteger = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,37}$/));

const CalculatorVersion = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]{2,127}$/));

// The only release shape this packet can execute. A newer or older compiler is
// refused rather than reinterpreted, exactly as a saved plan's meaning is never
// recomputed under an unknown version.
export const SupportedCalculatorVersion = "vat-filing-actual-v1";

export const VatQualifiedRate = Schema.Struct({
  rateId: A.Identifier,
  // An exact rational. A rate is never a percentage held as a decimal.
  numerator: PositiveInteger,
  denominator: PositiveInteger,
  salesBox: Schema.Literals(["10", "11", "12"]),
});

export const VatFactMappingRule = Schema.Struct({
  mappingRuleId: A.Identifier,
  treatment: Schema.Literals(["domestic_sale", "domestic_purchase"]),
  rateId: A.Identifier,
  // Only a domestic sale declares the basis box its rate applies to.
  basisBox: Schema.NullOr(Schema.Literal("05")),
  // Only a domestic purchase declares the box its deduction lands in.
  inputBox: Schema.NullOr(Schema.Literal("48")),
});

const treatments = Schema.Literals(["domestic_sale", "domestic_purchase"]);

// The qualified general-rule service section (NEXT-05). It names exactly which
// service kinds and origin classes the release qualifies, the exact rates with
// their output boxes, and the rounding each reverse-charge computation uses. A
// release that omits this section cannot recognize a cross-border service:
// the service owner refuses instead of reading domestic rates as
// reverse-charge authority.
export const ReverseChargeOutputBox = Schema.Literals(["30", "31", "32"]);

export const ServiceJurisdictionClass = Schema.Literals(["EU_OTHER", "NON_EU"]);

export const GeneralRuleServiceKind = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]{2,63}$/),
);

export const ReverseChargeRate = Schema.Struct({
  rateId: A.Identifier,
  numerator: PositiveInteger,
  denominator: PositiveInteger,
  outputBox: ReverseChargeOutputBox,
});

const RoundingChoice = Schema.Literals(["half_up", "half_even", "toward_zero", "floor"]);

export const GeneralRuleServiceRelease = Schema.Struct({
  supportedServiceKinds: Schema.Array(GeneralRuleServiceKind).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(80),
  ),
  supportedClasses: Schema.Array(ServiceJurisdictionClass).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(2),
  ),
  rates: Schema.Array(ReverseChargeRate).check(Schema.isMinLength(1), Schema.isMaxLength(6)),
  euBasisBox: Schema.Literal("21"),
  nonEuBasisBox: Schema.Literal("22"),
  inputBox: Schema.Literal("48"),
  taxRounding: RoundingChoice,
  deductionRounding: RoundingChoice,
});

function releaseIssues(release: {
  readonly rates: ReadonlyArray<typeof VatQualifiedRate.Type>;
  readonly mappingRules: ReadonlyArray<typeof VatFactMappingRule.Type>;
  readonly requiredSourceFamilies: ReadonlyArray<typeof VatSourceFamily.Type>;
  readonly generalRuleServices?: typeof GeneralRuleServiceRelease.Type | undefined;
}) {
  const issues: Array<Schema.FilterIssue> = [];
  const rateIds = new Set(release.rates.map((rate) => rate.rateId));

  if (rateIds.size !== release.rates.length) {
    issues.push({ path: ["rates"], issue: "A rate identifier identifies exactly one rate." });
  }

  const salesBoxes = new Set(release.rates.map((rate) => rate.salesBox));

  if (salesBoxes.size !== release.rates.length) {
    issues.push({ path: ["rates"], issue: "Each output VAT box may carry exactly one rate." });
  }

  const mapped = new Set<string>();

  for (const [index, rule] of release.mappingRules.entries()) {
    if (!rateIds.has(rule.rateId)) {
      issues.push({
        path: ["mappingRules", index],
        issue: "A mapping rule must name a declared rate.",
      });
    }

    if (mapped.has(rule.treatment)) {
      issues.push({ path: ["mappingRules", index], issue: "One mapping rule per treatment." });
    }

    mapped.add(rule.treatment);

    if (rule.treatment === "domestic_sale" && rule.basisBox !== "05") {
      issues.push({
        path: ["mappingRules", index],
        issue: "A domestic sale declares the 05 basis box.",
      });
    }

    if (rule.treatment === "domestic_purchase" && rule.basisBox !== null) {
      issues.push({
        path: ["mappingRules", index],
        issue: "A purchase deduction declares no basis box.",
      });
    }

    if (rule.treatment === "domestic_purchase" && rule.inputBox !== "48") {
      issues.push({
        path: ["mappingRules", index],
        issue: "A purchase deduction lands in box 48.",
      });
    }

    if (rule.treatment === "domestic_sale" && rule.inputBox !== null) {
      issues.push({
        path: ["mappingRules", index],
        issue: "A domestic sale declares no deduction box.",
      });
    }
  }

  if (new Set(release.requiredSourceFamilies).size !== release.requiredSourceFamilies.length) {
    issues.push({ path: ["requiredSourceFamilies"], issue: "A source family is listed once." });
  }

  const services = release.generalRuleServices;

  if (services !== undefined) {
    const serviceRateIds = new Set(services.rates.map((rate) => rate.rateId));

    if (serviceRateIds.size !== services.rates.length) {
      issues.push({
        path: ["generalRuleServices", "rates"],
        issue: "A reverse-charge rate identifier identifies exactly one rate.",
      });
    }

    const serviceOutputBoxes = new Set(services.rates.map((rate) => rate.outputBox));

    if (serviceOutputBoxes.size !== services.rates.length) {
      issues.push({
        path: ["generalRuleServices", "rates"],
        issue: "Each reverse-charge output box may carry exactly one rate.",
      });
    }

    if (new Set(services.supportedServiceKinds).size !== services.supportedServiceKinds.length) {
      issues.push({
        path: ["generalRuleServices", "supportedServiceKinds"],
        issue: "A supported service kind is listed once.",
      });
    }

    if (new Set(services.supportedClasses).size !== services.supportedClasses.length) {
      issues.push({
        path: ["generalRuleServices", "supportedClasses"],
        issue: "A supported origin class is listed once.",
      });
    }
  }

  return issues;
}

export const VatFilingRuleRelease = Schema.Struct({
  // The currency the boxes are reported in. A book that reports another currency
  // is refused instead of reading these amounts as its own.
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  calculatorVersion: CalculatorVersion,
  // The filing unit a box is reported in: 0 declares whole currency units, 2
  // declares the currency's minor unit. It is a reviewed input, never assumed.
  filingUnitScale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  rounding: Schema.Literals(["half_up", "half_even", "toward_zero", "floor"]),
  rates: Schema.Array(VatQualifiedRate).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  mappingRules: Schema.Array(VatFactMappingRule).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(40),
  ),
  supportedTreatments: Schema.Array(treatments).check(Schema.isMinLength(1), Schema.isMaxLength(2)),
  requiredSourceFamilies: Schema.Array(VatSourceFamily).check(Schema.isMaxLength(4)),
  // Absent unless the release qualifies general-rule cross-border services.
  // Nothing defaults it into existence.
  generalRuleServices: Schema.optional(GeneralRuleServiceRelease),
  purchaseCategories: Schema.optional(PurchaseCategorySection),
  sourceManifest: A.Description,
}).check(Schema.makeFilter(releaseIssues));
