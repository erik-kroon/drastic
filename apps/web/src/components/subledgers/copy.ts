export function subledgerCopy(locale: "en" | "sv") {
  return locale === "sv" ? sv : en;
}
const en = {
  title: "Assets and deferrals",
  warning:
    "Synthetic preparation only. You choose the amounts, accounts and dates. This is not a Swedish depreciation or tax policy. Every posting needs separate human approval.",
  unsupported:
    "VAT, payroll and FX are unsupported. VAT needs reviewed legal dates and rounding rules. Payroll needs accepted employment and statutory facts. FX needs an explicit rational rate, source, date and rounding policy.",
  create: "Save schedule",
  revise: "Save new revision",
  load: "Open schedule",
  refresh: "Refresh schedules",
  next: "Next page",
  first: "First page",
  empty:
    "No schedules on this page. This does not establish a complete asset or deferral inventory.",
  sourceKey: "Stable source component key",
  sourceKeyHelp:
    "Use one key for this source component. Keep it unchanged when retrying. Recover an existing schedule instead of entering a second key.",
  name: "Schedule name",
  kind: "Schedule type",
  asset: "Asset",
  deferral: "Deferral",
  evidence: "Retained evidence ID",
  rationale: "Basis for the amounts, dates and accounts",
  cost: "Source cost (integer minor units)",
  residual: "Residual amount (integer minor units)",
  debit: "Debit account",
  credit: "Credit account",
  series: "Voucher series",
  date: "Posting date",
  period: "Accounting period",
  add: "Add occurrence",
  remove: "Remove last occurrence",
  occurrence: "Occurrence",
  amount: "Amount (minor units)",
  policy:
    "I choose equal integer minor units, with all division remainder in the final occurrence.",
  policyHelp:
    "Cost minus residual is divided by the number of occurrences. At least one minor unit is required per occurrence. Dates are not generated. This mathematical allocation does not establish an accounting policy.",
  invalid:
    "Review the required fields, exact integer amounts, distinct accounts and occurrence dates.",
  saved: "Schedule revision saved. Nothing was posted.",
  revision: "Revision",
  history: "Immutable revision history",
  digest: "Revision digest",
  prepare: "Prepare or recover proposal",
  review: "Review proposal",
  prepared: "Proposal retained. Review and human approval are still required.",
  state: "State",
  unprepared: "Not prepared",
  preparedState: "Prepared, not posted",
  posted: "Posted",
  reversed: "Reversed; replacement unsupported",
  conflicted: "Identity conflict; inspect voucher",
  recognized: "Net recognized (minor units)",
  remaining: "Remaining including residual (minor units)",
  balanceHelp:
    "These totals follow schedule-linked postings and their reversals. The source purchase and control-account balance are not reconciled. A conflicting posting is excluded and needs review.",
  basisStandalone:
    "No carrying basis is linked. Only the standalone synthetic preparation rules apply; this does not establish source coverage.",
  basisLinked:
    "A carrying basis is linked. Preparation captures it, and posting checks it again. A later reversal or correction blocks further recognition. This is not an approved legal policy.",
  basisBlocked:
    "Further recognition is blocked. The linked carrying basis was reversed, corrected or no longer matches. Inspect its voucher and the asset controls. Replacing this basis is not supported.",
  basisUnknown:
    "Live carrying-basis status is unavailable. Refresh before preparing. Proposal review performs its own current dependency check.",
  basisVoucher: "Carrying-basis voucher",
  basisDigest: "Carrying-basis digest",
  amendmentScheduleDigest: "Amendment schedule digest",
  amendment: "Operator amendments",
  amendmentKind: "Current amendment",
  amendmentNone: "No amendment retained",
  future: "Future excluding residual",
  reversedFace: "Reversed face amount",
  amendmentNotice:
    "These are retained synthetic operator records. They do not approve legal treatment or establish runtime or database behavior.",
  amendmentNoBasis:
    "A reviewed linked carrying basis is required before an amendment can be submitted.",
  amendmentNoSuffix: "There is no complete future unposted suffix to amend.",
  amendmentStalePrefix:
    "A conflicted occurrence blocks the amendment. Inspect its voucher before retrying.",
  amendmentDatePrefix:
    "Date amendments require every occurrence before the suffix to be posted and unreversed.",
  amendmentBlockerBasis:
    "Stale blocker: the linked basis was reversed, corrected or no longer matches.",
  amendmentBlockerEstimate:
    "Stale blocker: the reviewed remaining estimate no longer conserves the live history.",
  amendmentBlockerDisposed:
    "Stale blocker: this schedule is disposed; later amendments and recognition are blocked.",
  amendmentBlockerUnknown:
    "Stale blocker: the live carrying-basis status is not available. Refresh before preparing an amendment.",
  amendmentFirst: "First remaining occurrence",
  amendmentReviewEvidence: "Review evidence ID",
  amendmentRationale: "Amendment rationale",
  amendmentPeriods: "Future dates and periods",
  amendmentInstallments: "Future installments",
  amendmentResidual: "Residual",
  amendmentDate: "Amend future dates",
  amendmentEstimate: "Amend remaining estimate",
  amendmentDateHelp:
    "Replace the complete future suffix. Amounts, accounts, source, residual and occurrence identities remain unchanged.",
  amendmentEstimateHelp:
    "Supply every remaining installment explicitly. The retained server checks conservation, periods, currentness and any count change.",
  amendmentAdd: "Add future installment",
  amendmentRemove: "Remove last future installment",
  amendmentOnlyOperator: "Amendment review is available to operators only.",
  frozen:
    "This schedule is not editable through the ordinary revision form. Use the operator amendment commands above, then prepare a fresh proposal for human approval.",
  pending: "Saving…",
  evidenceCreate: "Retain supporting evidence",
  evidenceTitle: "Evidence title",
  content: "Source text",
  origin: "Source origin",
  evidenceSaved: "Evidence retained. Use its ID in the schedule.",
  newSchedule: "Start another schedule",
  limit: "Up to 120 explicit occurrences and 20 immutable revisions before preparation.",
};
const sv: typeof en = {
  title: "Tillgångar och periodiseringar",
  warning:
    "Endast syntetisk beredning. Du väljer belopp, konton och datum. Detta är ingen svensk avskrivnings- eller skattepolicy. Varje bokföring kräver separat mänskligt godkännande.",
  unsupported:
    "Moms, lön och valutaomräkning stöds inte. Moms kräver granskade giltighetsdatum och avrundningsregler. Lön kräver fastställda anställnings- och regeluppgifter. Valutaomräkning kräver en uttrycklig rationell kurs, källa, datum och avrundningspolicy.",
  create: "Spara plan",
  revise: "Spara ny version",
  load: "Öppna plan",
  refresh: "Uppdatera planer",
  next: "Nästa sida",
  first: "Första sidan",
  empty:
    "Inga planer på denna sida. Det visar inte att registret över tillgångar eller periodiseringar är komplett.",
  sourceKey: "Stabil nyckel för källkomponenten",
  sourceKeyHelp:
    "Använd en nyckel för denna källkomponent. Behåll den vid återförsök. Hämta en befintlig plan i stället för att ange en andra nyckel.",
  name: "Planens namn",
  kind: "Typ av plan",
  asset: "Tillgång",
  deferral: "Periodisering",
  evidence: "ID för bevarat underlag",
  rationale: "Grund för belopp, datum och konton",
  cost: "Källans anskaffningsbelopp (heltal i minsta valutaenhet)",
  residual: "Restvärde (heltal i minsta valutaenhet)",
  debit: "Debetkonto",
  credit: "Kreditkonto",
  series: "Verifikationsserie",
  date: "Bokföringsdatum",
  period: "Bokföringsperiod",
  add: "Lägg till tillfälle",
  remove: "Ta bort sista tillfället",
  occurrence: "Tillfälle",
  amount: "Belopp (minsta valutaenhet)",
  policy:
    "Jag väljer lika heltal i minsta valutaenhet, med hela divisionsresten på det sista tillfället.",
  policyHelp:
    "Anskaffningsbelopp minus restvärde delas med antalet tillfällen. Minst en minsta valutaenhet krävs per tillfälle. Datum skapas inte automatiskt. Den matematiska fördelningen fastställer ingen redovisningspolicy.",
  invalid:
    "Kontrollera obligatoriska fält, exakta heltalsbelopp, olika konton och datum för varje tillfälle.",
  saved: "Planversionen har sparats. Inget har bokförts.",
  revision: "Version",
  history: "Oföränderlig versionshistorik",
  digest: "Versionens kontrollsumma",
  prepare: "Förbered eller hämta förslag",
  review: "Granska förslag",
  prepared: "Förslaget har bevarats. Granskning och mänskligt godkännande krävs fortfarande.",
  state: "Status",
  unprepared: "Inte förberett",
  preparedState: "Förberett, inte bokfört",
  posted: "Bokfört",
  reversed: "Återfört; ersättning stöds inte",
  conflicted: "Identitetskonflikt; granska verifikationen",
  recognized: "Nettoredovisat (minsta valutaenhet)",
  remaining: "Återstående inklusive restvärde (minsta valutaenhet)",
  balanceHelp:
    "Summorna följer planens kopplade bokföringar och återföringar. Ursprungligt inköp och kontrollkontots saldo är inte avstämda. En motstridig bokföring räknas inte med och måste granskas.",
  basisStandalone:
    "Ingen grund för redovisat värde är kopplad. Endast reglerna för fristående syntetisk beredning gäller; detta visar inte att källorna är fullständiga.",
  basisLinked:
    "En grund för redovisat värde är kopplad. Den bevaras vid beredning och kontrolleras igen vid bokföring. Senare återföring eller rättelse stoppar fortsatt redovisning. Detta är ingen godkänd regelpolicy.",
  basisBlocked:
    "Fortsatt redovisning är blockerad. Den kopplade grunden har återförts, rättats eller stämmer inte längre. Granska dess verifikation och tillgångskontrollerna. Byte av grund stöds inte.",
  basisUnknown:
    "Aktuell status för redovisningsgrunden saknas. Uppdatera före beredning. Förslagsgranskningen kontrollerar aktuella beroenden separat.",
  basisVoucher: "Verifikation för redovisningsgrund",
  basisDigest: "Kontrollsumma för redovisningsgrund",
  amendmentScheduleDigest: "Kontrollsumma för ändrad plan",
  amendment: "Operatörens ändringar",

  amendmentKind: "Aktuell ändring",
  amendmentNone: "Ingen ändring bevarad",
  future: "Framtida exklusive restvärde",
  reversedFace: "Återfört ansiktbelopp",
  amendmentNotice:
    "Detta är bevarade syntetiska operatörsuppgifter. De godkänner inte juridisk behandling och bevisar inte runtime- eller databasbeteende.",
  amendmentNoBasis: "En granskad kopplad redovisningsgrund krävs innan en ändring kan skickas.",
  amendmentNoSuffix: "Det finns ingen komplett framtida obokförd suffix att ändra.",
  amendmentStalePrefix:
    "Ett konfliktstillestånd blockerar ändringen. Granska verifikationen innan du försöker igen.",
  amendmentDatePrefix:
    "Datumändringar kräver att alla tillfällen före suffixet är bokförda och inte återförda.",
  amendmentBlockerBasis:
    "Stale blocker: den kopplade grunden har återförts, rättats eller stämmer inte längre.",
  amendmentBlockerEstimate:
    "Stale blocker: den granskade återstående uppskattningen bevarar inte längre den levande historiken.",
  amendmentBlockerDisposed:
    "Stale blocker: planen är avyttrad; senare ändringar och redovisning är blockerade.",
  amendmentBlockerUnknown:
    "Stale blocker: aktuell status för redovisningsgrunden saknas. Uppdatera innan du förbereder en ändring.",
  amendmentFirst: "Första återstående tillfälle",
  amendmentReviewEvidence: "ID för granskningsunderlag",
  amendmentRationale: "Motivering till ändringen",
  amendmentPeriods: "Framtida datum och perioder",
  amendmentInstallments: "Framtida installeringar",
  amendmentResidual: "Restvärde",
  amendmentDate: "Ändra framtida datum",
  amendmentEstimate: "Ändra återstående uppskattning",
  amendmentDateHelp:
    "Ersätt hela framtida suffixet. Belopp, konton, källa, restvärde och tillfallsidentiteter ändras inte.",
  amendmentEstimateHelp:
    "Ange varje framtida installering explicit. Servern kontrollerar bevarande, perioder, aktualitet och eventuell antalsändring.",
  amendmentAdd: "Lägg till framtida installering",
  amendmentRemove: "Ta bort sista framtida installering",
  amendmentOnlyOperator: "Ändringsgranskning är endast tillgänglig för operatörer.",
  frozen:
    "Planen kan inte redigeras via den vanliga versionsformuläret. Använd operatörens ändringskommandon ovan och förbered sedan ett nytt förslag för mänskligt godkännande.",
  pending: "Sparar…",
  evidenceCreate: "Bevara underlag",
  evidenceTitle: "Underlagets titel",
  content: "Källtext",
  origin: "Källans ursprung",
  evidenceSaved: "Underlaget har bevarats. Använd dess ID i planen.",
  newSchedule: "Skapa en annan plan",
  limit: "Högst 120 uttryckliga tillfällen och 20 oföränderliga versioner före beredning.",
};
