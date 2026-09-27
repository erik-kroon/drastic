import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Digest, Identifier } from "./values";
import { MinorUnits } from "./money";

// Pure annual-report math for one fiscal year.
// NEXT-24 leaf: K2 disclosure evaluation, semantic finalization,
// presentation consistency, deterministic iXBRL assembly, independent
// validation-record evaluation and signature-scope fencing. No renderer
// service, no native validator, no filing: the artifact worker owns
// native execution, the application owns finalization and retention, and
// the NEXT-13/23 owners keep statement snapshots and close certificates,
// which arrive here as reviewed references. An unknown mandatory fact
// keeps the report a draft; a validator that never loaded the document
// never passes; a signature never stretches over later content.

export const ReportFailureCode = Schema.Literals([
  "UnsupportedFramework",
  "MissingMandatoryDisclosure",
  "UnsupportedComparison",
  "FinancialMismatch",
  "UnapprovedNarrative",
  "PresentationMismatch",
  "UnknownConceptMapping",
  "DuplicateFactConflict",
  "DanglingReference",
  "ManufacturedFact",
  "DocumentNotLoaded",
  "ValidationStageSkipped",
  "ValidationError",
  "ExtractedFactMismatch",
  "SignatureStale",
]);

export type ReportFailureCode = typeof ReportFailureCode.Type;

export const ReportFailure = Schema.Struct({
  code: ReportFailureCode,
  message: Description,
});

export type ReportFailure = typeof ReportFailure.Type;

export type Checked<A> = Result.Result<A, ReportFailure>;

function fail(code: ReportFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

export const DisclosureApplicability = Schema.Literals(["applicable", "inapplicable", "unknown"]);

export type DisclosureApplicability = typeof DisclosureApplicability.Type;

export const DisclosureRequirement = Schema.Struct({
  requirementId: Identifier,
  applicability: DisclosureApplicability,
  inapplicableReason: Schema.NullOr(Identifier),
  derivedMinor: Schema.NullOr(MinorUnits),
  reviewedExplicitFact: Schema.Boolean,
});

export type DisclosureRequirement = typeof DisclosureRequirement.Type;

export const SemanticFact = Schema.Struct({
  semanticId: Identifier,
  valueMinor: Schema.NullOr(MinorUnits),
  notApplicable: Schema.Boolean,
  evidenceRefs: Schema.Array(Identifier),
  calculationRefs: Schema.Array(Identifier),
});

export type SemanticFact = typeof SemanticFact.Type;

export const AnnualReportDraft = Schema.Struct({
  draftId: Identifier,
  fiscalYear: Schema.String.check(Schema.isPattern(/^\d{4}$/)),
  frameworkRelease: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  frameworkSupported: Schema.Boolean,
  closeCertificateRef: Identifier,
  statementSnapshotIds: Schema.Array(Identifier).check(Schema.isMinLength(1)),
  requirements: Schema.Array(DisclosureRequirement),
  facts: Schema.Array(SemanticFact),
  narrativesApproved: Schema.Boolean,
  comparativeSupported: Schema.Boolean,
});

export type AnnualReportDraft = typeof AnnualReportDraft.Type;

export const FinalSemanticReport = Schema.Struct({
  reportId: Identifier,
  draftId: Identifier,
  fiscalYear: Schema.String.check(Schema.isPattern(/^\d{4}$/)),
  frameworkRelease: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  factCount: MinorUnits,
  requirementCount: MinorUnits,
  modelDigest: Digest,
});

export type FinalSemanticReport = typeof FinalSemanticReport.Type;

// Finalization requires every mandatory disclosure resolved, supported
// comparatives, exact financial agreement and approved-only narratives.
// A K2 release never implies K3 support: an unsupported framework is an
// explicit blocker, not a silent template substitution.
export function finalizeSemanticReport(
  draft: AnnualReportDraft,
  reportId: typeof Identifier.Type,
  modelDigest: typeof Digest.Type,
): Checked<FinalSemanticReport> {
  if (!draft.frameworkSupported) {
    return fail(
      "UnsupportedFramework",
      "The company framework selects K3 or another unsupported release.",
    );
  }

  for (const requirement of draft.requirements) {
    if (requirement.applicability === "unknown") {
      return fail(
        "MissingMandatoryDisclosure",
        "A disclosure with unknown applicability keeps the report a draft.",
      );
    }

    if (
      requirement.applicability === "applicable" &&
      requirement.derivedMinor === null &&
      !requirement.reviewedExplicitFact
    ) {
      return fail(
        "MissingMandatoryDisclosure",
        "An applicable disclosure without a derived or reviewed fact blocks finalization.",
      );
    }
  }

  if (!draft.comparativeSupported) {
    return fail(
      "UnsupportedComparison",
      "An unsupported comparative basis blocks finalization.",
    );
  }

  if (!draft.narrativesApproved) {
    return fail(
      "UnapprovedNarrative",
      "Narratives with unapproved or draft content block finalization.",
    );
  }

  for (const fact of draft.facts) {
    if (fact.valueMinor === null && !fact.notApplicable) {
      return fail(
        "MissingMandatoryDisclosure",
        "A null fact that is not marked not-applicable blocks finalization.",
      );
    }
  }

  return Result.succeed({
    reportId,
    draftId: draft.draftId,
    fiscalYear: draft.fiscalYear,
    frameworkRelease: draft.frameworkRelease,
    factCount: draft.facts.length.toString(),
    requirementCount: draft.requirements.length.toString(),
    modelDigest,
  });
}

export const PresentedFact = Schema.Struct({
  semanticId: Identifier,
  sourceMinor: MinorUnits,
  displayedMinor: MinorUnits,
  roundingProvenance: Identifier,
});

export type PresentedFact = typeof PresentedFact.Type;

export const PresentationRevision = Schema.Struct({
  presentationId: Identifier,
  modelDigest: Digest,
  displayUnit: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16)),
  facts: Schema.Array(PresentedFact),
  presentationOnlyRows: Schema.Array(
    Schema.Struct({ label: Identifier, amountMinor: MinorUnits }),
  ),
  presentationDigest: Digest,
});

