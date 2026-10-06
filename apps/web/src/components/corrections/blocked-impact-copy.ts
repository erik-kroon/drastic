import type { Locale } from "@/paraglide/runtime";

const en = {
  periodFallback: "the period",
  stopped: "Blocked",
  periodTitle: (month: string) => "The correction cannot be posted in " + month,
  periodStatus: (period: string) => "Requires reopening " + period,
  conditionalPeriod: (period: string) => "If " + period + " is reopened",
  panelTitle: "What changes and what is retained",
  periodLabel: (period: string) => "Period " + period,
  periodTransition: "Locked to open",
  closingBasis: "Closing basis",
  staleBasis: "Stale, prepared again",
  vatBasis: (period: string) => "VAT basis " + period,
  filedLabel: (date: string) => "Filed return, " + date,
  retained: "Retained unchanged",
  impactCase: "Impact case",
  futureCase: "Created for a corrected return",
  reports: "Saved report snapshots",
  retainedContent: "Content retained",
  steps: "STEPS",
  request: (name: string) => "1. Request by " + name,
  complete: "Complete",
  reviewer: (name: string) => "2. Reopening, " + name,
  waiting: "Awaiting you",
  reopening: "1. Reopening",
  newBundle: (number: number) => number + ". New correction bundle",
  afterOpening: "After reopening",
  vatStep: (number: number) => number + ". Corrected VAT return",
  separateApproval: "Separate approval",
  differences: "WHAT THE CORRECTION CHANGES",
  posted: (original: string) => "Posted in " + original,
  invoiceProposed: "According to the invoice",
  proposed: "Proposed",
  delta: "Difference",
  vatTitle: (period: string, date: string, time: string) =>
    "VAT RETURN " +
    period.toUpperCase() +
    ", FILED " +
    date.toUpperCase() +
    ", ACKNOWLEDGEMENT " +
    time,
  vatBox: "Box",
  filed: "Filed",
  corrected: "After correction",
  inputVat: "48 Input VAT",
  vatPayable: "49 VAT payable",
  filedNote:
    "The filed return and its acknowledgement remain unchanged. A corrected return needs separate approval.",
  choices: "CHOICES",
  selectedChoice: (period: string) => "Reopen " + period + " and prepare a new correction bundle",
  selectedDetail: "Reopening needs separate approval from someone other than its requester.",
  blockedChoice: (month: string) => "Post only the account in " + month + ", without changing VAT",
  blockedDetail: "Blocked. VAT and the liability would still differ from the invoice.",
  blocked: "Blocked",
};

const sv: typeof en = {
  periodFallback: "perioden",
  stopped: "Stoppad",
  periodTitle: (month) => "Rättelsen kan inte bokföras i " + month,
  periodStatus: (period) => "Kräver att " + period + " öppnas",
  conditionalPeriod: (period) => "Om " + period + " öppnas",
  panelTitle: "Vad som ändras och vad som bevaras",
  periodLabel: (period) => "Period " + period,
  periodTransition: "Låst till öppen",
  closingBasis: "Stängningsunderlag",
  staleBasis: "Inaktuellt, görs om",
  vatBasis: (period) => "Momsunderlag " + period,
  filedLabel: (date) => "Inlämnad deklaration, " + date,
  retained: "Bevaras oförändrad",
  impactCase: "Påverkansärende",
  futureCase: "Skapas, rättad deklaration",
  reports: "Sparade rapportbilder",
  retainedContent: "Behåller innehåll",
  steps: "STEG",
  request: (name) => "1. Begäran av " + name,
  complete: "Klar",
  reviewer: (name) => "2. Öppnande, " + name,
  waiting: "Väntar på dig",
  reopening: "1. Öppnande",
  newBundle: (number) => number + ". Nytt rättelsepaket",
  afterOpening: "Efter öppnandet",
  vatStep: (number) => number + ". Rättad momsdeklaration",
  separateApproval: "Eget godkännande",
  differences: "VAD RÄTTELSEN ÄNDRAR",
  posted: (original) => "Bokfört i " + original,
  invoiceProposed: "Enligt fakturan",
  proposed: "Enligt förslaget",
  delta: "Skillnad",
  vatTitle: (period, date, time) =>
    "MOMSDEKLARATION " +
    period.toUpperCase() +
    ", INLÄMNAD " +
    date.toUpperCase() +
    ", KVITTENS " +
    time,
  vatBox: "Ruta",
  filed: "Inlämnad",
  corrected: "Efter rättelse",
  inputVat: "48 Ingående moms",
  vatPayable: "49 Moms att betala",
  filedNote:
    "Den inlämnade deklarationen och dess kvittens ändras aldrig. En rättad deklaration behövs och får ett eget godkännande.",
  choices: "VAL",
  selectedChoice: (period) => "Öppna " + period + " och förbered ett nytt rättelsepaket",
  selectedDetail: "Öppnandet godkänns separat av en annan person än den som begär det.",
  blockedChoice: (month) => "Bokför bara kontot i " + month + ", utan att ändra momsen",
  blockedDetail:
    "Stoppad. Det rättar inte felet, momsen och skulden skulle fortsätta avvika från fakturan.",
  blocked: "Stoppad",
};

export type BlockedImpactCopy = typeof en;

export function blockedImpactCopy(locale: Locale): BlockedImpactCopy {
  return locale === "sv" ? sv : en;
}
