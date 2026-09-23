import type { Locale } from "@/paraglide/runtime";

const en = {
  title: "Saved document",
  boundary: "Demo document · HTML · English · Not sent",
  historyMeaning:
    "This file preserves the invoice as issued. Later payments, cancellations and company changes do not change its contents.",
  prepare: "Create downloadable document",
  empty: "Create a saved copy to preview or download.",
  refresh: "Refresh document",
  resume: "Finish creating document",
  captured: "The invoice is saved. Finish creating its downloadable file.",
  verified: "Saved file ready",
  save: "Download HTML",
  preview: "Preview saved file",
  source: "Source and verification details",
  descriptor: "File details",
  recovery:
    "If creation was interrupted, refresh to find the saved document or retry the same request.",
};
const sv: typeof en = {
  title: "Sparat dokument",
  boundary: "Demodokument · HTML · Engelska · Inte skickat",
  historyMeaning:
    "Filen bevarar fakturan som den utfärdades. Senare betalningar, makuleringar och företagsändringar ändrar inte innehållet.",
  prepare: "Skapa nedladdningsbart dokument",
  empty: "Skapa en sparad kopia att förhandsvisa eller ladda ner.",
  refresh: "Uppdatera dokument",
  resume: "Slutför dokumentet",
  captured: "Fakturan är sparad. Slutför den nedladdningsbara filen.",
  verified: "Sparad fil klar",
  save: "Ladda ner HTML",
  preview: "Visa sparad fil",
  source: "Underlag och verifieringsuppgifter",
  descriptor: "Filuppgifter",
  recovery:
    "Om skapandet avbröts, uppdatera för att hitta dokumentet eller försök samma begäran igen.",
};
export const invoiceDocumentCopy = (locale: Locale) => (locale === "sv" ? sv : en);