export type PresentationRevision = typeof PresentationRevision.Type;

export const PreparePresentationInput = Schema.Struct({
  presentationId: Identifier,
  report: FinalSemanticReport,
  facts: Schema.Array(PresentedFact),
  expectedTotalMinor: MinorUnits,
  presentationOnlyRows: Schema.Array(
    Schema.Struct({ label: Identifier, amountMinor: MinorUnits }),
  ),
  presentationDigest: Digest,
});

export type PreparePresentationInput = typeof PreparePresentationInput.Type;

// Presentation keeps source values beside displayed values with rounding
// provenance. Displayed totals must reconcile through an explicit
// presentation-only row or refuse; no balancing journal is ever created
// for display rounding.
export function preparePresentation(input: PreparePresentationInput): Checked<PresentationRevision> {
  let displayed = 0n;

  for (const fact of input.facts) {
    displayed += BigInt(fact.displayedMinor);
  }

  let adjustment = 0n;

  for (const row of input.presentationOnlyRows) {
    adjustment += BigInt(row.amountMinor);
  }

  if (displayed + adjustment !== BigInt(input.expectedTotalMinor)) {
    return fail(
      "PresentationMismatch",
      "Displayed facts do not reconcile to the declared total.",
    );
  }

  return Result.succeed({
    presentationId: input.presentationId,
    modelDigest: input.report.modelDigest,
    displayUnit: "SEK",
    facts: [...input.facts],
    presentationOnlyRows: [...input.presentationOnlyRows],
    presentationDigest: input.presentationDigest,
  });
}

export const IxbrlContext = Schema.Struct({
  contextRef: Identifier,
  entityIdentifier: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  period: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  dimensions: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
});

export type IxbrlContext = typeof IxbrlContext.Type;

export const IxbrlFact = Schema.Struct({
  concept: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  contextRef: Identifier,
  unitRef: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  valueMinor: MinorUnits,
  decimals: Schema.String.check(Schema.isPattern(/^-?[0-9]{1,6}$/)),
});

export type IxbrlFact = typeof IxbrlFact.Type;

export const IxbrlAssemblyInput = Schema.Struct({
  report: FinalSemanticReport,
  presentation: PresentationRevision,
  mappedFacts: Schema.Array(IxbrlFact),
  contexts: Schema.Array(IxbrlContext),
  units: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  unmappedConcepts: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
});

export type IxbrlAssemblyInput = typeof IxbrlAssemblyInput.Type;

export const IxbrlDocument = Schema.Struct({
  bytesDigest: Digest,
  factCount: MinorUnits,
  contextCount: MinorUnits,
  unitCount: MinorUnits,
  xhtml: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000000)),
});

