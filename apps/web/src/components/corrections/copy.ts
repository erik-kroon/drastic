import type { Locale } from "@/paraglide/runtime";

const en = {
  title: "Reversal and replacement",
  scope:
    "Synthetic manual journals only. The original stays in the ledger. Both correction parts post together, or neither posts. Tax corrections and statutory date policies are not supported.",
  originalId: "Original voucher ID",
  load: "Load original voucher",
  recoverOriginal: "Recover bundle for this original",
  bundleId: "Correction bundle ID",
  recover: "Load bundle and receipt",
  original: "Retained original",
  reversal: "Exact reversal",
  replacement: "Replacement",
  draft: "Prepare replacement",
  policy:
    "Choose one open period and a date on or after the original date. Both parts use that date. The original period is not reopened. Original evidence is retained; the rationale explains the correction.",
  period: "Correction period",
  date: "Correction date",
  rationale: "Why this correction is needed",
  description: "Replacement description",
  account: "Account",
  debit: "Debit in minor units",
  credit: "Credit in minor units",
  line: "Line",
  remove: "Remove line",
  add: "Add line",
  seal: "Seal reversal and replacement",
  invalid:
    "Check the fields. Each line needs one positive side; total debit and credit must match exactly.",
  review: "Review the complete correction",
  digest: "Bundle digest",
  reviewHelp:
    "Review the retained original, exact opposite amounts, replacement lines, evidence and date. Approval covers this complete sealed bundle. Execution cannot change its lines.",
  confirm: "I reviewed both correction parts and the rationale.",
  approve: "Approve complete bundle",
  execute: "Post reversal and replacement",
  refresh: "Refresh approval and receipt",
  approval: "Operator approval",
  expiry: "Approval expires",
  operator: "An operator must review and approve the complete bundle before execution.",
  committed: "Both correction parts are committed. The original remains unchanged.",
  receipt: "Atomic bundle receipt",
  retry:
    "If a response is lost, refresh this bundle or recover it by the original voucher ID. Do not create another reversal.",
  stale:
    "This approval or its dependencies are no longer valid. Refresh the bundle. Renew an expired approval, or prepare a new bundle if the book changed. A standalone reversal cannot be upgraded into an atomic bundle.",
  dependencies: "Pinned dependencies",
  resource: "Resource",
  version: "Version",
  reason: "Reason",
};
const sv: typeof en = {
  title: "Motbokning och ersättning",
  scope:
    "Endast syntetiska manuella verifikationer. Originalet finns kvar i huvudboken. Båda rättelsedelarna bokförs tillsammans, eller inte alls. Skatterättelser och lagstadgade datumregler stöds inte.",
  originalId: "Originalverifikationens ID",
  load: "Hämta originalverifikation",
  recoverOriginal: "Hämta rättelsen för detta original",
  bundleId: "Rättelsepaketets ID",
  recover: "Hämta rättelsepaket och kvitto",
  original: "Bevarat original",
  reversal: "Exakt motbokning",
  replacement: "Ersättning",
  draft: "Förbered ersättning",
  policy:
    "Välj en öppen period och ett datum tidigast originalets datum. Båda delarna får samma datum. Originalperioden öppnas inte igen. Originalunderlaget bevaras; motiveringen förklarar rättelsen.",
  period: "Rättelseperiod",
  date: "Rättelsedatum",
  rationale: "Varför rättelsen behövs",
  description: "Ersättningens beskrivning",
  account: "Konto",
  debit: "Debet i minsta valutaenhet",
  credit: "Kredit i minsta valutaenhet",
  line: "Rad",
  remove: "Ta bort rad",
  add: "Lägg till rad",
  seal: "Försegla motbokning och ersättning",
  invalid:
    "Kontrollera fälten. Varje rad ska ha en positiv sida; total debet och kredit måste vara exakt lika.",
  review: "Granska hela rättelsen",
  digest: "Rättelsepaketets kontrollsumma",
  reviewHelp:
    "Granska originalet, de exakt motsatta beloppen, ersättningsraderna, underlaget och datumet. Godkännandet gäller hela det förseglade paketet. Raderna kan inte ändras vid bokföring.",
  confirm: "Jag har granskat båda rättelsedelarna och motiveringen.",
  approve: "Godkänn hela rättelsepaketet",
  execute: "Bokför motbokning och ersättning",
  refresh: "Uppdatera godkännande och kvitto",
  approval: "Operatörens godkännande",
  expiry: "Godkännandet löper ut",
  operator: "En operatör måste granska och godkänna hela paketet före bokföring.",
  committed: "Båda rättelsedelarna är bokförda. Originalet är oförändrat.",
  receipt: "Kvitto för hela rättelsepaketet",
  retry:
    "Om ett svar försvinner, uppdatera paketet eller hämta det med originalverifikationens ID. Skapa inte en ny motbokning.",
  stale:
    "Godkännandet eller dess beroenden är inte längre giltiga. Uppdatera paketet. Förnya ett utgånget godkännande, eller förbered ett nytt paket om boken har ändrats. En fristående motbokning kan inte uppgraderas till ett atomärt paket.",
  dependencies: "Låsta beroendeversioner",
  resource: "Resurs",
  version: "Version",
  reason: "Motivering",
};
export function correctionCopy(locale: Locale) {
  return locale === "sv" ? sv : en;
}
