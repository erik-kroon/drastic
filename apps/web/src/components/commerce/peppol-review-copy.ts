import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import type * as Peppol from "@open-erp/contracts/peppol-exchange";

const Assertion = Schema.Struct({
  id: Schema.NullOr(Schema.String),
  flag: Schema.NullOr(Schema.String),
  text: Schema.String,
});

export function peppolDiagnostics(review: typeof Peppol.Review.Type) {
  const assertions = review.validation.diagnostics.flatMap((report) => {
    if (!Array.isArray(report.failedAssertions)) return [];

    return report.failedAssertions.flatMap((value) => {
      const assertion = Schema.decodeUnknownOption(Assertion)(value);

      return Option.isSome(assertion) ? [assertion.value] : [];
    });
  });

  const errors = assertions.filter((assertion) => assertion.flag !== "warning");
  const warnings = assertions.length - errors.length;

  const messages = errors.map((assertion) =>
    assertion.id === "PEPPOL-EN16931-R003" &&
    review.source.buyerReference === null &&
    review.source.orderReference === null
      ? `${assertion.id}: Köparens referens eller beställningsreferens saknas. Fakturan utfärdades utan någon referens från ${review.source.buyer.legalName}.`
      : `${assertion.id ?? review.validation.outcome}: ${assertion.text}`,
  );

  if (review.outcome === "blocked") {
    if (review.blockers.includes("validation_integrity"))
      messages.push("Valideringens resultat stämmer inte med det här innehållet.");

    if (review.blockers.includes("dependencies_changed"))
      messages.push("Underlaget ändrades under kontrollen. Förbered en ny kontroll.");
  }

  if (messages.length === 0 && review.validation.outcome !== "passed")
    messages.push(review.validation.outcome);

  return { messages, errors: messages.length, warnings };
}
