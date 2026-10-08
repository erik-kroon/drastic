import type * as Extraction from "@open-erp/contracts/supplier-extraction";
import { Box } from "@open-erp/ui/components/box";
import { Text } from "@open-erp/ui/components/typography";
import type { Locale } from "@/paraglide/runtime";

const fieldNames = new Map<string, readonly [string, string]>(
  Object.entries({
    supplierDocumentNumber: ["Fakturanummer", "Invoice number"],
    sourceTotalMinor: ["Total enligt fakturan", "Invoice total"],
    documentDate: ["Fakturadatum", "Invoice date"],
    dueDate: ["Förfallodatum", "Due date"],
    description: ["Beskrivning", "Description"],
    quantity: ["Antal", "Quantity"],
    unitPriceMinor: ["Enhetspris", "Unit price"],
    baseMinor: ["Belopp före moms", "Amount before tax"],
    taxMinor: ["Moms", "Tax"],
    sourceGrossMinor: ["Radtotal", "Line total"],
    discountMinor: ["Rabatt", "Discount"],
    chargeMinor: ["Avgift", "Charge"],
  } satisfies Record<string, readonly [string, string]>),
);

const messages = new Map<string, readonly [string, string]>(
  Object.entries({
    reader_geometry_page: [
      "Källans sidmått stämmer inte med originalet. Granska det manuellt.",
      "Source page dimensions do not match the original. Review it manually.",
    ],
    reader_geometry_bounds: [
      "Källmarkeringen ligger utanför sidan och har avvisats.",
      "The source region is outside the page and was rejected.",
    ],
    reader_geometry_empty: [
      "Källmarkeringen är tom och har avvisats.",
      "The source region is empty and was rejected.",
    ],
    reader_page_overlap: [
      "Läsningens sidor har överlappande text. Granska originalet manuellt.",
      "The reading has overlapping page text. Review the original manually.",
    ],
    reader_diagnostic_limit: [
      "Läsningen gav för många granskningspunkter. Granska originalet manuellt.",
      "The reading exceeded its review diagnostic limit. Review the original manually.",
    ],
    reader_retained_size: [
      "Läsningen överskred resultatgränsen. Granska originalet manuellt.",
      "The reading exceeded its retained output limit. Review the original manually.",
    ],
    reader_low_confidence: [
      "Läsaren är osäker. Kontrollera värdet mot originalet.",
      "The reader is uncertain. Check the value against the original.",
    ],
    reader_confidence_unknown: [
      "Läsarens säkerhet är okänd. Kontrollera värdet mot originalet.",
      "Reader confidence is unknown. Check the value against the original.",
    ],
    source_value_needs_review: [
      "Värdet kunde inte tolkas. Kontrollera och fyll i det själv.",
      "The value could not be interpreted. Check and enter it yourself.",
    ],
    source_field_missing: [
      "En uppgift saknas i läsningen. Kontrollera och fyll i den själv.",
      "A fact is missing from the reading. Check and enter it yourself.",
    ],
    reader_field_unsupported: [
      "En uppgift från läsaren stöds inte och har inte använts.",
      "A field from the reader is unsupported and was not used.",
    ],
    source_highlight_unavailable: [
      "Källmarkering saknas. Kontrollera den citerade texten på sidan.",
      "Source highlight unavailable. Check the quoted text on the page.",
    ],
    missing_pages: [
      "Sidor saknas i läsningen. Granska hela originalet.",
      "Pages are missing from the reading. Review the whole original.",
    ],
    inspection_timeout: [
      "Läsningen tog för lång tid. Granska originalet manuellt.",
      "Inspection timed out. Review the original manually.",
    ],
    inspection_memory_limit: [
      "Läsningen överskred minnesgränsen. Granska originalet manuellt.",
      "Inspection exceeded its memory limit. Review the original manually.",
    ],
    inspection_capacity: [
      "En annan fil läses. Försök igen när den är klar.",
      "Another file is being inspected. Retry when it finishes.",
    ],
    inspection_isolation_unavailable: [
      "Säker dokumentläsning är inte tillgänglig. Granska originalet manuellt.",
      "Isolated document inspection is unavailable. Review the original manually.",
    ],
    page_limit: [
      "Originalet har fler än 20 sidor. Granska det manuellt.",
      "The original has more than 20 pages. Review it manually.",
    ],
    document_size: [
      "Originalet överskrider läsningens filgräns. Granska det manuellt.",
      "The original exceeds the reading size limit. Review it manually.",
    ],
    document_invalid: [
      "Originalet kunde inte läsas. Kontrollera filen eller granska den manuellt.",
      "The original could not be read. Check the file or review it manually.",
    ],
  } satisfies Record<string, readonly [string, string]>),
);

export function ExtractionDiagnostics(props: {
  diagnostics: ReadonlyArray<typeof Extraction.ExtractionDiagnostic.Type>;
  locale: Locale;
}) {
  return (
    <Box display="grid" gap="sm">
      {props.diagnostics.map((diagnostic, index) => {
        const language = props.locale === "sv" ? 0 : 1;
        const field = fieldNames.get(diagnostic.fieldKey)?.[language];

        return (
          <Text key={index}>
            {diagnostic.lineOrdinal > 0
              ? `${props.locale === "sv" ? "Rad" : "Line"} ${diagnostic.lineOrdinal}. `
              : ""}
            {field ? `${field}: ` : null}
            {messages.get(diagnostic.code)?.[language] ?? diagnostic.detail}
          </Text>
        );
      })}
    </Box>
  );
}
