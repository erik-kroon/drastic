import type * as Schema from "effect/Schema";

import { equalJson } from "@open-erp/domain/canonicalization";

import * as Shared from "./shared";
import { headerFieldKeys, isMoneyFieldKey, lineFieldKeys } from "./extraction-engine";

type Json = Schema.Json;

type JsonObject = Schema.JsonObject;

// The reviewed merge states. A suggested value is never applied by the engine:
// only a human decision that resolves every conflict produces a draft revision.
export const mergeStates = [
  "proposed_change",
  "unchanged",
  "convergent",
  "conflict",
  "retained_reviewed",
  "needs_review",
] as const;

export type MergeState = (typeof mergeStates)[number];

export type MergeSuggestion = {
  // null addresses a header field; a line field is addressed by its candidate line.
  readonly candidateLineId: string | null;
  readonly fieldKey: string;
  readonly proposedValue: Json;
  readonly sourceLocators: ReadonlyArray<string>;
};

export type MergeLineMapping = {
  readonly candidateLineId: string;
  readonly targetLineId: string | null;
};

export type RetainedDecision = {
  readonly lineOrdinal: number;
  readonly fieldKey: string;
  readonly decisionKind: string;
  readonly baseValue: Json;
  readonly selectedValue: Json;
};

export type MergeField = {
  readonly lineOrdinal: number;
  readonly fieldKey: string;
  readonly state: MergeState;
  readonly base: Json;
  readonly current: Json;
  readonly suggestion: Json;
  readonly selected: Json;
  readonly evidenceLocators: ReadonlyArray<string>;
  readonly detail: string;
};

export type MergeLine = {
  readonly candidateLineId: string;
  readonly targetLineId: string | null;
  readonly disposition: "unmapped" | "map_to_line";
  readonly sourceLocators: ReadonlyArray<string>;
  readonly state: MergeState;
  readonly detail: string;
};

export type MergeDiscrepancy = {
  readonly code: string;
  readonly lineOrdinal: number;
  readonly fieldKey: string;
  readonly detail: string;
};

export type MergeInput = {
  // B: the reviewed draft revision the extraction was requested against.
  readonly base: Json;
  // L: the current reviewed draft revision.
  readonly current: Json;
  readonly candidateLineIds: ReadonlyArray<string>;
  readonly suggestions: ReadonlyArray<MergeSuggestion>;
  readonly lineMapping: ReadonlyArray<MergeLineMapping>;
  readonly retainedDecisions: ReadonlyArray<RetainedDecision>;
};

export type MergeResult = {
  readonly fields: ReadonlyArray<MergeField>;
  readonly lines: ReadonlyArray<MergeLine>;
  readonly discrepancies: ReadonlyArray<MergeDiscrepancy>;
  // The content the review would produce if the reviewer confirmed every shown
  // proposal and every shown conflict as retained. A preview, never an acceptance.
  readonly proposed: JsonObject;
};

const reviewerChosen = new Set(["retained_reviewed", "resolved_conflict"]);

function contentField(content: JsonObject, lineOrdinal: number, fieldKey: string): Json {
  if (lineOrdinal === 0) return content[fieldKey] ?? null;

  const lines = content.lines;
  const line = Array.isArray(lines) ? lines[lineOrdinal - 1] : undefined;

  return Shared.isJsonObject(line) ? (line[fieldKey] ?? null) : null;
}

function lineIdentity(line: Json) {
  return Shared.isJsonObject(line) ? Shared.textField(line, "id") : undefined;
}

export function lineOrdinalOf(lines: ReadonlyArray<Json>, targetLineId: string) {
  return lines.findIndex((line) => lineIdentity(line) === targetLineId) + 1;
}

// A field the reviewer chose against a suggestion after the base revision is a
// human confirmation, not an untouched value. It survives a later suggestion.
function confirmedByReviewer(
  decisions: ReadonlyArray<RetainedDecision>,
  lineOrdinal: number,
  fieldKey: string,
  base: Json,
  current: Json,
) {
  return decisions.some(
    (decision) =>
      decision.lineOrdinal === lineOrdinal &&
      decision.fieldKey === fieldKey &&
      reviewerChosen.has(decision.decisionKind) &&
      equalJson(decision.baseValue, base) &&
      equalJson(decision.selectedValue, current),
  );
}

// mergeField(B, L, S, decisions). Values are compared as exact typed values, never
// as formatted display text, so two identical minor-integer strings are one value
// and a different scale or a truncated decimal is a different one.
export function mergeField(
  lineOrdinal: number,
  fieldKey: string,
  base: Json,
  current: Json,
  suggestion: Json | undefined,
  sourceLocators: ReadonlyArray<string>,
  confirmed: boolean,
): MergeField {
  const merged: MergeField = {
    lineOrdinal,
    fieldKey,
    state: "unchanged",
    base,
    current,
    suggestion: suggestion ?? null,
    selected: current,
    evidenceLocators: sourceLocators,
    detail: "",
  };

  if (suggestion === undefined) return merged;

  if (sourceLocators.length === 0) {
    return { ...merged, state: "needs_review", detail: "missing_provenance" };
  }

  if (confirmed) {
    return {
      ...merged,
      state: "retained_reviewed",
      detail: "reviewer_confirmed_after_base",
    };
  }

  if (!equalJson(current, base)) {
    return equalJson(current, suggestion)
      ? { ...merged, state: "convergent" }
      : {
          ...merged,
          state: "conflict",
          detail: "operator_changed_after_extraction_started",
        };
  }

  if (equalJson(suggestion, base)) return merged;

  return { ...merged, state: "proposed_change", selected: suggestion };
}

