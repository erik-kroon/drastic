import type { Locale } from "@/paraglide/runtime";

const en = {
  title: "Customer-invoice drafts",
  boundary:
    "Commercial drafts only. Saving retains facts and calculations; it does not issue an invoice number, post accounting, settle an invoice or deliver a document. Legal identity and tax treatment are not verified.",
  limits:
    "Up to 200 drafts per book, 50 immutable revisions per draft and 50 lines per revision. List and history show the complete bounded summary set. Retain retry keys and exact request values before leaving or switching drafts.",
  create: "Save new draft",
  revise: "Save new draft revision",
  edit: "Edit current revision",
  draftKey: "Stable internal draft key (not an invoice number)",
  draftTitle: "Draft title",
  seller: "Seller identity asserted by the source",
  customer: "Customer identity asserted by the source",
  identityNote:
    "Evidence must already be retained in this book. Blank optional facts are stored as unknown, not verified or inapplicable.",
  legalName: "Legal name",
  registrationId: "Registration identifier",
  taxId: "Tax identifier",
  address: "Postal address",
  countryCode: "Country code (two uppercase letters)",
  evidenceId: "Retained identity evidence ID",
  counterpart: "Existing customer counterpart ID",
  counterpartRevision: "Reviewed current counterpart revision",
  currency: "Currency",
  scale: "Currency scale (0–6, must match the book)",
  plannedIssueDate: "Planned issue date (not an issue event)",
  supplyDate: "Supply date",
  dueDate: "Proposed due date",
  terms: "Payment terms",
  optional:
    "Leave unknown optional values blank. Enter explicit 0 only when the source actually asserts zero.",
  lines: "Exact commercial lines",
  description: "Line description",
  quantity: "Positive decimal quantity",
  unitPrice: "Unit price in minor units (optional)",
  base: "Explicit line base minor units",
  discount: "Discount minor units",
  charge: "Charge minor units",
  tax: "Asserted tax minor units (optional)",
  taxDescription: "Asserted tax treatment (optional)",
  taxEvidence: "Tax evidence ID (optional)",
  sourceGross: "Source line gross minor units (optional)",
  sourceTotal: "Source document total minor units (optional)",
  lineHelp:
    "Use integer minor-unit strings for amounts. No rounding or VAT rate is inferred. Quantity may have up to six decimals without trailing zeros. Tax remains unknown when blank. Source totals are checked, never used to hide differences.",
  addLine: "Add line",
  removeLine: "Remove line",
  reason: "Reason for this revision",
  current: "Open current revision",
  revision: "Retained revision",
  currentRevision: "Current revision",
  id: "Draft ID",
  open: "Open draft",
  refresh: "Refresh saved drafts",
  empty: "No commercial drafts have been saved in this book.",
  count: "Complete saved draft count",
  history: "All retained revision summaries",
  unknown: "Unknown",
  gross: "Calculated gross minor units",
  net: "Calculated net minor units",
  blockers: "Issuance blockers",
  captured: "Captured at",
  digest: "Revision digest",
  details: "Exact retained content and calculation basis",
  download: "Download retained draft revision JSON",
  historyReadOnly: "Historical revision. Open the current revision to start an edit.",
  operator:
    "Only a current book operator can save drafts. Agent credentials may read but cannot write them.",
  editing:
    "Editing this retained revision; later refreshes do not replace its expected digest or unsaved fields.",
};
const sv = {
  title: "Kundfakturautkast",
  boundary:
    "Endast kommersiella utkast. Spara bevarar uppgifter och beräkningar; det utfärdar inget fakturanummer, bokför inte, reglerar ingen faktura och skickar inget dokument. Juridisk identitet och skattebehandling är inte verifierade.",
  limits:
    "Högst 200 utkast per bok, 50 oföränderliga revisioner per utkast och 50 rader per revision. Listor visar hela den begränsade uppsättningen sammanfattningar. Spara återförsöksnyckeln och exakta begäran innan du lämnar eller byter utkast.",
  create: "Spara nytt utkast",
  revise: "Spara ny utkastrevision",
  edit: "Redigera aktuell revision",
  draftKey: "Stabil intern utkastnyckel (inte fakturanummer)",
  draftTitle: "Utkastets rubrik",
  seller: "Säljaridentitet enligt källan",
  customer: "Kundidentitet enligt källan",
  identityNote:
    "Underlag måste redan vara bevarat i denna bok. Tomma valfria uppgifter sparas som okända, inte verifierade eller ej tillämpliga.",
  legalName: "Juridiskt namn",
  registrationId: "Registreringsnummer",
  taxId: "Skatteidentifierare",
  address: "Postadress",
  countryCode: "Landskod (två versaler)",
  evidenceId: "ID för bevarat identitetsunderlag",
  counterpart: "Befintligt kundmotparts-ID",
  counterpartRevision: "Granskad aktuell motpartsrevision",
  currency: "Valuta",
  scale: "Valutaskala (0–6, måste matcha boken)",
  plannedIssueDate: "Planerat fakturadatum (inte utfärdande)",
  supplyDate: "Leveransdatum",
  dueDate: "Föreslaget förfallodatum",
  terms: "Betalningsvillkor",
  optional: "Lämna okända valfria värden tomma. Ange 0 endast när källan faktiskt anger noll.",
  lines: "Exakta kommersiella rader",
  description: "Radbeskrivning",
  quantity: "Positiv decimalkvantitet",
  unitPrice: "Enhetspris i minor units (valfritt)",
  base: "Uttryckligt radunderlag i minor units",
  discount: "Rabatt i minor units",
  charge: "Tillägg i minor units",
  tax: "Angiven skatt i minor units (valfritt)",
  taxDescription: "Angiven skattebehandling (valfritt)",
  taxEvidence: "Skatteunderlags-ID (valfritt)",
  sourceGross: "Källans bruttoradbelopp i minor units (valfritt)",
  sourceTotal: "Källans dokumenttotal i minor units (valfritt)",
  lineHelp:
    "Belopp anges som heltalssträngar i minor units. Ingen avrundning eller momssats antas. Kvantitet får ha högst sex decimaler utan avslutande nollor. Tom skatt förblir okänd. Källtotaler kontrolleras, aldrig för att dölja differenser.",
  addLine: "Lägg till rad",
  removeLine: "Ta bort rad",
  reason: "Orsak till revisionen",
  current: "Öppna aktuell revision",
  revision: "Bevarad revision",
  currentRevision: "Aktuell revision",
  id: "Utkast-ID",
  open: "Öppna utkast",
  refresh: "Uppdatera sparade utkast",
  empty: "Inga kommersiella utkast har sparats i denna bok.",
  count: "Fullständigt antal sparade utkast",
  history: "Alla bevarade revisionssammanfattningar",
  unknown: "Okänt",
  gross: "Beräknat brutto i minor units",
  net: "Beräknat netto i minor units",
  blockers: "Hinder för utfärdande",
  captured: "Sparad tidpunkt",
  digest: "Revisionens digest",
  details: "Exakta bevarade uppgifter och beräkningsunderlag",
  download: "Ladda ner bevarad utkastrevision som JSON",
  historyReadOnly: "Historisk revision. Öppna aktuell revision för att börja redigera.",
  operator:
    "Endast en aktuell bokoperatör får spara utkast. Agentbehörighet får läsa men inte skriva.",
  editing:
    "Redigerar denna bevarade revision; senare uppdateringar ersätter inte dess förväntade digest eller osparade fält.",
} satisfies Record<keyof typeof en, string>;
const blockers = {
  issuance_not_implemented: {
    en: "This draft does not itself activate legal invoice issuance.",
    sv: "Utkastet aktiverar inte juridisk fakturering på egen hand.",
  },
  legal_identity_not_verified: {
    en: "This draft does not verify seller and customer identities against a legal policy.",
    sv: "Utkastet verifierar inte säljarens och kundens identiteter mot en juridisk policy.",
  },
  tax_profile_not_activated: {
    en: "This draft does not bind a legal policy to a separately activated accounting profile.",
    sv: "Utkastet binder inte en juridisk policy till en separat aktiverad bokföringsprofil.",
  },
  seller_identity_fields_missing: {
    en: "Add the seller’s registration number, address and country.",
    sv: "Ange säljarens registreringsnummer, adress och land.",
  },
  customer_identity_fields_missing: {
    en: "Add the customer’s registration number, address and country.",
    sv: "Ange kundens registreringsnummer, adress och land.",
  },
  dates_or_terms_missing: {
    en: "Planned dates or payment terms are unknown.",
    sv: "Planerade datum eller betalningsvillkor är okända.",
  },
  tax_inputs_unreviewed: {
    en: "Tax amount, treatment or evidence is missing.",
    sv: "Skattebelopp, behandling eller underlag saknas.",
  },
  quantity_price_not_exact: {
    en: "Quantity × unit price is unknown or needs an unsupported rounding policy.",
    sv: "Kvantitet × enhetspris är okänt eller kräver en avrundningsregel som inte stöds.",
  },
  line_base_mismatch: {
    en: "The exact quantity × unit price differs from the retained line base.",
    sv: "Exakt kvantitet × enhetspris skiljer sig från bevarat radunderlag.",
  },
  line_total_mismatch: {
    en: "Calculated line gross differs from the source amount.",
    sv: "Beräknat radbrutto skiljer sig från källbeloppet.",
  },
  document_total_mismatch: {
    en: "Calculated document gross differs from the source total.",
    sv: "Beräknat dokumentbrutto skiljer sig från källtotalen.",
  },
};
export function invoiceDraftCopy(locale: Locale) {
  return locale === "sv" ? sv : en;
}
export function invoiceDraftBlocker(code: string, locale: Locale) {
  const message = Object.entries(blockers).find(([key]) => key === code)?.[1];
  return message?.[locale === "sv" ? "sv" : "en"] ?? code;
}
