import type * as Schema from "effect/Schema";

import * as Shared from "./shared";

type JsonObject = Schema.JsonObject;

// The reviewed extraction grammar. Field keys are semantic identities, never a
// model array position, and this vocabulary is closed: a key outside it is a
// rejected diagnostic rather than an invented field. A new document vocabulary is
// a new engine release, not a widening of this list.
export const headerFieldKeys = [
  "title",
  "supplierDocumentNumber",
  "documentDate",
  "supplyDate",
  "dueDate",
  "paymentTerms",
  "sourceTotalMinor",
] as const;

export const lineFieldKeys = [
  "description",
  "quantity",
  "unitPriceMinor",
  "baseMinor",
  "discountMinor",
  "chargeMinor",
  "taxMinor",
  "taxDescription",
  "sourceGrossMinor",
] as const;

export type HeaderFieldKey = (typeof headerFieldKeys)[number];

export type LineFieldKey = (typeof lineFieldKeys)[number];

export type FieldKey = HeaderFieldKey | LineFieldKey;

const moneyKeys = new Set<string>([
  "sourceTotalMinor",
  "unitPriceMinor",
  "baseMinor",
  "discountMinor",
  "chargeMinor",
  "taxMinor",
  "sourceGrossMinor",
]);

// A declared alias table, not an invented layout heuristic. Each entry names one
// label a supplier document may print instead of the semantic field key. Anything
// not listed here is read as the field key itself, case-insensitively.
const labelAliases: ReadonlyMap<string, FieldKey> = new Map([
  ["fakturanummer", "supplierDocumentNumber"],
  ["invoice_number", "supplierDocumentNumber"],
  ["fakturadatum", "documentDate"],
  ["invoice_date", "documentDate"],
  ["belopp", "sourceTotalMinor"],
  ["total_including_vat", "sourceTotalMinor"],
  ["förfallodatum", "dueDate"],
  ["due_date", "dueDate"],
  ["leveransdatum", "supplyDate"],
  ["delivery_date", "supplyDate"],
  ["betalningsvillkor", "paymentTerms"],
  ["payment_terms", "paymentTerms"],
  ["beskrivning", "description"],
  ["antal", "quantity"],
  ["moms", "taxMinor"],
  ["tax", "taxMinor"],
]);

// Declared table markers. A marker record carries no value; records after it are
// read as line rows until the next marker or a labelled field.
const tableMarkers = new Set(["lines", "line_items", "items", "rader", "artikelrader"]);

export type ExtractionDiagnostic = {
  readonly code: string;
  readonly lineOrdinal: number;
  readonly fieldKey: string;
  readonly detail: string;
};

export type ExtractedField = {
  readonly lineOrdinal: number;
  readonly fieldKey: string;
  readonly proposedValue: string | null;
  readonly sourceLocators: ReadonlyArray<string>;
};

export type ExtractedLine = {
  readonly candidateLineId: string;
  readonly sourceLocators: ReadonlyArray<string>;
  readonly fields: ReadonlyArray<ExtractedField>;
  readonly content: JsonObject;
};

export type NativeTextExtraction = {
  readonly result: "succeeded" | "rejected_output";
  readonly fields: ReadonlyArray<ExtractedField>;
  readonly candidateLines: ReadonlyArray<ExtractedLine>;
  readonly diagnostics: ReadonlyArray<ExtractionDiagnostic>;
};

export type ExtractionPage = {
  readonly page: number;
  readonly startByte: number;
  readonly endByte: number;
};

export type ExtractionBasis = {
  readonly currencyScale: number;
  readonly selectedPages: ReadonlyArray<ExtractionPage>;
  readonly byteLength: number;
};

const maximumRecords = 500;

const maximumLabelLength = 40;

const maximumLineFields = 16;

const decimalPattern = /^(0|[1-9][0-9]{0,12})(?:\.([0-9]{1,6}))?$/;

export function fieldKeyForLabel(label: string): FieldKey | null {
  const normalized = label.trim().toLowerCase();

  if (normalized.length === 0 || normalized.length > maximumLabelLength) return null;
  const aliased = labelAliases.get(normalized);

  if (aliased !== undefined) return aliased;

  const direct = [...headerFieldKeys, ...lineFieldKeys].find(
    (key) => key.toLowerCase() === normalized,
  );

  return direct ?? null;
}

