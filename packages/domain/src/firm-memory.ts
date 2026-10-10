import * as Schema from "effect/Schema";
import { Digest, Identifier } from "./values";
import { MinorUnits } from "./money";
import * as Consequence from "./treatment-consequence";

export const AlgorithmVersion = Schema.Literals(["firm_memory_v1", "firm_memory_v2"]);

const Key = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));

export const AccountHint = Schema.Struct({
  expenseAccountId: Identifier,
  vatRatePercent: Schema.Literals([0, 6, 12, 25]),
  sourceInvoiceId: Identifier,
  categoryResolution: Schema.optional(Schema.JsonObject),
});

export const Precedent = Schema.Struct({
  id: Key,
  bookId: Identifier,
  counterpartyId: Identifier,
  documentKind: Schema.String,
  currency: Schema.String,
  currencyScale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 8 })),
  description: Schema.NullOr(Schema.String),
  amountMinor: Schema.NullOr(MinorUnits),
  originalCommitCutoff: MinorUnits,
  receiptSequence: MinorUnits,
  labelSequence: MinorUnits,
  relatedIds: Schema.Array(Schema.String),
  sourceDecisionIds: Schema.Array(Key),
  sourceInvoiceId: Schema.NullOr(Identifier),
  chosenTreatment: Schema.JsonObject,
  provenance: Schema.Struct({ classification: Schema.String, digest: Digest }),
  consequences: Schema.Array(Consequence.Consequence),
  lineage: Schema.Array(Schema.JsonObject),
  accountHints: Schema.Array(AccountHint),
  digest: Digest,
});

export type Precedent = typeof Precedent.Type;

export interface Target {
  readonly bookId: string;
  readonly counterpartyId: string;
  readonly documentKind: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly description: string | null;
  readonly amountMinor: string | null;
  readonly cutoff: string;
  readonly excludeRelatedIds: ReadonlyArray<string>;
}

export type Exclusion = { readonly id: string; readonly reason: string };

