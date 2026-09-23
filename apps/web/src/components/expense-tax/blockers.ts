import type * as Tax from "@open-erp/contracts/expense-tax";
export function expenseTaxBlockers(locale: "en" | "sv") {
  return locale === "sv" ? sv : en;
}
const en = {
  withdrawn_source: "This expense source was permanently withdrawn. Its amounts are excluded.",
  duplicate_source_component: "Multiple active sources identify the same evidence component.",
  ambiguous_voucher_sources:
    "Multiple active expense sources refer to the same voucher. The line links are unclear.",
  missing_review: "No operator review is recorded.",
  stale_review: "The review belongs to an older source revision.",
  wrong_record_class: "The source class does not match this snapshot mode.",
  production_profile_unapproved:
    "No production tax profile is approved. Actual-company contributions are excluded.",
  unsupported_profile:
    "Only synthetic-expense-tax version 1 in a synthetic book can demonstrate calculations.",
  missing_source_amounts: "Source gross, net or VAT is unknown.",
  missing_review_amounts: "Reviewed gross, net or VAT is unknown.",
  source_amount_difference: "Source gross does not equal net plus VAT.",
  review_amount_difference: "Reviewed gross does not equal net plus VAT.",
  source_review_difference:
    "Reviewed and source amounts differ. Resolve the evidence rather than silently replacing it.",
  missing_currency: "Source currency or scale is unknown.",
  foreign_currency: "Source and book currencies or scales differ. FX is unsupported.",
  missing_jurisdiction: "Supplier, supply or book jurisdiction is unknown.",
  foreign_supply: "Jurisdictions differ. Foreign purchase treatment is unsupported.",
  missing_source_dates: "Invoice issue or receipt date is unknown.",
  missing_review_dates: "Reviewed supply/tax dates or their evidence basis are missing.",
  date_difference: "Source and reviewed supply/tax dates differ.",
  outside_interval: "The reviewed tax point is outside the selected interval.",
  registration_unknown_or_unsupported:
    "Registration is unknown, not registered, or lacks evidence. No zero/full-deduction default is applied.",
  method_unknown_or_unsupported:
    "The method is unknown, cash-based, or lacks evidence. The demonstration supports explicit accrual facts only.",
  unsupported_treatment: "This treatment is not supported by the demonstration.",
  missing_rate: "An explicit rational tax rate is missing.",
  missing_deduction_basis: "The deduction fraction, basis or evidence is missing.",
  invalid_deduction_fraction: "The deduction fraction exceeds one.",
  rounding_policy_unavailable: "No supported exact-only calculation policy is selected.",
  fractional_tax:
    "The tax calculation yields fractional minor units. No rounding rule is approved.",
  fractional_deduction:
    "The deduction calculation yields fractional minor units. No rounding rule is approved.",
  calculated_tax_difference: "Calculated tax conflicts with reviewed VAT or gross.",
  amount_out_of_range: "The calculated amount exceeds the supported exact amount bound.",
} satisfies Record<typeof Tax.ExpenseTaxBlocker.Type, string>;
const sv: typeof en = {
  withdrawn_source: "Kostnadsunderlaget har återkallats permanent. Beloppen ingår inte.",
  duplicate_source_component: "Flera aktiva underlag avser samma underlagskomponent.",
  ambiguous_voucher_sources:
    "Flera aktiva kostnadsunderlag hänvisar till samma verifikation. Radkopplingarna är oklara.",
  missing_review: "Ingen operatörsgranskning finns registrerad.",
  stale_review: "Granskningen gäller en äldre källversion.",
  wrong_record_class: "Källans klass stämmer inte med underlagets läge.",
  production_profile_unapproved:
    "Ingen produktionsprofil för skatt är godkänd. Verkliga företagsbidrag utesluts.",
  unsupported_profile:
    "Endast synthetic-expense-tax version 1 i en syntetisk bok kan demonstrera beräkningar.",
  missing_source_amounts: "Källans brutto, netto eller moms är okänt.",
  missing_review_amounts: "Granskat brutto, netto eller moms är okänt.",
  source_amount_difference: "Källans brutto är inte lika med netto plus moms.",
  review_amount_difference: "Granskat brutto är inte lika med netto plus moms.",
  source_review_difference:
    "Granskade belopp och källbelopp skiljer sig. Utred underlaget i stället för att ersätta det tyst.",
  missing_currency: "Källans valuta eller skala är okänd.",
  foreign_currency:
    "Källans och bokens valutor eller skalor skiljer sig. Valutaomräkning stöds inte.",
  missing_jurisdiction: "Leverantörens, leveransens eller bokens jurisdiktion är okänd.",
  foreign_supply: "Jurisdiktionerna skiljer sig. Behandling av utländska inköp stöds inte.",
  missing_source_dates: "Fakturadatum eller ankomstdatum är okänt.",
  missing_review_dates: "Granskade leverans- eller beskattningsdatum eller deras underlag saknas.",
  date_difference: "Källans och granskarens leverans- eller beskattningsdatum skiljer sig.",
  outside_interval: "Granskad beskattningstidpunkt ligger utanför valt intervall.",
  registration_unknown_or_unsupported:
    "Registreringen är okänd, saknas eller saknar underlag. Noll eller fullt avdrag antas inte.",
  method_unknown_or_unsupported:
    "Metoden är okänd, kontantbaserad eller saknar underlag. Demonstrationen stöder bara uttryckliga faktureringsuppgifter.",
  unsupported_treatment: "Behandlingen stöds inte av demonstrationen.",
  missing_rate: "En uttrycklig rationell skattesats saknas.",
  missing_deduction_basis: "Avdragsandel, grund eller underlag saknas.",
  invalid_deduction_fraction: "Avdragsandelen överstiger ett.",
  rounding_policy_unavailable: "Ingen stödd policy för exakt beräkning har valts.",
  fractional_tax:
    "Skatteberäkningen ger bråkdelar av minsta valutaenheten. Ingen avrundningsregel är godkänd.",
  fractional_deduction:
    "Avdragsberäkningen ger bråkdelar av minsta valutaenheten. Ingen avrundningsregel är godkänd.",
  calculated_tax_difference: "Beräknad skatt stämmer inte med granskad moms eller brutto.",
  amount_out_of_range: "Det beräknade beloppet överstiger den stödda exakta beloppsgränsen.",
};