export function isTableMarker(label: string) {
  return tableMarkers.has(label.trim().toLowerCase());
}

export function isMoneyFieldKey(fieldKey: string) {
  return moneyKeys.has(fieldKey);
}

const headerKeySet: ReadonlySet<string> = new Set(headerFieldKeys);

const lineKeySet: ReadonlySet<string> = new Set(lineFieldKeys);

export function isHeaderFieldKey(fieldKey: string): fieldKey is HeaderFieldKey {
  return headerKeySet.has(fieldKey);
}

export function isFieldKey(fieldKey: string): fieldKey is FieldKey {
  return headerKeySet.has(fieldKey) || lineKeySet.has(fieldKey);
}

export function diagnostic(
  code: string,
  lineOrdinal: number,
  fieldKey: string,
  detail: string,
): ExtractionDiagnostic {
  return { code, lineOrdinal, fieldKey, detail };
}

// A locator names an exact byte span of the retained text the engine actually
// read. It must fall inside a selected page range, so a suggestion the operator
// excluded cannot be attributed to the source.
function spanLocator(basis: ExtractionBasis, startByte: number, endByte: number) {
  if (endByte <= startByte || endByte > basis.byteLength) return null;

  const selected = basis.selectedPages.some(
    (page) => startByte >= page.startByte && endByte <= page.endByte,
  );

  return selected ? `span:${startByte}-${endByte}` : null;
}

// Money is an exact source assertion. A decimal carrying more precision than the
// book's currency scale cannot be converted without inventing digits, and a
// negative or non-canonical token is not a retained source assertion, so both are
// rejected with a retained diagnostic rather than rounded.
export function exactMoney(token: string, currencyScale: number) {
  const trimmed = token.trim();

  if (trimmed.length === 0 || trimmed.length > 40) return null;

  if (Shared.minorPattern.test(trimmed)) return trimmed;

  const parts = decimalPattern.exec(trimmed);

  if (parts === null) return null;
  const fraction = parts[2] ?? "";

  if (fraction.length > currencyScale) return null;
  const whole = parts[1] ?? "0";
  const minor = fraction === "" ? whole : `${whole}${fraction.padEnd(currencyScale, "0")}`;

  return Shared.minorPattern.test(minor) ? minor : null;
}

function typedValue(fieldKey: string, token: string, currencyScale: number) {
  const trimmed = token.trim();

  if (isMoneyFieldKey(fieldKey)) return exactMoney(trimmed, currencyScale);

  if (fieldKey === "documentDate" || fieldKey === "supplyDate" || fieldKey === "dueDate") {
    if (!Shared.datePattern.test(trimmed)) return null;
    const parsed = new Date(`${trimmed}T00:00:00.000Z`);

    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed
      ? null
      : trimmed;
  }

  if (fieldKey === "quantity") return Shared.quantityPattern.test(trimmed) ? trimmed : null;

  const bound =
    fieldKey === "paymentTerms" ? 1000 : fieldKey === "supplierDocumentNumber" ? 128 : 200;

  return trimmed.length === 0 || trimmed.length > bound ? null : trimmed;
}

type TextRecord = { readonly start: number; readonly end: number; readonly text: string };

type LabelledRecord = TextRecord & { readonly label: string; readonly value: string };

// Byte offsets come from the retained text itself, so a locator names the exact
// span the engine read rather than a recomputed guess.
export function readTextRecords(text: string): ReadonlyArray<TextRecord> {
  const records: TextRecord[] = [];
  let start = 0;

  while (start <= text.length && records.length < maximumRecords + 1) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    const lineEnd = end > start && text[end - 1] === "\r" ? end - 1 : end;

    records.push({ start, end: lineEnd, text: text.slice(start, lineEnd) });

    if (newline === -1) break;
    start = newline + 1;
  }

  return records;
}

function byteLengthOf(value: string) {
  return Buffer.byteLength(value, "utf8");
}

