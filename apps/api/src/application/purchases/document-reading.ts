import * as Schema from "effect/Schema";
import * as Extraction from "@open-erp/contracts/supplier-extraction";
import { isCalendarDate } from "@open-erp/domain/values";

const Offset = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 16000 }));

const Span = Schema.Struct({ offset: Offset, length: Offset });

const Spans = Schema.Array(Span).check(Schema.isMinLength(1), Schema.isMaxLength(8));

const Regions = Schema.Array(
  Schema.Struct({ pageNumber: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })) }),
).check(Schema.isMinLength(1), Schema.isMaxLength(8));

const Field = Schema.Struct({
  content: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
  spans: Spans,
  boundingRegions: Regions,
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

export function interpretDocument(value: unknown, physicalPages: number) {
  const { analyzeResult: result } = Schema.decodeUnknownSync(Result)(value);
  const pages = new Map(result.pages.map((page) => [page.pageNumber, page]));

  if (pages.size !== result.pages.length || [...pages.keys()].some((page) => page > physicalPages))
    throw new Error("reader_page_coverage");

  for (const page of pages.values()) {
    if (page.spans.some((span) => span.offset + span.length > result.content.length))
      throw new Error("reader_page_span");
  }

  const diagnostics: Diagnostic[] = [];

  const field = (
    parsed: typeof Field.Type,
    fieldKey: FieldKey,
    lineOrdinal: number,
  ): ExtractedField => {
    // A field is supported only when its exact quote belongs to one physical page.
    if (parsed.spans.length !== 1 || parsed.boundingRegions.length !== 1)
      throw new Error("reader_field_span");
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
      throw new Error("reader_field_quote");
    let proposedValue: string | null = parsed.content;

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

    return {
      lineOrdinal,
      fieldKey,
      proposedValue,
      sourceLocators: [
        {
          kind: "document_quote",
          page,
          quote: parsed.content,
          textOffset: span.offset,
          textLength: span.length,
        },
      ],
    };
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

  if (diagnostics.length > 64) throw new Error("reader_diagnostic_limit");

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
