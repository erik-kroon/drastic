import type * as Recognition from "@open-erp/contracts/supplier-recognition";
import type * as Vat from "@open-erp/contracts/vat-filing-release";

type Treatment = typeof Recognition.ReviewedTreatment.Type;

type Release = typeof Vat.VatFilingRuleRelease.Type;

function equalRational(left: Treatment["rate"], right: Treatment["rate"]) {
  return (
    BigInt(left.numerator) * BigInt(right.denominator) ===
    BigInt(right.numerator) * BigInt(left.denominator)
  );
}

export function resolvePurchaseCategory(release: Release, treatment: Treatment) {
  const section = release.purchaseCategories;

  const category = section?.categories.find(
    (item) => item.categoryId === treatment.category?.categoryId,
  );

  const rate = release.rates.find((item) => item.rateId === category?.rateId);

  if (
    !section ||
    !category ||
    !rate ||
    treatment.basis !== "full_deduction" ||
    category.entitlement !== "ordinary_domestic_full" ||
    !category.requiredSupport.includes("domestic_eligibility") ||
    !category.requiredSupport.includes("full_deduction") ||
    !equalRational(treatment.rate, rate) ||
    !equalRational(treatment.deduction, { numerator: "1", denominator: "1" })
  )
    return null;

  return {
    categoryId: category.categoryId,
    schema: section.schema,
    rate: treatment.rate,
    deduction: treatment.deduction,
  };
}
