export const readinessHelp = new Map<string, { en: string; sv: string }>([
  [
    "DeclaredBankInventory",
    {
      en: "Name the bank accounts that belong to this period and confirm the supporting records.",
      sv: "Ange periodens bankkonton och bekräfta underlagen som hör till dem.",
    },
  ],
  [
    "CurrentTrialBalance",
    {
      en: "Create a balanced trial balance for this exact period using the latest entries.",
      sv: "Skapa en balanserad saldobalans för hela perioden med de senaste bokförda posterna.",
    },
  ],
  [
    "RepresentedBankSources",
    {
      en: "Reconcile the imported statements against the books for the full period.",
      sv: "Stäm av importerade kontoutdrag mot bokföringen för hela perioden.",
    },
  ],
  [
    "ExpenseControlCoverage",
    {
      en: "Expense reviews are recorded, but complete posting and reconciliation coverage is not yet supported. This check still blocks closing.",
      sv: "Utgiftsgranskningar sparas, men fullständig kontroll av bokföring och avstämning stöds ännu inte. Kontrollen blockerar periodlåsning.",
    },
  ],
  [
    "VatReturnControlCoverage",
    {
      en: "VAT records can be reviewed. Complete tax controls are not yet supported, so the period remains blocked.",
      sv: "Momsunderlagen kan granskas. Fullständiga skattekontroller stöds ännu inte, så perioden förblir blockerad.",
    },
  ],
  [
    "CompleteFamilyInventory",
    {
      en: "Review each closing area and record what applies, what does not, and what is still unknown.",
      sv: "Gå igenom varje bokslutsområde och ange vad som gäller, vad som inte gäller och vad som ännu är okänt.",
    },
  ],
]);

export const readinessNames = new Map<string, { en: string; sv: string }>([
  ["DeclaredBankInventory", { en: "Expected bank accounts", sv: "Förväntade bankkonton" }],
  ["SyntheticNativeProfile", { en: "Book profile", sv: "Bokprofil" }],
  ["PeriodBoundaries", { en: "Period dates", sv: "Perioddatum" }],
  ["CurrentTrialBalance", { en: "Current trial balance", sv: "Aktuell saldobalans" }],
  ["RepresentedBankSources", { en: "Bank reconciliation", sv: "Bankavstämning" }],
  ["RegisteredCommerce", { en: "Invoices and allocations", sv: "Fakturor och fördelningar" }],
  ["OwnerSourceReview", { en: "Owner transactions", sv: "Ägartransaktioner" }],
  ["ExpenseReviewCurrentness", { en: "Expense reviews", sv: "Utgiftsgranskningar" }],
  [
    "ExpenseControlCoverage",
    { en: "Expense accounting coverage", sv: "Utgifternas bokföringstäckning" },
  ],
  ["VatReturnControlCoverage", { en: "VAT controls", sv: "Momskontroller" }],
  [
    "ScheduleBasisCoverage",
    { en: "Asset and schedule sources", sv: "Tillgångars och planers underlag" },
  ],
  [
    "SubledgerControlCoverage",
    { en: "Asset accounting coverage", sv: "Tillgångarnas bokföringstäckning" },
  ],
  ["RepresentedSchedules", { en: "Scheduled entries", sv: "Planerade bokningar" }],
  [
    "CompleteFamilyInventory",
    { en: "Required closing areas", sv: "Obligatoriska bokslutsområden" },
  ],
]);
