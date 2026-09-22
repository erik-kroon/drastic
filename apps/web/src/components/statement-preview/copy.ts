import type { Locale } from "@/paraglide/runtime";

const en = {
  title: "Review a bank statement",
  intro: "Choose a SEB CSV to review its transactions and balances before bookkeeping.",
  local:
    "The file stays in this browser tab. Nothing is uploaded or posted. Save the review before leaving, reloading or changing language.",
  file: "SEB statement CSV",
  format:
    "UTF-8, newest transactions first, up to 1 MiB and 10,000 transactions. Use the six-column export with booking date, value date, text, type, amount and balance.",
  currency: "Statement currency",
  chooseCurrency: "Select the currency on your bank statement",
  currencyHelp:
    "This export does not identify its currency. Currently only statements you confirm are in SEK can be reviewed.",
  inspect: "Review statement",
  reading: "Reading statement…",
  ready: "Statement preview ready. No accounting entries created.",
  clear: "Clear preview",
  home: "Back to accounting",
  download: "Save review",
  downloadHelp:
    "Keep the downloaded review with the original CSV. It records the file fingerprint and every source row; it is not a bookkeeping import or an archive of the original file.",
  source: "Original file",
  hash: "File fingerprint (SHA-256)",
  controls: "Statement totals",
  field: "Check",
  value: "Value",
  count: "Transactions",
  incoming: "Money in",
  outgoing: "Money out",
  opening: "Opening balance inferred from oldest row",
  closing: "Last recorded balance",
  consistent: "Running balances agree between all adjacent transactions.",
  differences: "Running balances disagree at these source rows:",
  coverage:
    "Account identity and complete period coverage are unconfirmed. The last recorded balance does not confirm the balance at your financial year end.",
  transactions: "Source transactions",
  row: "Source row",
  booked: "Booking date",
  valued: "Value date",
  description: "Bank text",
  type: "Transaction type",
  amount: "Amount (SEK)",
  balance: "Balance (SEK)",
  previous: "Previous rows",
  next: "Next rows",
  line: "Source line",
  errors: {
    size: "The file is larger than 1 MiB. Export a shorter interval and try again.",
    encoding: "The file is not valid UTF-8. Choose the original UTF-8 SEB export.",
    csv: "A CSV record is malformed or incomplete. Check the source line in the original export.",
    header:
      "Choose a SEB export with these columns: Bokförd, Valutadatum, Text, Typ, Insättningar/uttag, Bokfört saldo.",
    empty: "The file has no transactions. Choose an export containing transactions.",
    rows: "The file contains more than 10,000 transactions. Export a shorter interval.",
    date: "A date is invalid. Dates must use YYYY-MM-DD.",
    amount:
      "An amount or balance is invalid. Use a decimal point and exactly two decimal places, without thousands separators.",
    order:
      "Transactions must be exported newest first. Choose the original SEB export in that order.",
    read: "The file could not be read. Select it again and retry.",
  },
};

const sv: typeof en = {
  title: "Granska ett kontoutdrag",
  intro: "Välj en CSV-fil från SEB för att granska transaktioner och saldon inför bokföringen.",
  local:
    "Filen stannar i den här webbläsarfliken. Inget laddas upp eller bokförs. Spara granskningen innan du lämnar sidan, laddar om eller byter språk.",
  file: "SEB-kontoutdrag som CSV",
  format:
    "UTF-8, senaste transaktionerna först, högst 1 MiB och 10 000 transaktioner. Använd exporten med sex kolumner: bokföringsdatum, valutadatum, text, typ, belopp och saldo.",
  currency: "Kontoutdragets valuta",
  chooseCurrency: "Välj valutan som står på bankens kontoutdrag",
  currencyHelp:
    "Exporten anger inte valuta. För närvarande kan du granska kontoutdrag som du bekräftar är i SEK.",
  inspect: "Granska kontoutdrag",
  reading: "Läser kontoutdrag…",
  ready: "Förhandsgranskningen är klar. Inget har bokförts.",
  clear: "Rensa förhandsgranskning",
  home: "Tillbaka till bokföringen",
  download: "Spara granskning",
  downloadHelp:
    "Spara granskningen tillsammans med originalfilen. Den innehåller filens kontrollsumma och alla källrader, men är inte en bokföringsimport eller ett arkiv av originalfilen.",
  source: "Originalfil",
  hash: "Filens kontrollsumma (SHA-256)",
  controls: "Kontoutdragets summering",
  field: "Kontroll",
  value: "Värde",
  count: "Transaktioner",
  incoming: "Insättningar",
  outgoing: "Uttag",
  opening: "Ingående saldo beräknat från äldsta raden",
  closing: "Senast angivna saldo",
  consistent: "Löpande saldon stämmer mellan alla intilliggande transaktioner.",
  differences: "Löpande saldon avviker vid dessa källrader:",
  coverage:
    "Kontots identitet och periodens fullständighet är inte bekräftade. Senast angivna saldo bekräftar inte saldot vid räkenskapsårets slut.",
  transactions: "Källans transaktioner",
  row: "Källrad",
  booked: "Bokföringsdatum",
  valued: "Valutadatum",
  description: "Banktext",
  type: "Transaktionstyp",
  amount: "Belopp (SEK)",
  balance: "Saldo (SEK)",
  previous: "Föregående rader",
  next: "Nästa rader",
  line: "Rad i källfilen",
  errors: {
    size: "Filen är större än 1 MiB. Exportera ett kortare intervall och försök igen.",
    encoding: "Filen är inte giltig UTF-8. Välj SEB:s originalexport i UTF-8.",
    csv: "En CSV-post är felaktig eller ofullständig. Kontrollera raden i originalexporten.",
    header:
      "Välj en SEB-export med kolumnerna Bokförd, Valutadatum, Text, Typ, Insättningar/uttag, Bokfört saldo.",
    empty: "Filen saknar transaktioner. Välj en export som innehåller transaktioner.",
    rows: "Filen innehåller fler än 10 000 transaktioner. Exportera ett kortare intervall.",
    date: "Ett datum är ogiltigt. Datum ska anges som ÅÅÅÅ-MM-DD.",
    amount:
      "Ett belopp eller saldo är ogiltigt. Använd decimalpunkt och exakt två decimaler utan tusentalsavgränsare.",
    order:
      "Transaktionerna måste vara exporterade med den senaste först. Välj SEB:s originalexport i den ordningen.",
    read: "Filen kunde inte läsas. Välj den igen och försök på nytt.",
  },
};

export function statementCopy(locale: Locale) {
  return locale === "sv" ? sv : en;
}