export type IxbrlDocument = typeof IxbrlDocument.Type;

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Deterministic iXBRL assembly over pinned contexts and units. Duplicate
// concept/context/unit facts with inconsistent values refuse, dangling
// references refuse, and null facts are never manufactured as zero: they
// cannot reach assembly because finalization blocks them.
export function assembleIxbrl(input: IxbrlAssemblyInput): Checked<IxbrlDocument> {
  if (input.unmappedConcepts.length > 0) {
    return fail(
      "UnknownConceptMapping",
      "A semantic fact has no qualified taxonomy concept mapping.",
    );
  }

  if (input.report.modelDigest !== input.presentation.modelDigest) {
    return fail(
      "FinancialMismatch",
      "The presentation does not belong to the finalized model.",
    );
  }

  const contextRefs = new Set(input.contexts.map((context) => context.contextRef));
  const unitRefs = new Set(input.units);
  const seen = new Map<string, string>();
  const parts: Array<string> = [];

  const sortedContexts = [...input.contexts].sort((left, right) =>
    left.contextRef < right.contextRef ? -1 : 1,
  );

  for (const context of sortedContexts) {
    if (!/^\d{4}(-\d{2}-\d{2})?$/.test(context.period)) {
      return fail("FinancialMismatch", "A context period is not a valid date or year.");
    }

    parts.push(
      `<xbrli:context id="${escapeXml(context.contextRef)}"><xbrli:entity><xbrli:identifier>${escapeXml(context.entityIdentifier)}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${escapeXml(context.period)}</xbrli:instant></xbrli:period></xbrli:context>`,
    );
  }

  const sortedFacts = [...input.mappedFacts].sort((left, right) =>
    left.concept < right.concept ? -1 : left.concept > right.concept ? 1 : 0,
  );

  for (const fact of sortedFacts) {
    if (!contextRefs.has(fact.contextRef)) {
      return fail("DanglingReference", "A fact references an undeclared context.");
    }

    if (!unitRefs.has(fact.unitRef)) {
      return fail("DanglingReference", "A fact references an undeclared unit.");
    }

    const key = `${fact.concept}\u0000${fact.contextRef}\u0000${fact.unitRef}`;
    const prior = seen.get(key);

    if (prior !== undefined && prior !== fact.valueMinor) {
      return fail(
        "DuplicateFactConflict",
        "Duplicate facts carry inconsistent values.",
      );
    }

    seen.set(key, fact.valueMinor);
    parts.push(
      `<ix:nonFraction concept="${escapeXml(fact.concept)}" contextRef="${escapeXml(fact.contextRef)}" unitRef="${escapeXml(fact.unitRef)}" decimals="${escapeXml(fact.decimals)}">${escapeXml(fact.valueMinor)}</ix:nonFraction>`,
    );
  }

  const xhtml = `<html><body>${parts.join("")}</body></html>`;

  return Result.succeed({
    bytesDigest: input.presentation.presentationDigest,
    factCount: input.mappedFacts.length.toString(),
    contextCount: input.contexts.length.toString(),
    unitCount: input.units.length.toString(),
    xhtml,
  });
}

export const ValidationRun = Schema.Struct({
  documentLoaded: Schema.Boolean,
  stagesExecuted: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  requiredStages: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  fatalOrErrorCount: MinorUnits,
  blockingWarningsUnreviewed: MinorUnits,
  extractedFactCount: MinorUnits,
  expectedFactCount: MinorUnits,
  extractedDigest: Digest,
  expectedDigest: Digest,
  exitCode: MinorUnits,
});

export type ValidationRun = typeof ValidationRun.Type;

// Evaluates a native validation run record. A zero exit with a document
// that never loaded is a failure, as is any skipped required stage, any
// error, any unreviewed blocking warning, or any extracted-fact mismatch.
export function evaluateValidationRun(run: ValidationRun): Checked<typeof Digest.Type> {
  if (!run.documentLoaded) {
    return fail("DocumentNotLoaded", "The validator never loaded the document.");
  }

  const executed = new Set(run.stagesExecuted);

  for (const stage of run.requiredStages) {
    if (!executed.has(stage)) {
      return fail("ValidationStageSkipped", "A required validation stage did not run.");
    }
  }

  if (BigInt(run.fatalOrErrorCount) !== 0n) {
    return fail("ValidationError", "Validation reported a fatal or error outcome.");
  }

  if (BigInt(run.blockingWarningsUnreviewed) !== 0n) {
    return fail("ValidationError", "Validation has unreviewed blocking warnings.");
  }

  if (
    run.extractedFactCount !== run.expectedFactCount ||
    run.extractedDigest !== run.expectedDigest
  ) {
    return fail(
      "ExtractedFactMismatch",
      "Independently extracted facts disagree with the finalized model.",
    );
  }

  return Result.succeed(run.extractedDigest);
}

export const SignatureScopeInput = Schema.Struct({
  signedModelDigest: Digest,
  currentModelDigest: Digest,
  signedBytesRef: Identifier,
});

export type SignatureScopeInput = typeof SignatureScopeInput.Type;

export const SignatureScopeOutcome = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("covered"), signedBytesRef: Identifier }),
  Schema.Struct({
    kind: Schema.Literal("stale"),
    signedBytesRef: Identifier,
    retainedPriorBytesRef: Identifier,
  }),
]);

export type SignatureScopeOutcome = typeof SignatureScopeOutcome.Type;

// A signature covers exactly the bytes it was made over. After a
// governance change the old signed bytes are retained and the new model
// needs its own signature; coverage never stretches.
export function checkSignatureScope(input: SignatureScopeInput): Checked<SignatureScopeOutcome> {
  if (input.signedModelDigest === input.currentModelDigest) {
    return Result.succeed({ kind: "covered", signedBytesRef: input.signedBytesRef });
  }

  return Result.succeed({
    kind: "stale",
    signedBytesRef: input.signedBytesRef,
    retainedPriorBytesRef: input.signedBytesRef,
  });
}