// A candidate row's cell offsets, measured from the row start so each retained
// span is exact even when a cell repeats or carries padding.
function cellSpans(rest: string, restEnd: number) {
  const spans: Array<{ start: number; end: number; token: string }> = [];
  const restStart = restEnd - byteLengthOf(rest);
  let cursor = 0;

  for (let cell = 0; cell < maximumLineFields + 1; cell += 1) {
    const separator = rest.indexOf(";", cursor);
    const rawEnd = separator === -1 ? rest.length : separator;
    const raw = rest.slice(cursor, rawEnd);
    const token = raw.trim();

    const start =
      restStart + byteLengthOf(rest.slice(0, cursor + raw.length - raw.trimStart().length));

    spans.push({ start, end: start + byteLengthOf(token), token });

    if (separator === -1) break;
    cursor = separator + 1;
  }

  return spans;
}

const rowPattern = /^([a-z][a-z0-9_-]{2,127})\s*;\s*(.*)$/;

const labelPattern = /^([A-Za-z][A-Za-z0-9 _-]{0,39})\s*:\s*(.*)$/;

type HeaderReading = {
  readonly marker: boolean;
  readonly field: ExtractedField | null;
  readonly diagnostics: ReadonlyArray<ExtractionDiagnostic>;
};

// A labelled record. The declared table marker opens the line table, an unknown
// label is a rejected diagnostic rather than an invented field, and the first
// occurrence of a key wins so a repeated label cannot overwrite a value.
function readLabelledRecord(
  record: LabelledRecord,
  basis: ExtractionBasis,
  seen: Set<string>,
): HeaderReading {
  const label = record.label;
  const raw = record.value;

  const rejected = (code: string, fieldKey: string, detail: string) => ({
    marker: false,
    field: null,
    diagnostics: [diagnostic(code, 0, fieldKey, detail)],
  });

  if (isTableMarker(label)) return { marker: true, field: null, diagnostics: [] };

  const fieldKey = fieldKeyForLabel(label);

  if (fieldKey === null) return rejected("unknown_field_key", label, raw.slice(0, 40));

  if (!isHeaderFieldKey(fieldKey)) {
    return rejected("line_field_outside_line_table", fieldKey, label);
  }

  if (seen.has(fieldKey)) return rejected("duplicate_field_id", fieldKey, raw.slice(0, 40));
  seen.add(fieldKey);

  const span = spanLocator(basis, record.end - byteLengthOf(raw), record.end);

  if (span === null) return { marker: false, field: null, diagnostics: [] };

  if (raw.trim() === "") {
    return {
      marker: false,
      field: { lineOrdinal: 0, fieldKey, proposedValue: null, sourceLocators: [span] },
      diagnostics: [],
    };
  }

  const value = typedValue(fieldKey, raw, basis.currencyScale);

  if (value === null) {
    return {
      marker: false,
      field: null,
      diagnostics: [
        diagnostic(
          isMoneyFieldKey(fieldKey) ? "monetary_encoding_not_exact" : "value_not_typed",
          0,
          fieldKey,
          raw.slice(0, 40),
        ),
      ],
    };
  }

  return {
    marker: false,
    field: { lineOrdinal: 0, fieldKey, proposedValue: value, sourceLocators: [span] },
    diagnostics: [],
  };
}

type LineReading = {
  readonly line: ExtractedLine | null;
  readonly diagnostics: ReadonlyArray<ExtractionDiagnostic>;
};

