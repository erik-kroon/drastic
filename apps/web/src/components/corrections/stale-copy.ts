import type { Locale } from "@/paraglide/runtime";

const en = {
  example: "Example data",
  currentState: "Current state",
  prepareAgain: "Nothing is posted, prepare again",
  notPosted: "Not posted",
  retained: "Retained, unchanged",
  yourApproval: "Your approval",
  denied: "Denied",
  preparedOutdated: "1. Prepared, outdated",
  approvalDenied: "2. Approval denied",
  basisChanged: "2. Basis changed",
  prepareNext: "3. Prepare again on the current basis",
  next: "Next",
  newApproval: "4. New approval",
  afterStep3: "After step 3",
  whatChanged: "WHAT CHANGED",
  event: "Event",
  whyInvalid: "Why it is no longer valid",
  invoiceInvalid: "The replacement would leave an incorrect invoice balance and allocation",
  open: "Open",
  locked: "Locked",
  accounts: "Accounts",
  active: "Active",
  inactive: "Inactive",
  and: " and ",
  count: "items",
  fresh: "New",
  oldApproval:
    "An old approval never carries into a new bundle. The new bundle requires its own approval on its own digest.",
  warning: (denied: string, changed: string) =>
    `Approval was denied ${denied}. The basis changed at ${changed} after preparation. Nothing was posted.`,
  description: (reversal: string, replacement: string, original: string) =>
    `${reversal} and ${replacement} belong together and can only be posted together. Neither is posted and ${original} is unchanged.`,
  digest: (before: string, now: string) =>
    `Approval covered ${before}. It no longer matches the current basis, ${now}.`,
  allocationEvent: (date: string, name: string, amount: string, invoice: string) =>
    `${date}, ${name} allocated ${amount} to invoice ${invoice}`,
};

const sv: typeof en = {
  example: "Exempeldata",
  currentState: "Vad som gäller nu",
  prepareAgain: "Inget är bokfört, förbered om",
  notPosted: "Inte bokförd",
  retained: "Bevarat, oförändrat",
  yourApproval: "Ditt godkännande",
  denied: "Nekat",
  preparedOutdated: "1. Förberedd, inaktuell",
  approvalDenied: "2. Godkännande nekades",
  basisChanged: "2. Underlaget ändrades",
  prepareNext: "3. Förbered om på nuvarande underlag",
  next: "Nästa",
  newApproval: "4. Nytt godkännande",
  afterStep3: "Efter steg 3",
  whatChanged: "VAD SOM ÄNDRADES",
  event: "Händelse",
  whyInvalid: "Därför inte längre giltigt",
  invoiceInvalid: "Ersättningen skulle lämna fakturan med fel saldo och fel fördelning",
  open: "Öppen",
  locked: "Låst",
  accounts: "Konton",
  active: "Aktiva",
  inactive: "Inaktiva",
  and: " och ",
  count: "st",
  fresh: "Ny",
  oldApproval:
    "Ett gammalt godkännande flyttas aldrig över till ett nytt paket. Det nya paketet får ett eget godkännande på sin egen kontrollsumma.",
  warning: (denied, changed) =>
    `Godkännandet nekades ${denied}. Underlaget ändrades kl ${changed}, efter att paketet förbereddes. Inget är bokfört.`,
  description: (reversal, replacement, original) =>
    `Backningen ${reversal} och ersättningen ${replacement} hörde ihop och kunde bara bokföras tillsammans. Ingen av dem är bokförd, och ${original} är oförändrat.`,
  digest: (before, now) =>
    `Godkännandet gällde kontrollsumman ${before}. Den passar inte längre underlaget, ${now}.`,
  allocationEvent: (date, name, amount, invoice) =>
    `${date}, ${name} kopplade betalning ${amount} till faktura ${invoice}`,
};

export function staleCopy(locale: Locale) {
  return locale === "sv" ? sv : en;
}
