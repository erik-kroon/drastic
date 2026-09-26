import type { Locale } from "@/paraglide/runtime";

const en = {
  title: "Cancel demo invoice",
  boundary:
    "Cancelling reverses the whole invoice’s original posting. It does not refund a payment or issue a legal credit note.",
  retained: "The original invoice, number and saved documents remain in your history.",
  requirements:
    "Any matched payments must be undone first. The original and cancellation periods must both be open.",
  cancelled:
    "Invoice cancelled. Its original posting has been reversed. No refund or legal credit note was issued.",
  unknown: "Checking the invoice and its approval…",
  refresh: "Refresh status",
  prepare: "Review cancellation",
  newReview: "Start a new review",
  period: "Accounting period",
  date: "Cancellation date",
  reason: "Reason for cancellation",
  acknowledge:
    "I understand this cancels the whole demo invoice without a refund or legal credit note.",
  history: "Previous reviews",
  review: "Review cancellation",
  original: "Invoice",
  amount: "Amount to reverse",
  invoice: "Original invoice details",
  posting: "Posting to reverse",
  evidence: "Original source",
  account: "Account",
  debit: "Debit",
  credit: "Credit",
  ready: "Review the amount, reason and posting before approving.",
  stale:
    "This review can no longer be used. Refresh the invoice and start a new review with its current details.",
  approve: "Approve cancellation",
  execute: "Cancel invoice",
  authority: "Approval is valid for one hour and must be used by the person who approved it.",
  expired: "The previous approval has expired or is no longer usable. Approve again to continue.",
  expires: "Approved until",
  operator: "A book operator is needed to cancel this invoice.",
  revoke: "Withdraw approval",
  revokeReason: "Reason for withdrawing",
  technical: "Review details and history",
  approvals: "Approval history",
  receipt: "Cancellation receipt",
  journal: "Reversal details",
};

const sv: typeof en = {
  title: "Makulera demofaktura",
  boundary:
    "Makuleringen återför fakturans hela ursprungliga bokföring. Den återbetalar ingen betalning och skapar ingen juridisk kreditfaktura.",
  retained: "Ursprunglig faktura, nummer och sparade dokument finns kvar i historiken.",
  requirements:
    "Eventuella matchade betalningar måste ångras först. Både ursprungsperioden och makuleringsperioden måste vara öppna.",
  cancelled:
    "Fakturan är makulerad. Den ursprungliga bokföringen har återförts. Ingen återbetalning eller juridisk kreditfaktura har skapats.",
  unknown: "Kontrollerar fakturan och godkännandet…",
  refresh: "Uppdatera status",
  prepare: "Granska makulering",
  newReview: "Starta ny granskning",
  period: "Bokföringsperiod",
  date: "Makuleringsdatum",
  reason: "Skäl till makulering",
  acknowledge:
    "Jag förstår att detta makulerar hela demofakturan utan återbetalning eller juridisk kreditfaktura.",
  history: "Tidigare granskningar",
  review: "Granska makulering",
  original: "Faktura",
  amount: "Belopp att återföra",
  invoice: "Ursprungliga fakturauppgifter",
  posting: "Bokföring att återföra",
  evidence: "Ursprungligt underlag",
  account: "Konto",
  debit: "Debet",
  credit: "Kredit",
  ready: "Granska belopp, skäl och bokföring innan du godkänner.",
  stale:
    "Granskningen kan inte längre användas. Uppdatera fakturan och starta en ny granskning med aktuella uppgifter.",
  approve: "Godkänn makulering",
  execute: "Makulera faktura",
  authority: "Godkännandet gäller i en timme och måste användas av personen som godkände.",
  expired:
    "Det tidigare godkännandet har löpt ut eller kan inte längre användas. Godkänn igen för att fortsätta.",
  expires: "Godkänt till",
  operator: "En bokoperatör behöver makulera fakturan.",
  revoke: "Återkalla godkännande",
  revokeReason: "Skäl till återkallande",
  technical: "Granskningsuppgifter och historik",
  approvals: "Godkännandehistorik",
  receipt: "Makuleringskvitto",
  journal: "Återföringsuppgifter",
};

export const invoiceCancellationCopy = (locale: Locale) => (locale === "sv" ? sv : en);
