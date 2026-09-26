const en = {
  title: "SIE 4I transaction transfer",
  warning:
    "Synthetic preparation only. This is not a full-book export, opening balance, statutory filing or certified importer compatibility. Importing the file elsewhere can create duplicate transactions. Review the destination before importing; OpenERP sends nothing.",
  selection:
    "Includes every complete movement voucher in this saved pack. Opening and excluded later entries are not included. Account and source text must be representable in CP437; control characters and literal backslashes are refused.",
  legalName: "Explicit legal company name for this synthetic transfer",
  evidence: "Retained legal-name evidence ID",
  prepare: "Prepare SIE 4I bytes",
  retry:
    "Retry unchanged input after an uncertain response. Use Refresh capture inventory below to discover newly saved captures. A capture that could not render is not a ready file.",
  another: "Start a separate capture",
  retained: "Saved SIE captures in this book",
  empty: "No SIE captures saved.",
  inspect: "Read capture",
  resume: "Resume captured rendering",
  captured: "Captured — no sealed file",
  sealed: "Bytes retained — external acceptance not established",
  next: "Next capture page",
  first: "First capture page",
  refresh: "Refresh capture inventory",
  inventoryCount: "Captured membership count",
  inventoryCutoff: "Inventory cutoff",
  inventoryNote:
    "Pages retain the same capture membership. Refresh explicitly to include new captures. Read a capture to see whether its bytes are now sealed.",
  invalid: "Enter the legal name and retained evidence ID.",
  pack: "Source review pack",
  generatedOn: "Generation date",
  source: "Captured source and scope",
  download: "Verify retained binary bytes",
  save: "Save binary .SI file",
  bytes: "bytes",
  verified:
    "Downloaded bytes match the retained length and SHA-256. This does not validate the SIE format or importer acceptance.",
  hash: "SHA-256 of retained CP437 bytes",
};

const sv: typeof en = {
  title: "SIE 4I-transaktionsöverföring",
  warning:
    "Endast syntetisk förberedelse. Detta är inte en fullständig bokföringsexport, ingående balans, myndighetsinlämning eller certifierad importkompatibilitet. Import i ett annat system kan skapa dubbla transaktioner. Granska mottagaren före import; OpenERP skickar ingenting.",
  selection:
    "Alla fullständiga periodverifikationer i det sparade paketet ingår. Ingående och senare exkluderade poster ingår inte. Konto- och källtext måste kunna kodas i CP437; kontrolltecken och omvända snedstreck avvisas.",
  legalName: "Uttryckligt juridiskt företagsnamn för den syntetiska överföringen",
  evidence: "ID för sparat underlag om juridiskt namn",
  prepare: "Förbered SIE 4I-fil",
  retry:
    "Försök igen med oförändrade uppgifter om svaret är osäkert. Uppdatera underlagsförteckningen nedan för att hitta nya sparade underlag. Ett underlag som inte kunde renderas är ingen färdig fil.",
  another: "Starta ett separat underlag",
  retained: "Sparade SIE-underlag i denna bok",
  empty: "Inga SIE-underlag sparade.",
  inspect: "Läs underlag",
  resume: "Återuppta rendering",
  captured: "Underlag sparat — ingen förseglad fil",
  sealed: "Fil sparad — externt godkännande saknas",
  next: "Nästa sida med underlag",
  first: "Första sidan med underlag",
  refresh: "Uppdatera underlagsförteckning",
  inventoryCount: "Antal i sparad förteckning",
  inventoryCutoff: "Förteckningens gräns",
  inventoryNote:
    "Sidorna behåller samma underlagsförteckning. Uppdatera uttryckligen för att inkludera nya underlag. Läs ett underlag för att se om filen nu är förseglad.",
  invalid: "Ange juridiskt namn och ID för sparat underlag.",
  pack: "Ursprungligt granskningspaket",
  generatedOn: "Genereringsdatum",
  source: "Sparad källa och omfattning",
  download: "Verifiera sparade binärdata",
  save: "Spara binär .SI-fil",
  bytes: "byte",
  verified:
    "Nedladdade byte motsvarar sparad längd och SHA-256. Detta validerar inte SIE-format eller godkännande hos mottagaren.",
  hash: "SHA-256 för sparade CP437-byte",
};

export const sieCopy = (locale: string) => (locale === "sv" ? sv : en);
