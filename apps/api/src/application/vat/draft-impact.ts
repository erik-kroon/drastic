import * as Vat from "@open-erp/contracts/vat-returns";
import { canonicalizeJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { Transaction } from "../../db/transaction";
import { unsupported } from "../commerce/support";
import { failure } from "../failures";
import { digestBody, readBasis } from "./basis";

export type RetainedDraft = {
  readonly ordinal: number;
  readonly draft: typeof Vat.VatDraft.Type;
};

type Draft = typeof Vat.VatDraft.Type;
type BoxName = "box05" | "box10" | "box48" | "box49";
type ContributionKey = "box05Minor" | "box10Minor" | "box48Minor";

const maximumDraftFacts = 200;
const comparableEngines: ReadonlyArray<Draft["calculation"]["engine"]> = [
  "vat-return-draft-v1",
  "vat-return-draft-v2",
  "vat-return-draft-v3",
];
const boxNames: ReadonlyArray<BoxName> = ["box05", "box10", "box48", "box49"];
const contributionKeys: ReadonlyArray<ContributionKey> = ["box05Minor", "box10Minor", "box48Minor"];

function sameJson(left: Schema.Json, right: Schema.Json) {
  const first = canonicalizeJson(left);
  const second = canonicalizeJson(right);
  if (Result.isFailure(first) || Result.isFailure(second)) return false;
  return first.success.json === second.success.json;
}

function contributionOf(assessment: Draft["calculation"]["assessments"][number] | undefined, key: ContributionKey) {
  return assessment?.contribution === null || assessment?.contribution === undefined
    ? 0n
    : BigInt(assessment.contribution[key]);
}

function difference(left: string | null, right: string | null) {
  if (left === null || right === null) return null;
  return (BigInt(right) - BigInt(left)).toString();
}

function requireComparable(draft: Draft) {
  const boxes = draft.calculation.syntheticBoxes;
  if (
    draft.input.mode !== "synthetic_demonstration" ||
    draft.basis.bookProfile !== "synthetic-core-v1" ||
    draft.basis.currency !== "SEK" ||
    draft.basis.currencyScale !== 2 ||
    !comparableEngines.includes(draft.calculation.engine) ||
    boxes === null
  ) {
    return unsupported();
  }
  const facts = draft.basis.facts;
  if (facts.length > maximumDraftFacts || facts.length !== draft.calculation.assessments.length) {
    return unsupported();
  }
  const factIds = new Set(facts.map((observation) => observation.fact.factId));
  const assessmentIds = new Set(draft.calculation.assessments.map((assessment) => assessment.factId));
  if (factIds.size !== facts.length || assessmentIds.size !== facts.length) return unsupported();
  for (const observation of facts) {
    const assessment = draft.calculation.assessments.find(
      (candidate) => candidate.factId === observation.fact.factId,
    );
    if (assessment === undefined || assessment.sourceDigest !== observation.fact.digest) {
      return unsupported();
    }
  }
  for (const assessment of draft.calculation.assessments) {
    if (
      (assessment.state === "excluded" && assessment.contribution !== null) ||
      (assessment.state === "included_synthetic" && assessment.contribution === null)
    ) {
      return unsupported();
    }
  }
  for (const [index, name] of (["box05", "box10", "box48"] as const).entries()) {
    const key = contributionKeys[index] ?? "box05Minor";
    let sum = 0n;
    for (const assessment of draft.calculation.assessments) sum += contributionOf(assessment, key);
    if (BigInt(boxes[name].exactMinor) !== sum) return unsupported();
  }
  return Effect.void;
}

function draftReference(draft: Draft) {
  return {
    id: draft.id,
    digest: draft.digest,
    basisDigest: draft.basis.digest,
    engine: draft.calculation.engine,
    input: draft.input,
    bookSequence: draft.basis.bookSequence,
    bookProfile: draft.basis.bookProfile,
    bookProfileVersion: draft.basis.bookProfileVersion,
    currency: draft.basis.currency,
    currencyScale: draft.basis.currencyScale,
    blockers: draft.calculation.blockers,
  };
}

function factSides(draft: Draft) {
  const facts = new Map(draft.basis.facts.map((observation) => [observation.fact.factId, observation.fact]));
  const assessments = new Map(
    draft.calculation.assessments.map((assessment) => [assessment.factId, assessment]),
  );
  return new Map(
    [...facts.keys()].map((factId) => [
      factId,
      {
        fact: facts.get(factId),
        assessment: assessments.get(factId),
      },
    ]),
  );
}

function factImpact(
  factId: string,
  original: ReturnType<typeof factSides> extends Map<string, infer V> ? V | undefined : never,
  replacement: ReturnType<typeof factSides> extends Map<string, infer V> ? V | undefined : never,
) {
  const side = (value: typeof original) =>
    value?.fact === undefined || value.assessment === undefined
      ? null
      : {
          revisionId: value.fact.id,
          revision: value.fact.revision,
          assessment: value.assessment,
        };
  return {
    factId,
    original: side(original),
    replacement: side(replacement),
    sourceChanged: (original?.fact?.digest ?? null) !== (replacement?.fact?.digest ?? null),
    assessmentChanged: !sameJson(
      original?.assessment === undefined ? null : original.assessment,
      replacement?.assessment === undefined ? null : replacement.assessment,
    ),
    contributionDelta: {
      box05Minor: (
        contributionOf(replacement?.assessment, "box05Minor") -
        contributionOf(original?.assessment, "box05Minor")
      ).toString(),
      box10Minor: (
        contributionOf(replacement?.assessment, "box10Minor") -
        contributionOf(original?.assessment, "box10Minor")
      ).toString(),
      box48Minor: (
        contributionOf(replacement?.assessment, "box48Minor") -
        contributionOf(original?.assessment, "box48Minor")
      ).toString(),
    },
  };
}

export function buildImpact(
  transaction: Transaction,
  original: RetainedDraft,
  replacement: RetainedDraft,
) {
  return Effect.gen(function* () {
    if (original.draft.id === replacement.draft.id || original.ordinal >= replacement.ordinal) {
      return yield* failure("InvalidJournal");
    }
    if (
      original.draft.input.startsOn !== replacement.draft.input.startsOn ||
      original.draft.input.endsOn !== replacement.draft.input.endsOn
    ) {
      return yield* failure("InvalidJournal");
    }
    yield* requireComparable(original.draft);
    yield* requireComparable(replacement.draft);
    const originalSides = factSides(original.draft);
    const replacementSides = factSides(replacement.draft);
    const factIds = [...new Set([...originalSides.keys(), ...replacementSides.keys()])].sort();
    const originalBoxes = original.draft.calculation.syntheticBoxes;
    const replacementBoxes = replacement.draft.calculation.syntheticBoxes;
    if (originalBoxes === null || replacementBoxes === null) return yield* unsupported();
    const body = yield* digestBody(transaction, {
      version: "vat-draft-impact-v1",
      scope: original.draft.scope,
      original: draftReference(original.draft),
      replacement: draftReference(replacement.draft),
      facts: factIds.map((factId) =>
        factImpact(factId, originalSides.get(factId), replacementSides.get(factId)),
      ),
      boxes: boxNames.map((box) => ({
        box,
        original: originalBoxes[box] ?? null,
        replacement: replacementBoxes[box] ?? null,
        exactDeltaMinor: difference(originalBoxes[box]?.exactMinor ?? null, replacementBoxes[box]?.exactMinor ?? null),
        reportedDeltaKrona: difference(
          originalBoxes[box]?.reportedKrona ?? null,
          replacementBoxes[box]?.reportedKrona ?? null,
        ),
        residualDeltaMinor: difference(
          originalBoxes[box]?.residualMinor ?? null,
          replacementBoxes[box]?.residualMinor ?? null,
        ),
      })),
      filingReady: false,
      externalState: "not_submitted",
    });
    return body;
  });
}

export function readReplacementBasisCurrent(
  transaction: Transaction,
  bookId: string,
  impact: { readonly replacement: { readonly basisDigest: string } },
) {
  return readBasis(transaction, bookId).pipe(
    Effect.map((basis) => basis.digest === impact.replacement.basisDigest),
  );
}