// A candidate row. Its cells are positional against the declared line field order,
// and every retained cell span is measured from the row text itself.
function readCandidateRow(
  record: TextRecord,
  basis: ExtractionBasis,
  lineOrdinal: number,
  known: ReadonlyArray<string>,
): LineReading {
  const row = rowPattern.exec(record.text);

  if (row === null) {
    return {
      line: null,
      diagnostics: [diagnostic("unreadable_record", lineOrdinal, "", record.text.slice(0, 40))],
    };
  }

  const candidateLineId = row[1] ?? "";

  if (!Shared.lineIdPattern.test(candidateLineId)) {
    return {
      line: null,
      diagnostics: [diagnostic("unknown_line_identity", lineOrdinal, "", candidateLineId)],
    };
  }

  if (known.includes(candidateLineId)) {
    return {
      line: null,
      diagnostics: [diagnostic("duplicate_field_id", lineOrdinal, "", candidateLineId)],
    };
  }

  const cells = row[2] ?? "";
  const cellCount = cells.split(";").length;

  if (cellCount > maximumLineFields) {
    return {
      line: null,
      diagnostics: [diagnostic("too_many_line_fields", lineOrdinal, "", String(cellCount))],
    };
  }

  const spans = cellSpans(cells, record.end);
  const fields: ExtractedField[] = [];
  const diagnostics: ExtractionDiagnostic[] = [];

  for (let cell = 0; cell < cellCount; cell += 1) {
    const fieldKey = lineFieldKeys[cell];
    const cellSpan = spans[cell];

    if (fieldKey === undefined || cellSpan === undefined) continue;

    const span = spanLocator(basis, cellSpan.start, cellSpan.end);

    if (span === null) continue;

    if (cellSpan.token === "") {
      fields.push({
        lineOrdinal,
        fieldKey,
        proposedValue: null,
        sourceLocators: [span],
      });
      continue;
    }

    const value = typedValue(fieldKey, cellSpan.token, basis.currencyScale);

    if (value === null) {
      diagnostics.push(
        diagnostic(
          isMoneyFieldKey(fieldKey) ? "monetary_encoding_not_exact" : "value_not_typed",
          lineOrdinal,
          fieldKey,
          cellSpan.token.slice(0, 40),
        ),
      );
      continue;
    }

    fields.push({ lineOrdinal, fieldKey, proposedValue: value, sourceLocators: [span] });
  }

  return {
    line: {
      candidateLineId,
      sourceLocators: [],
      fields,
      content: lineContent(candidateLineId, fields),
    },
    diagnostics,
  };
}

// The bounded native-text reader. It reads labelled records and the declared line
// table out of the retained text; it never invents a value, never rounds money and
// never claims a byte span it did not read. It is a pure function: no provider, no
// model, no network and no database.
export function readNativeTextExtraction(
  text: string,
  basis: ExtractionBasis,
): NativeTextExtraction {
  const fields: ExtractedField[] = [];
  const candidateLines: ExtractedLine[] = [];
  const diagnostics: ExtractionDiagnostic[] = [];
  const seenHeaderKeys = new Set<string>();
  const records = readTextRecords(text);
  let inTable = false;

  if (records.length > maximumRecords) {
    return {
      result: "rejected_output",
      fields,
      candidateLines,
      diagnostics: [diagnostic("document_too_many_records", 0, "", String(records.length))],
    };
  }

  for (const record of records) {
    const span = spanLocator(basis, record.start, record.end);
    const labelled = labelPattern.exec(record.text);

    if (labelled !== null) {
      inTable = false;

      const reading = readLabelledRecord(
        {
          start: record.start,
          end: record.end,
          text: record.text,
          label: labelled[1] ?? "",
          value: labelled[2] ?? "",
        },
        basis,
        seenHeaderKeys,
      );

      inTable = reading.marker;
      diagnostics.push(...reading.diagnostics);

      if (reading.field !== null) fields.push(reading.field);
      continue;
    }

    if (!inTable) continue;

    const reading = readCandidateRow(
      record,
      basis,
      candidateLines.length + 1,
      candidateLines.map((line) => line.candidateLineId),
    );

    diagnostics.push(...reading.diagnostics);

    if (reading.line === null) continue;
    candidateLines.push(span === null ? reading.line : { ...reading.line, sourceLocators: [span] });
  }

  return {
    result: fields.length > 0 || candidateLines.length > 0 ? "succeeded" : "rejected_output",
    fields,
    candidateLines,
    diagnostics: diagnostics.slice(0, 64),
  };
}

// A candidate row keeps exactly the draft line keys. A field the engine could not
// read stays null so the existing draft calculator reports it as an unreviewed tax
// input rather than the engine inventing one.
function lineContent(candidateLineId: string, fields: ReadonlyArray<ExtractedField>): JsonObject {
  const read = new Map(fields.map((field) => [field.fieldKey, field.proposedValue]));
  const spread = Object.fromEntries(lineFieldKeys.map((key) => [key, read.get(key) ?? null]));

  return {
    id: candidateLineId,
    ...spread,
    description: read.get("description") ?? candidateLineId,
    quantity: read.get("quantity") ?? "1",
    baseMinor: read.get("baseMinor") ?? "0",
    discountMinor: read.get("discountMinor") ?? "0",
    chargeMinor: read.get("chargeMinor") ?? "0",
    taxEvidenceId: null,
  } satisfies JsonObject;
}
