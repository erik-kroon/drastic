import type { Locale } from "@/paraglide/runtime";

export function invoiceDocumentCopy(locale: Locale) {
  return locale === "sv" ? {
    title: "Syntetiskt granskningsdokument",
    boundary: "Inte en juridisk faktura. Inte skickat. Dokumentet återger den sparade syntetiska utgivningen. Ingen ny numrering, bokföring, momsaktivering eller betalningsorder skapas.",
    historyMeaning: "Historiskt underlag, inte aktuellt saldo eller aktuella företagsuppgifter. Senare ändringar påverkar inte de sparade bytesen. Dokumentet använder fast engelsk text och UTF-8.",
    prepare: "Skapa och spara granskningsdokument", history: "Sparat dokument", empty: "Inget dokument har sparats för denna utgivning.",
    recovery: "Om svaret avbryts: uppdatera historiken eller försök samma sparade begäran igen. En avbruten rendering kan återupptas utan ny utgivning.",
    open: "Inspektera dokument", refresh: "Uppdatera historik", resume: "Återuppta rendering", captured: "Underlaget är sparat. Dokumentets bytes är ännu inte förseglade.", sealed: "Dokumentets bytes är sparade och kan inte ersättas.",
    verify: "Verifiera bytes och visa dokument", verified: "Byteantal, SHA-256 och dokumentets identitet matchar. Detta är inte en juridisk kontroll eller ett leveransbevis.",
    save: "Spara exakta HTML-bytes", preview: "Isolerad förhandsvisning av syntetiskt dokument", source: "Sparat underlag och proveniens", descriptor: "Artefaktens metadata", bytes: "bytes", hash: "SHA-256", id: "Dokument-ID", inspectAgain: "Hämta sparat dokument igen",
  } : {
    title: "Synthetic review document",
    boundary: "Not a legal invoice. Not delivered. This document reproduces the retained synthetic issue. It creates no new number, posting, VAT activation or payment instruction.",
    historyMeaning: "Historical facts, not current balances or current company details. Later changes do not alter the retained bytes. The document uses fixed English text and UTF-8.",
    prepare: "Create and retain review document", history: "Retained document", empty: "No document has been captured for this issue.",
    recovery: "If the response is interrupted, refresh history or retry the same retained request. An unfinished render can resume without another issue.",
    open: "Inspect document", refresh: "Refresh history", resume: "Resume rendering", captured: "The source is captured. Document bytes are not sealed yet.", sealed: "Document bytes are retained and cannot be replaced.",
    verify: "Verify bytes and preview", verified: "Byte length, SHA-256 and document identity match. This is not a legal check or proof of delivery.",
    save: "Save exact HTML bytes", preview: "Sandboxed synthetic document preview", source: "Captured source and provenance", descriptor: "Artifact metadata", bytes: "bytes", hash: "SHA-256", id: "Document ID", inspectAgain: "Read retained document again",
  };
}
