import { integer, fail, money, oneOf, VAT_ROUNDING } from "./contracts.mjs";

/** Only use when the ACTUAL owner explicitly defines both scales as decimal places.
 * Typical example: book minor scale 2, reporting scale 0 -> reportingUnitMinor "100".
 * No interpretation of a field merely named filingUnitScale is implicit.
 */
export function reportingUnitFromScales(bookMinorScale, reportingDecimalPlaces) {
  integer(bookMinorScale, "book minor scale", 0, 6);
  integer(reportingDecimalPlaces, "reporting decimal places", 0, bookMinorScale);

  return String(10n ** BigInt(bookMinorScale - reportingDecimalPlaces));
}

/** Thin synchronous injection port. This does not replace qualification, coverage,
 * controls, readiness or any part of calculateActualVat other than monetary work.
 * The service MUST have come from the qualified artifact loader.
 */
export function createVatMonetaryPort(service) {
  if (service?.release?.status !== "qualified-for-runtime")
    fail("UnqualifiedRelease", "VAT authority requires a qualified service");

  for (const op of ["money.round.v1", "vat.project.v1"])
    if (!service.release.operations.includes(op))
      fail("UnqualifiedOperation", `VAT port requires ${op}`);

  return Object.freeze({
    release: service.release,
    round(numerator, denominator, rounding) {
      if (typeof numerator !== "bigint" || typeof denominator !== "bigint")
        fail("InvalidMoney", "The internal rounding port requires bigint inputs");
      oneOf(rounding, VAT_ROUNDING, "VAT rounding");

      // Preserve the observed null-denominator contract at this compatibility seam.
      // This does not return zero, try another engine or select a different policy.
      if (denominator <= 0n) return null;

      const output = service.calculate("money.round.v1", {
        numerator: String(numerator),
        denominator: String(denominator),
        rounding,
      });

      return money(output.roundedMinor, "rounded result", true);
    },
    project(input) {
      return service.calculate("vat.project.v1", input).rows;
    },
  });
}