function writeSelection(
  content: JsonObject,
  lineOrdinal: number,
  fieldKey: string,
  selected: Json,
) {
  if (lineOrdinal === 0) {
    return Object.assign({}, content, { [fieldKey]: selected });
  }

  const lines = content.lines;

  if (!Array.isArray(lines)) return content;

  const next = lines.map((line, index) => {
    if (index !== lineOrdinal - 1) return line;

    const base = Shared.isJsonObject(line) ? line : {};

    return Object.assign({}, base, { [fieldKey]: selected });
  });

  return Object.assign({}, content, { lines: next });
}

function mergeLines(
  input: MergeInput,
  currentLines: ReadonlyArray<Json>,
  discrepancies: MergeDiscrepancy[],
) {
  const lines: MergeLine[] = [];
  const ordinalByCandidate = new Map<string, number>();
  const claimed = new Map<string, string>();

  for (const candidate of input.candidateLineIds) {
    const mapping = input.lineMapping.find((entry) => entry.candidateLineId === candidate);
    const target = mapping?.targetLineId ?? null;

    const locators = [
      ...new Set(
        input.suggestions
          .filter((entry) => entry.candidateLineId === candidate)
          .flatMap((entry) => entry.sourceLocators),
      ),
    ];

    if (target === null) {
      lines.push({
        candidateLineId: candidate,
        targetLineId: null,
        disposition: "unmapped",
        sourceLocators: locators,
        state: "needs_review",
        detail: "unmapped_candidate_line",
      });
      discrepancies.push({
        code: "unmapped_candidate_line",
        lineOrdinal: 0,
        fieldKey: candidate,
        detail: "",
      });
      continue;
    }

    const ordinal = lineOrdinalOf(currentLines, target);

    if (ordinal === 0) {
      discrepancies.push({
        code: "unknown_target_line",
        lineOrdinal: 0,
        fieldKey: candidate,
        detail: target,
      });
      lines.push({
        candidateLineId: candidate,
        targetLineId: null,
        disposition: "unmapped",
        sourceLocators: locators,
        state: "needs_review",
        detail: "unknown_target_line",
      });
      continue;
    }

    // Two equal lines are not the same line: two candidates aimed at one reviewed
    // line is a conflict for the reviewer, never a silent merge.
    const previous = claimed.get(target);

    if (previous !== undefined) {
      discrepancies.push({
        code: "duplicate_line_mapping",
        lineOrdinal: ordinal,
        fieldKey: candidate,
        detail: previous,
      });
      lines.push({
        candidateLineId: candidate,
        targetLineId: null,
        disposition: "unmapped",
        sourceLocators: locators,
        state: "needs_review",
        detail: "duplicate_line_mapping",
      });
      continue;
    }

    claimed.set(target, candidate);
    ordinalByCandidate.set(candidate, ordinal);
    lines.push({
      candidateLineId: candidate,
      targetLineId: target,
      disposition: "map_to_line",
      sourceLocators: locators,
      state: "convergent",
      detail: "",
    });
  }

  return { lines, ordinalByCandidate };
}

// The three-way merge over the whole draft. Every affected field is returned with
// its state, so a reviewer sees exactly which values are source, suggested,
// retained or conflicting. Nothing here writes: the caller decides.
export function mergeExtraction(input: MergeInput): MergeResult {
  const discrepancies: MergeDiscrepancy[] = [];
  const base = Shared.isJsonObject(input.base) ? input.base : {};
  const current = Shared.isJsonObject(input.current) ? input.current : {};
  const currentLines = Array.isArray(current.lines) ? current.lines : [];
  const { lines, ordinalByCandidate } = mergeLines(input, currentLines, discrepancies);
  const fields: MergeField[] = [];
  const ordinals = new Set<number>([0]);

  for (let line = 0; line < currentLines.length; line += 1) ordinals.add(line + 1);

  for (const lineOrdinal of [...ordinals].sort((left, right) => left - right)) {
    const keys = lineOrdinal === 0 ? headerFieldKeys : lineFieldKeys;

    for (const fieldKey of keys) {
      const suggestion = input.suggestions.find(
        (entry) =>
          entry.fieldKey === fieldKey &&
          (lineOrdinal === 0
            ? entry.candidateLineId === null
            : ordinalByCandidate.get(entry.candidateLineId ?? "") === lineOrdinal),
      );

      const baseValue = contentField(base, lineOrdinal, fieldKey);
      const currentValue = contentField(current, lineOrdinal, fieldKey);

      const merged = mergeField(
        lineOrdinal,
        fieldKey,
        baseValue,
        currentValue,
        suggestion?.proposedValue,
        suggestion?.sourceLocators ?? [],
        confirmedByReviewer(
          input.retainedDecisions,
          lineOrdinal,
          fieldKey,
          baseValue,
          currentValue,
        ),
      );

      fields.push(merged);

      if (merged.state === "needs_review") {
        discrepancies.push({
          code: merged.detail === "" ? "needs_review" : merged.detail,
          lineOrdinal,
          fieldKey,
          detail: "",
        });
      }

      if (merged.state === "conflict") {
        discrepancies.push({
          code: "operator_changed_after_extraction_started",
          lineOrdinal,
          fieldKey,
          detail: "",
        });
      }
    }
  }

  let proposed = current;

  for (const field of fields) {
    if (field.state !== "proposed_change" && field.state !== "convergent") continue;
    proposed = writeSelection(proposed, field.lineOrdinal, field.fieldKey, field.selected);
  }

  return { fields, lines, discrepancies, proposed };
}

