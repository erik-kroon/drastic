import * as Schema from "effect/Schema";
import { Rational } from "@open-erp/domain/purchasing";
import * as A from "./accounting";

export const PurchaseCategorySection = Schema.Struct({
  schema: Schema.Literal("swedish_purchase_categories_v1"),
  categories: Schema.Array(
    Schema.Struct({
      categoryId: A.Identifier,
      rateId: A.Identifier,
      entitlement: Schema.Literal("ordinary_domestic_full"),
      requiredSupport: Schema.Array(
        Schema.Literals(["domestic_eligibility", "full_deduction"]),
      ).check(Schema.isMinLength(2), Schema.isMaxLength(2)),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
}).check(
  Schema.makeFilter(
    (section) =>
      (new Set(section.categories.map((category) => category.categoryId)).size ===
        section.categories.length &&
        section.categories.every((category) => new Set(category.requiredSupport).size === 2)) ||
      "Category identifiers and required evidence must be unambiguous.",
  ),
);

export const PurchaseCategorySelection = Schema.Struct({
  categoryId: A.Identifier,
  supportFactRevisionIds: Schema.Array(A.Identifier).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(1),
  ),
});

export const PurchaseCategoryResolution = Schema.Struct({
  categoryId: A.Identifier,
  schema: PurchaseCategorySection.fields.schema,
  resolverVersion: Schema.Literal("swedish_purchase_category_resolver_v1"),
  taxPointOn: A.CalendarDate,
  ruleReleaseId: A.Identifier,
  ruleReleaseChecksum: A.Digest,
  rate: Rational,
  deduction: Rational,
  supportFacts: Schema.Array(Schema.Struct({ revisionId: A.Identifier, digest: A.Digest })).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(1),
  ),
});
