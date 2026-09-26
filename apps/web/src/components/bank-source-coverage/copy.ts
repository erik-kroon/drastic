import type * as Coverage from "@open-erp/contracts/bank-source-coverage";
import type { Locale } from "@/paraglide/runtime";

const enDiagnostics = {
  no_declared_accounts:
    "The reviewed inventory declares no bank accounts. This report does not infer an empty source family.",
  mapped_account_not_declared:
    "A retained bank source is mapped to this account, but the reviewed inventory does not declare it.",
  source_mapping_missing: "The declared account has no retained bank source mapping.",
  statements_missing: "No admitted statement intersects the requested interval.",
  statement_declared_incomplete: "The retained statement is explicitly declared incomplete.",
  statement_crosses_boundary:
    "The report cuts through this full statement. Partial boundary balances are not inferred.",
  source_identity_or_currency_mismatch:
    "The retained statement does not agree with the mapped source identity or book currency.",
  statement_balance_difference:
    "The retained opening plus normalized movements does not equal the retained closing.",
  statement_row_count_difference:
    "The retained statement and normalized observation row counts differ.",
  opening_checkpoint_unavailable:
    "No unique independently stated opening is available at the requested start.",
  closing_checkpoint_unavailable:
    "No unique independently stated closing is available at the requested end.",
} satisfies Record<typeof Coverage.BankSourceCoverageDiagnostic.Type, string>;

const svDiagnostics = {
  no_declared_accounts:
    "Den granskade inventeringen anger inga bankkonton. Rapporten antar inte att hela källfamiljen är tom.",
  mapped_account_not_declared:
    "En sparad bankkälla är kopplad till kontot, men kontot saknas i den granskade inventeringen.",
  source_mapping_missing: "Det angivna kontot saknar koppling till en sparad bankkälla.",
  statements_missing: "Inget inläst kontoutdrag berör det begärda intervallet.",
  statement_declared_incomplete:
    "Det sparade kontoutdraget är uttryckligen angivet som ofullständigt.",
  statement_crosses_boundary:
    "Rapportgränsen skär genom hela kontoutdraget. Inga delbalanser härleds.",
  source_identity_or_currency_mismatch:
    "Kontoutdragets källidentitet eller valuta stämmer inte med källkopplingen och boken.",
  statement_balance_difference:
    "Sparat ingående saldo plus normaliserade rörelser är inte lika med sparat utgående saldo.",
  statement_row_count_difference:
    "Antalet rader i kontoutdraget och de normaliserade observationerna skiljer sig.",
  opening_checkpoint_unavailable:
    "Ett unikt, självständigt angivet ingående saldo saknas vid intervallets början.",
  closing_checkpoint_unavailable:
    "Ett unikt, självständigt angivet utgående saldo saknas vid intervallets slut.",
} satisfies Record<typeof Coverage.BankSourceCoverageDiagnostic.Type, string>;