export function normalizeDescription(description: string) {
  return description.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

type Version = typeof AlgorithmVersion.Type;

const monthWords = new Set([
  "januari",
  "februari",
  "mars",
  "april",
  "maj",
  "juni",
  "juli",
  "augusti",
  "september",
  "oktober",
  "november",
  "december",
  "january",
  "february",
  "march",
  "may",
  "june",
  "july",
  "august",
  "october",
]);

export function normalizeDescriptionV2(description: string) {
  const text = description
    .normalize("NFC")
    .toLowerCase()
    .replace(/\b[0-9]+(?:st|nd|rd|th|:[ae])\b/gu, " ");

  const words = (text.match(/[\p{L}\p{M}]+/gu) ?? []).filter((word) => !monthWords.has(word));

  return [...new Set(words)].sort().join(" ");
}

function descriptionKey(description: string, version: Version) {
  return version === "firm_memory_v1"
    ? normalizeDescription(description)
    : normalizeDescriptionV2(description);
}

function relatedIds(precedent: Precedent) {
  const ids = [...precedent.relatedIds, `decision:${precedent.id}`];

  if (precedent.sourceInvoiceId !== null) ids.push(`invoice:${precedent.sourceInvoiceId}`);

  return ids;
}

function exclusion(target: Target, precedent: Precedent, version: Version): string | null {
  if (precedent.bookId !== target.bookId) return "foreign_book";

  if (precedent.counterpartyId !== target.counterpartyId) return "different_counterparty";

  if (precedent.documentKind !== target.documentKind) return "different_document_kind";

  if (precedent.currency !== target.currency || precedent.currencyScale !== target.currencyScale)
    return "different_currency";

  if (relatedIds(precedent).some((id) => target.excludeRelatedIds.includes(id)))
    return "related_holdout";

  if (BigInt(precedent.receiptSequence) > BigInt(target.cutoff)) return "later_receipt";

  if (BigInt(precedent.labelSequence) > BigInt(target.cutoff)) return "later_label";

  if (precedent.description === null || descriptionKey(precedent.description, version) === "")
    return "missing_description";

  if (precedent.amountMinor === null) return "missing_amount";

  if (target.description === null || descriptionKey(target.description, version) === "")
    return "missing_target_description";

  if (target.amountMinor === null) return "missing_target_amount";

  if (
    descriptionKey(precedent.description, version) !== descriptionKey(target.description, version)
  )
    return "different_description";

  return null;
}

function bandDistance(target: Target, precedent: Precedent) {
  const width = 100n * 10n ** BigInt(target.currencyScale);
  const difference = BigInt(precedent.amountMinor!) / width - BigInt(target.amountMinor!) / width;

  return difference < 0n ? -difference : difference;
}

export function rank(target: Target, history: ReadonlyArray<Precedent>) {
  return rankWithVersion(target, history, "firm_memory_v1");
}

export function rankV2(target: Target, history: ReadonlyArray<Precedent>) {
  return rankWithVersion(target, history, "firm_memory_v2");
}

function rankWithVersion(target: Target, history: ReadonlyArray<Precedent>, version: Version) {
  const exclusions: Exclusion[] = [];
  const eligible: Precedent[] = [];

  for (const precedent of history) {
    const reason = exclusion(target, precedent, version);

    if (reason === null) eligible.push(precedent);
    else exclusions.push({ id: precedent.id, reason });
  }

  eligible.sort((left, right) => {
    const distance = bandDistance(target, left) - bandDistance(target, right);

    if (distance !== 0n) return distance < 0n ? -1 : 1;

    const recency = BigInt(right.receiptSequence) - BigInt(left.receiptSequence);

    if (recency !== 0n) return recency < 0n ? -1 : 1;

    return left.id < right.id ? -1 : Number(left.id > right.id);
  });
  exclusions.sort((left, right) => (left.id < right.id ? -1 : Number(left.id > right.id)));

  return {
    algorithmVersion: version,
    precedents: eligible.slice(0, 5),
    eligibleCount: eligible.length,
    exclusions,
  };
}

function consequenceComparison(left: Precedent, right: Precedent) {
  if (left.consequences.length === 0 || right.consequences.length === 0) return "unknown";

  if (
    left.consequences.some((item) => item.status === "unknown") ||
    right.consequences.some((item) => item.status === "unknown")
  )
    return "unknown";

  const identities = (record: Precedent) =>
    record.consequences.flatMap((item) => (item.status === "known" ? [item.identity] : [])).sort();

  const a = identities(left);
  const b = identities(right);

  return a.length === b.length && a.every((identity, index) => identity === b[index])
    ? "equivalent"
    : "different";
}

function holdoutIds(target: Precedent, history: ReadonlyArray<Precedent>) {
  const ids = new Set(relatedIds(target));
  let expanded = true;

  while (expanded) {
    expanded = false;

    for (const record of history) {
      if (record.bookId !== target.bookId) continue;
      const related = relatedIds(record);

      if (!related.some((id) => ids.has(id))) continue;

      for (const id of related) {
        if (ids.has(id)) continue;
        ids.add(id);
        expanded = true;
      }
    }
  }

  return [...ids].sort();
}

function metric(numerator: number, denominator: number) {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

export function baseline(history: ReadonlyArray<Precedent>) {
  return baselineWithVersion(history, "firm_memory_v1");
}

export function baselineV2(history: ReadonlyArray<Precedent>) {
  return baselineWithVersion(history, "firm_memory_v2");
}

function baselineWithVersion(history: ReadonlyArray<Precedent>, version: Version) {
  const excludedTargets: Exclusion[] = [];
  const targets = [];

  const counts = {
    eligibleTargets: 0,
    suggestedTargets: 0,
    knownComparableTargets: 0,
    correctConsequences: 0,
    unknownConsequences: 0,
  };

  const ordered = [...history].sort((left, right) =>
    left.id < right.id ? -1 : Number(left.id > right.id),
  );

  for (const record of ordered) {
    if (!["independent", "corrected"].includes(record.provenance.classification)) {
      excludedTargets.push({ id: record.id, reason: "influenced_label" });
      continue;
    }

    if (
      record.description === null ||
      normalizeDescription(record.description) === "" ||
      record.amountMinor === null
    ) {
      excludedTargets.push({ id: record.id, reason: "missing_match_facts" });
      continue;
    }

    counts.eligibleTargets++;

    const result = rankWithVersion(
      {
        ...record,
        cutoff: record.originalCommitCutoff,
        excludeRelatedIds: holdoutIds(record, history),
      },
      history,
      version,
    );

    const suggested = result.precedents[0];
    const comparison = suggested ? consequenceComparison(record, suggested) : "no_suggestion";

    if (suggested) counts.suggestedTargets++;

    if (comparison === "equivalent" || comparison === "different") counts.knownComparableTargets++;

    if (comparison === "equivalent") counts.correctConsequences++;

    if (
      comparison === "unknown" ||
      record.consequences.length === 0 ||
      record.consequences.some((item) => item.status === "unknown")
    )
      counts.unknownConsequences++;
    targets.push({
      id: record.id,
      cutoff: record.originalCommitCutoff,
      suggestedSourceDecisionIds: suggested?.sourceDecisionIds ?? [],
      comparison,
      exclusions: result.exclusions,
    });
  }

  return {
    algorithmVersion: version,
    counts,
    metrics: {
      coverage: metric(counts.suggestedTargets, counts.eligibleTargets),
      consequenceAccuracy: metric(counts.correctConsequences, counts.knownComparableTargets),
    },
    targets,
    excludedTargets,
  };
}
