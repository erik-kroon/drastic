import * as Schema from "effect/Schema";
import * as Extraction from "@open-erp/contracts/supplier-extraction";
import { isCalendarDate } from "@open-erp/domain/values";
import type { DocumentInspection } from "../../adapters/document-reading/inspection";

export class DocumentReadingError extends Error {
  constructor(
    readonly code:
      | "reader_page_coverage"
      | "reader_page_span"
      | "reader_page_overlap"
      | "reader_field_span"
      | "reader_field_quote"
      | "reader_geometry_page"
      | "reader_geometry_bounds"
      | "reader_geometry_empty"
      | "reader_diagnostic_limit"
      | "reader_retained_size"
      | "reader_output_schema",
  ) {
    super(code);
  }
}

const Offset = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 16000 }));

const Span = Schema.Struct({ offset: Offset, length: Offset });

const Spans = Schema.Array(Span).check(Schema.isMinLength(1), Schema.isMaxLength(8));

const Regions = Schema.Array(
  Schema.Struct({
    pageNumber: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
    polygon: Schema.optional(
      Schema.Array(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))).check(
        Schema.isBetweenLength(8, 8),
      ),
    ),
  }),
).check(Schema.isMinLength(1), Schema.isMaxLength(8));

const Field = Schema.Struct({
  content: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
  spans: Spans,
  boundingRegions: Regions,
  confidence: Schema.optional(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
});

const Item = Schema.Struct({ valueObject: Schema.Record(Schema.String, Schema.Unknown) });

const Items = Schema.Struct({ valueArray: Schema.Array(Item).check(Schema.isMaxLength(50)) });

const Result = Schema.Struct({
  status: Schema.Literal("succeeded"),
  analyzeResult: Schema.Struct({
    apiVersion: Schema.Literal("2024-11-30"),
    modelId: Schema.Literal("prebuilt-invoice"),
    stringIndexType: Schema.Literal("utf16CodeUnit"),
    content: Schema.String.check(Schema.isMaxLength(16000)),
    pages: Schema.Array(
      Schema.Struct({
        pageNumber: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
        spans: Spans,
        width: Schema.optional(Schema.Finite.check(Schema.isGreaterThan(0))),
        height: Schema.optional(Schema.Finite.check(Schema.isGreaterThan(0))),
        unit: Schema.optional(Schema.Literals(["inch", "pixel"])),
      }),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
    documents: Schema.Array(
      Schema.Struct({
        docType: Schema.Literal("prebuilt:invoice"),
        fields: Schema.Record(Schema.String, Schema.Unknown),
      }),
    ).check(Schema.isBetweenLength(1, 1)),
  }),
});

type FieldKey = typeof Extraction.ExtractionFieldKey.Type;

type ExtractedField = typeof Extraction.ExtractedField.Type;

type Diagnostic = typeof Extraction.ExtractionDiagnostic.Type;

// Parse printed Swedish amounts, never the provider's floating-point value.
// Currency, scale and grouping must be explicit in this release's profile.
function amount(quote: string) {
  const value = quote
    .trim()
    .replace(/\s*(SEK|kr)$/u, "")
    .trim();

  if (!/^-?(?:[0-9]{1,3}(?:[ \u00a0\u202f][0-9]{3})+|[0-9]+),[0-9]{2}$/u.test(value)) return null;
  const digits = value.replace(/[ \u00a0\u202f,]/gu, "");

  if (digits.replace("-", "").length > 16) return null;

  return BigInt(digits).toString();
}

export function interpretDocument(
  value: unknown,
  physicalPages: number,
  inspection: DocumentInspection,
) {
  const { analyzeResult: result } = Schema.decodeUnknownSync(Result)(value);
  const pages = new Map(result.pages.map((page) => [page.pageNumber, page]));

  if (pages.size !== result.pages.length || [...pages.keys()].some((page) => page > physicalPages))
    throw new DocumentReadingError("reader_page_coverage");

  for (const page of pages.values()) {
    if (page.spans.some((span) => span.offset + span.length > result.content.length))
      throw new DocumentReadingError("reader_page_span");

    for (const other of pages.values()) {
      if (other.pageNumber === page.pageNumber) continue;

      if (
        page.spans.some((span) =>
          other.spans.some(
            (otherSpan) =>
              span.offset < otherSpan.offset + otherSpan.length &&
              otherSpan.offset < span.offset + span.length,
          ),
        )
      )
        throw new DocumentReadingError("reader_page_overlap");
    }
  }

  const diagnostics: Diagnostic[] = [];

  const field = (
    parsed: typeof Field.Type,
    fieldKey: FieldKey,
    lineOrdinal: number,
  ): ExtractedField => {
    // A field is supported only when its exact quote belongs to one physical page.
    if (parsed.spans.length !== 1 || parsed.boundingRegions.length !== 1)
      throw new DocumentReadingError("reader_field_span");
    const span = parsed.spans[0]!;
    const page = parsed.boundingRegions[0]!.pageNumber;

    if (
      span.length !== parsed.content.length ||
      result.content.slice(span.offset, span.offset + span.length) !== parsed.content ||
      !pages
        .get(page)
        ?.spans.some(
          (region) =>
            span.offset >= region.offset &&
            span.offset + span.length <= region.offset + region.length,
        )
    )
      throw new DocumentReadingError("reader_field_quote");
    let proposedValue: string | null = parsed.content;
    const pageEvidence = pages.get(page)!;
    const originalPage = inspection.pages[page - 1]!;
    const polygon = parsed.boundingRegions[0]!.polygon;
    let region: (typeof Extraction.DocumentSourceLocator.Type)["region"];

    if (polygon) {
      if (
        !pageEvidence.width ||
        !pageEvidence.height ||
        pageEvidence.unit !== inspection.unit ||
        Math.abs(pageEvidence.width - originalPage.width) > originalPage.width * 0.02 ||
        Math.abs(pageEvidence.height - originalPage.height) > originalPage.height * 0.02
      )
        throw new DocumentReadingError("reader_geometry_page");

      const normalized = polygon.map(
        (point, index) => point / (index % 2 === 0 ? pageEvidence.width! : pageEvidence.height!),
      );

      if (normalized.some((point) => point < 0 || point > 1))
        throw new DocumentReadingError("reader_geometry_bounds");

      const area = Math.abs(
        normalized.reduce(
          (sum, point, index) =>
            index % 2 === 0
              ? sum +
                point * normalized[(index + 3) % 8]! -
                normalized[(index + 2) % 8]! * normalized[index + 1]!
              : sum,
          0,
        ),
      );

      if (area < 0.000001) throw new DocumentReadingError("reader_geometry_empty");
      region = {
        scale: 1000000000,
        polygon: normalized.map((point) => Math.round(point * 1000000000)),
      };
    } else {
      diagnostics.push({
        code: "source_highlight_unavailable",
        lineOrdinal,
        fieldKey,
        detail: "Only a page and quote were supplied. No exact source highlight is available.",
      });
    }

    if (fieldKey.endsWith("Minor")) proposedValue = amount(parsed.content);

    if (["documentDate", "dueDate"].includes(fieldKey) && !isCalendarDate(parsed.content))
      proposedValue = null;

    if (fieldKey === "quantity" && !/^[0-9]+(?:\.[0-9]{1,6})?$/u.test(parsed.content))
      proposedValue = null;

    if (proposedValue === null)
      diagnostics.push({
        code: "source_value_needs_review",
        lineOrdinal,
        fieldKey,
        detail: "The printed value does not match the selected reading profile.",
      });

    if (parsed.confidence === undefined || parsed.confidence < 0.8) {
      diagnostics.push({
        code:
          parsed.confidence === undefined ? "reader_confidence_unknown" : "reader_low_confidence",
        lineOrdinal,
        fieldKey,
        detail:
          "Reader confidence is unknown or low. Check the printed value against the original.",
      });

      if (parsed.confidence !== undefined) proposedValue = null;
    }

    const locator: typeof Extraction.DocumentSourceLocator.Type = {
      kind: "document_quote",
      page,
      quote: parsed.content,
      textOffset: span.offset,
      textLength: span.length,
    };

    const sourceLocator = region ? { ...locator, region } : locator;

    return { lineOrdinal, fieldKey, proposedValue, sourceLocators: [sourceLocator] };
  };

  const source = result.documents[0]!.fields;

  const headers: ReadonlyArray<readonly [string, FieldKey]> = [
    ["InvoiceId", "supplierDocumentNumber"],
    ["InvoiceDate", "documentDate"],
    ["DueDate", "dueDate"],
    ["InvoiceTotal", "sourceTotalMinor"],
  ];

  const fields = headers.flatMap(([name, key]) =>
    source[name] === undefined
      ? []
      : [field(Schema.decodeUnknownSync(Field)(source[name]), key, 0)],
  );

  for (const [name, key] of headers) {
    if (source[name] === undefined)
      diagnostics.push({
        code: "source_field_missing",
        lineOrdinal: 0,
        fieldKey: key,
        detail: "No value was read. Supply this fact only after reviewing the original.",
      });
  }

  for (const name of Object.keys(source)) {
    if (name !== "Items" && !headers.some(([supported]) => supported === name))
      diagnostics.push({
        code: "reader_field_unsupported",
        lineOrdinal: 0,
        fieldKey: name.slice(0, 64),
        detail: "The reader returned a field outside the supported extraction vocabulary.",
      });
  }

  const lineKeys: ReadonlyArray<readonly [string, FieldKey]> = [
    ["Description", "description"],
    ["Quantity", "quantity"],
    ["UnitPrice", "unitPriceMinor"],
    ["Amount", "baseMinor"],
    ["Tax", "taxMinor"],
  ];

  const items =
    source["Items"] === undefined
      ? []
      : Schema.decodeUnknownSync(Items)(source["Items"]).valueArray;

  const candidateLines = items.map((item, index) => {
    const values = lineKeys.flatMap(([name, key]) =>
      item.valueObject[name] === undefined
        ? []
        : [field(Schema.decodeUnknownSync(Field)(item.valueObject[name]), key, index + 1)],
    );

    for (const [name, key] of lineKeys) {
      if (item.valueObject[name] === undefined)
        diagnostics.push({
          code: "source_field_missing",
          lineOrdinal: index + 1,
          fieldKey: key,
          detail: "No value was read. The line remains incomplete until reviewed.",
        });
    }

    for (const name of Object.keys(item.valueObject)) {
      if (!lineKeys.some(([supported]) => supported === name))
        diagnostics.push({
          code: "reader_field_unsupported",
          lineOrdinal: index + 1,
          fieldKey: name.slice(0, 64),
          detail: "The reader returned an unsupported line field. It was not applied.",
        });
    }

    return {
      candidateLineId: `document_line_${index + 1}`,
      fields: values,
      sourceLocators: values.flatMap((item) => item.sourceLocators).slice(0, 8),
    };
  });

  const coverage = pages.size === physicalPages ? "complete" : "partial";

  if (coverage === "partial")
    diagnostics.push({
      code: "missing_pages",
      lineOrdinal: 0,
      fieldKey: "",
      detail: "The reading does not cover every original page. Review the whole original.",
    });

  if (diagnostics.length > 64) throw new DocumentReadingError("reader_diagnostic_limit");

  return {
    fields,
    candidateLines,
    diagnostics,
    document: {
      physicalPages,
      readPages: [...pages.keys()].sort((a, b) => a - b),
      coverage,
      apiVersion: "2024-11-30",
      modelId: "prebuilt-invoice",
      amountProfile: "sv-SE-SEK",
      transcript: result.content,
    } satisfies typeof Extraction.DocumentReadingEvidence.Type,
  };
}