export function sourceCoverageCopy(locale: Locale) {
  return locale === "sv"
    ? {
        title: "Kontoutdragens intervalltäckning",
        inventory: "Granskad källinventering – ID",
        help: "Använd den senaste källinventeringen från periodens stängningsgranskning. Ange exakt samma periodgränser; båda datumen ingår. Rapporten granskar endast redan inlästa kontoutdrag.",
        warning:
          "Även utan upptäckta luckor är företagets och leverantörens fullständiga källtäckning okänd. Detta är inte kontoavstämning eller finansiell stängningsberedskap. Inga stängningskrav ändras.",
        starts: "Från och med",
        ends: "Till och med",
        capture: "Spara intervallgranskning",
        another: "Spara en ny granskning",
        invalid: "Ange giltiga identifierare och periodens ordnade start- och slutdatum.",
        saved: "Sparade granskningar",
        empty: "Inga intervallgranskningar är sparade.",
        open: "Öppna rapport",
        reportId: "Rapport-ID",
        refresh: "Uppdatera",
        gaps: "Granskningspunkter finns i det sparade underlaget.",
        noGaps: "Inga luckor eller balansavvikelser upptäcktes inom detta begränsade underlag.",
        current: "Underlaget var oförändrat vid den senaste lyckade uppdateringen.",
        historical:
          "Vid den senaste lyckade uppdateringen hade underlaget ändrats eller överskred läsgränserna. Rapportens sparade innehåll är oförändrat.",
        currentnessUnknown:
          "Aktuell status är okänd. Rapportens tidigare kontrollerade innehåll kan fortfarande läsas och laddas ner.",
        sequence: "Sparad bokföringssekvens",
        currency: "Valuta / decimalskala",
        units: "Alla belopp är exakta heltal i minsta valutaenhet.",
        digest: "Rapportens kontrollsumma",
        sourceRevision: "Källrevision",
        accountVersion: "Kontoversion",
        mappedSource: "Kopplad bankkälla",
        accounts: "Angivna och kända källkonton",
        declared: "Angivet i inventeringen",
        notDeclared: "Inte angivet i inventeringen",
        missing: "Saknas / inte tillgängligt",
        opening: "Självständigt angivet ingående saldo",
        closing: "Självständigt angivet utgående saldo",
        intervalGaps: "Datum utan något sparat kontoutdrag",
        overlaps: "Överlappande kontoutdrag",
        adjacent: "Angivna saldon vid angränsande intervall",
        adjacency:
          "Angränsande innebär att nästa utdrag börjar dagen efter föregående slutdag. Vid luckor jämförs inte saldona. Överlapp avgörs aldrig automatiskt.",
        noPairs: "Inga angränsande kontoutdrag med jämförbar källidentitet och valuta finns.",
        left: "Föregående utdrag",
        right: "Nästa utdrag",
        difference: "Differens: nästa ingående minus föregående utgående",
        statements: "Hela sparade kontoutdrag",
        evidence: "Underlags-ID",
        basis: "Uppgiven fullständighetsgrund",
        movement: "Normaliserade rörelser",
        movementDifference: "Ingående + rörelser − utgående",
        rowCount: "Normaliserat radantal",
        rows: "Sparade källrader",
        row: "Rad",
        date: "Datum",
        description: "Beskrivning",
        amount: "Belopp",
        provider: "Leverantörsreferens",
        download: "Hämta exakt sparad JSON",
        downloadWarning:
          "Filen innehåller känsliga källrader, identifierare och belopp. Spara och dela den säkert.",
        artifactError:
          "De sparade JSON-byten, kontrollsumman eller rapportidentiteten kunde inte verifieras.",
        limits:
          "Gränser: 100 angivna/kända konton, 200 berörda kontoutdrag, 10000 hela källrader, 200 rapporter och 8 MiB JSON. Överskridanden avvisas utan trunkering.",
        diagnostics: svDiagnostics,
      }
    : {
        title: "Statement interval coverage",
        inventory: "Reviewed source inventory ID",
        help: "Use the latest source inventory from the period's closing review. Enter that exact period's boundaries; both dates are inclusive. This report inspects admitted statements only.",
        warning:
          "Even without detected gaps, full-company/provider source coverage remains unknown. This is not account reconciliation or financial-close readiness. No closing requirement changes.",
        starts: "Starts on (inclusive)",
        ends: "Ends on (inclusive)",
        capture: "Save interval review",
        another: "Save a new review",
        invalid: "Enter valid identifiers and the period's ordered start/end dates.",
        saved: "Saved reviews",
        empty: "No interval reviews are saved.",
        open: "Open report",
        reportId: "Report ID",
        refresh: "Refresh",
        gaps: "The captured basis contains review gaps.",
        noGaps: "No interval gaps or balance differences were detected within this bounded basis.",
        current: "At the last successful refresh, the basis was unchanged.",
        historical:
          "At the last successful refresh, the basis had changed or exceeded current read bounds. The saved report content is unchanged.",
        currentnessUnknown:
          "Current status is unknown. The previously verified report can still be read and downloaded.",
        sequence: "Captured ledger sequence",
        currency: "Currency / scale",
        units: "All amounts are exact integer minor units.",
        digest: "Report digest",
        sourceRevision: "Source revision",
        accountVersion: "Account version",
        mappedSource: "Mapped bank source",
        accounts: "Declared and known source accounts",
        declared: "Declared in inventory",
        notDeclared: "Not declared in inventory",
        missing: "Missing / unavailable",
        opening: "Independently stated opening",
        closing: "Independently stated closing",
        intervalGaps: "Dates without any retained statement",
        overlaps: "Overlapping statements",
        adjacent: "Stated balances across adjacent intervals",
        adjacency:
          "Adjacent means the next statement starts the day after the previous end. Balances across gaps are not compared. Overlaps are never resolved automatically.",
        noPairs: "There are no adjacent statements with comparable source identity and currency.",
        left: "Previous statement",
        right: "Next statement",
        difference: "Difference: next opening minus previous closing",
        statements: "Full retained statements",
        evidence: "Evidence ID",
        basis: "Declared completeness basis",
        movement: "Normalized movements",
        movementDifference: "Opening + movements − closing",
        rowCount: "Normalized row count",
        rows: "Retained source rows",
        row: "Row",
        date: "Date",
        description: "Description",
        amount: "Amount",
        provider: "Provider reference",
        download: "Download exact retained JSON",
        downloadWarning:
          "This file contains sensitive source rows, identifiers and amounts. Store and share it securely.",
        artifactError: "The retained JSON bytes, hash or report identity could not be verified.",
        limits:
          "Bounds: 100 declared/known accounts, 200 intersecting statements, 10000 full source rows, 200 reports and 8 MiB JSON. Oversized captures refuse without truncation.",
        diagnostics: enDiagnostics,
      };
}
