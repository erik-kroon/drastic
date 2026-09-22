import type * as Vat from "@open-erp/contracts/vat-returns";
import type { Locale } from "@/paraglide/runtime";
type Code = typeof Vat.VatBlocker.Type | (typeof Vat.VatCalculation.Type)["blockers"][number];
const messages = {
  "actual_profile_unapproved": [
    "Actual-company legal profile is not active.",
    "Rättslig profil för verkligt företag är inte aktiv."
  ],
  "wrong_record_class": [
    "The source class does not match this draft mode.",
    "Underlagsklassen stämmer inte med utkastets läge."
  ],
  "unsupported_book": [
    "Only the synthetic book profile supports this calculation.",
    "Endast den syntetiska bokprofilen stöder beräkningen."
  ],
  "unsupported_treatment": [
    "Treatment is unknown or outside ordinary domestic sales/purchases.",
    "Behandlingen är okänd eller utanför vanliga inhemska köp/försäljningar."
  ],
  "currency_unsupported": [
    "SEK with currency scale 2 is required.",
    "SEK med valutaskala 2 krävs."
  ],
  "missing_dates": [
    "Source dates or reviewed period attribution are missing.",
    "Underlagsdatum eller granskad periodmotivering saknas."
  ],
  "outside_period": [
    "The reviewed tax point is outside the selected period.",
    "Det granskade momsdatumet ligger utanför perioden."
  ],
  "registration_unestablished": [
    "VAT registration and its evidence are not established.",
    "Momsregistrering och underlag är inte fastställda."
  ],
  "method_unestablished": [
    "Accrual method and its evidence are not established.",
    "Faktureringsmetod och underlag är inte fastställda."
  ],
  "domestic_unestablished": [
    "Domestic 25% eligibility and evidence are not established.",
    "Inhemsk behandling med 25 % och underlag är inte fastställda."
  ],
  "deduction_unestablished": [
    "Full purchase deduction and evidence are not established.",
    "Full avdragsrätt och underlag är inte fastställda."
  ],
  "period_unestablished": [
    "The fact or draft lacks period-basis evidence.",
    "Underlag för faktauppgiftens eller utkastets period saknas."
  ],
  "source_amount_difference": [
    "Gross does not equal net plus VAT.",
    "Brutto är inte lika med netto plus moms."
  ],
  "rate_difference": [
    "Source amounts do not satisfy exact 25% arithmetic. No invoice rounding is inferred.",
    "Beloppen uppfyller inte exakt 25 %-beräkning. Ingen fakturaavrundning antas."
  ],
  "missing_ledger_link": [
    "Posted VAT lines have not been linked.",
    "Bokförda momsrader har inte länkats."
  ],
  "reversed_voucher": [
    "The linked voucher was reversed.",
    "Den länkade verifikationen har återförts."
  ],
  "ledger_tax_difference": [
    "Selected VAT lines differ from the source VAT or use the opposite side.",
    "Valda momsrader avviker från momsbeloppet eller använder motsatt sida."
  ],
  "stale_expense_review": [
    "The linked expense source or review changed.",
    "Den länkade kostnadskällan eller granskningen har ändrats."
  ],
  "duplicate_source_component": [
    "More than one fact represents this source component.",
    "Flera faktauppgifter representerar samma underlagskomponent."
  ],
  "overlapping_tax_lines": [
    "Selected VAT lines are also claimed by another fact.",
    "Valda momsrader används även av en annan faktauppgift."
  ],
  "legal_profile_unapproved": [
    "No legal profile is activated.",
    "Ingen rättslig profil är aktiverad."
  ],
  "coverage_unestablished": [
    "The retained inventory does not prove complete period coverage.",
    "Sparade underlag bevisar inte fullständig periodtäckning."
  ],
  "ledger_reconciliation_unavailable": [
    "Whole-book tax-control reconciliation is unavailable.",
    "Fullständig avstämning av momskonton är inte tillgänglig."
  ],
  "other_boxes_unknown": [
    "Other-box absence is unknown; box 49 is unavailable.",
    "Frånvaro av andra rutor är okänd; ruta 49 är inte tillgänglig."
  ],
  "period_registration_unverified": [
    "The registered reporting interval is not independently verified.",
    "Den registrerade redovisningsperioden är inte oberoende verifierad."
  ],
  "fractional_box05": [
    "Box 05 has an öre remainder. This narrow profile requires a whole-krona basis.",
    "Ruta 05 har en öresrest. Profilen kräver underlag i hela kronor."
  ],
  "no_included_facts": [
    "No included facts. Zero subtotals do not establish a zero return.",
    "Inga inkluderade fakta. Noll delsummor innebär inte en nolldeklaration."
  ],
  "excluded_facts": [
    "Excluded facts remain in this snapshot; the shown subtotal is partial.",
    "Exkluderade fakta finns kvar i ögonblicksbilden; delsumman är ofullständig."
  ]
} satisfies Record<Code, readonly [string, string]>;
export function vatBlocker(code: Code, locale: Locale) {
  return messages[code][locale === "sv" ? 1 : 0];
}