// A proposed or selected value is only usable when it is already an exact typed
// value for its key. A money key accepts a canonical minor-integer string and
// nothing else, so a numeric or floating encoding can never reach a draft.
export function isExactSelectedValue(fieldKey: string, selected: Json) {
  if (selected === null) return true;

  if (typeof selected !== "string") return false;

  if (isMoneyFieldKey(fieldKey)) return Shared.minorPattern.test(selected);

  return true;
}

const dateKeys = ["documentDate", "supplyDate", "dueDate"] as const;

function calendarDate(value: Json) {
  if (typeof value !== "string" || !Shared.datePattern.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

function contentLine(content: JsonObject, index: number) {
  const lines = content.lines;
  const line = Array.isArray(lines) ? lines[index] : undefined;

  return Shared.isJsonObject(line) ? line : null;
}

function minorValue(line: JsonObject, key: string) {
  const value = line[key];

  return typeof value === "string" && Shared.minorPattern.test(value) ? BigInt(value) : null;
}

// The cross-field checks the draft calculator treats as an invalid journal. They
// are reported as discrepancies instead of being thrown, so a reviewer sees why a
// proposal cannot be calculated and the commit refuses rather than crashing.
export function contentDiscrepancies(content: JsonObject): ReadonlyArray<MergeDiscrepancy> {
  const found: MergeDiscrepancy[] = [];
  const dates = new Map<string, string | null>();

  for (const key of dateKeys) {
    const value = content[key] ?? null;

    if (value !== null && calendarDate(value) === null) {
      found.push({ code: "invalid_calendar_date", lineOrdinal: 0, fieldKey: key, detail: "" });
    }

    dates.set(key, calendarDate(value));
  }

  const documentDate = dates.get("documentDate") ?? null;
  const dueDate = dates.get("dueDate") ?? null;

  if (documentDate !== null && dueDate !== null && dueDate < documentDate) {
    found.push({
      code: "due_date_before_document_date",
      lineOrdinal: 0,
      fieldKey: "dueDate",
      detail: documentDate,
    });
  }

  const lines = content.lines;

  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 50) {
    found.push({ code: "line_count_out_of_range", lineOrdinal: 0, fieldKey: "lines", detail: "" });

    return found;
  }

  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = contentLine(content, index);
    const lineOrdinal = index + 1;

    if (line === null) {
      found.push({ code: "invalid_line", lineOrdinal, fieldKey: "lines", detail: "" });
      continue;
    }

    const lineId = Shared.textField(line, "id");

    if (lineId === undefined || !Shared.lineIdPattern.test(lineId)) {
      found.push({ code: "invalid_line_identity", lineOrdinal, fieldKey: "id", detail: "" });
    } else if (seen.has(lineId)) {
      found.push({ code: "duplicate_line_identity", lineOrdinal, fieldKey: "id", detail: lineId });
    } else {
      seen.add(lineId);
    }

    const base = minorValue(line, "baseMinor");
    const discount = minorValue(line, "discountMinor");
    const charge = minorValue(line, "chargeMinor");
    const tax = line["taxMinor"];
    const source = line["sourceGrossMinor"];

    if (base === null || discount === null || charge === null) {
      found.push({ code: "invalid_line_amount", lineOrdinal, fieldKey: "baseMinor", detail: "" });
      continue;
    }

    if (discount > base) {
      found.push({
        code: "discount_exceeds_base",
        lineOrdinal,
        fieldKey: "discountMinor",
        detail: "",
      });
    }

    if (tax === null || typeof tax !== "string") {
      found.push({ code: "tax_input_unreviewed", lineOrdinal, fieldKey: "taxMinor", detail: "" });
    } else if (
      Shared.minorPattern.test(tax) &&
      base - discount + charge + BigInt(tax) >= 10n ** 38n
    ) {
      found.push({
        code: "line_amount_out_of_range",
        lineOrdinal,
        fieldKey: "taxMinor",
        detail: "",
      });
    }

    if (source !== null && (typeof source !== "string" || !Shared.minorPattern.test(source))) {
      found.push({
        code: "invalid_source_amount",
        lineOrdinal,
        fieldKey: "sourceGrossMinor",
        detail: "",
      });
    }
  }

  return found;
}
