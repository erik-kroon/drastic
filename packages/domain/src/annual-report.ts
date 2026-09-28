import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Digest, Identifier } from "./values";
import { MinorUnits, SignedMinorUnits } from "./money";

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

// The K2 releases this build can actually produce. K2 output never implies
// K3 support, so any other release is an explicit blocker.
export const SupportedK2Releases: ReadonlyArray<string> = ["K2-2026"];

// The only taxonomy release this build ships: an explicit synthetic,
// non-statutory profile. It is not reviewed taxonomy data, it carries no
// filing authority, and it never substitutes for a qualified taxonomy.
export const SyntheticTaxonomyRelease = Schema.String.check(
  Schema.isPattern(/^synthetic-k2-v[0-9]+$/u),
);

export const DisclosureApplicability = Schema.Literals(["applicable", "inapplicable", "unknown"]);

export type DisclosureApplicability = typeof DisclosureApplicability.Type;

export const DisclosureRequirement = Schema.Struct({
  requirementId: Identifier,
  applicability: DisclosureApplicability,
  inapplicableReason: Schema.NullOr(Identifier),
  derivedMinor: Schema.NullOr(SignedMinorUnits),
  reviewedExplicitFact: Schema.Boolean,
});

export type DisclosureRequirement = typeof DisclosureRequirement.Type;

export const StatementFactOrigin = Schema.Struct({
  snapshotId: Identifier,
  rowId: Identifier,
});

export type StatementFactOrigin = typeof StatementFactOrigin.Type;

export const ReviewedFactOrigin = Schema.Struct({
  kind: Schema.Literal("reviewed_explicit"),
  evidenceRefs: Schema.Array(Identifier).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
});

export type ReviewedFactOrigin = typeof ReviewedFactOrigin.Type;

// A sealed fact always says where its amount came from: the retained
// statement row it was read from, or the evidence of an explicitly reviewed
// non-financial fact. A fact with no origin is a manufactured fact.
export const FactOrigin = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("statement_row"), ...StatementFactOrigin.fields }),
  ReviewedFactOrigin,
]);

export type FactOrigin = typeof FactOrigin.Type;

export const SemanticFact = Schema.Struct({
  semanticId: Identifier,
  valueMinor: Schema.NullOr(SignedMinorUnits),
  notApplicable: Schema.Boolean,
  evidenceRefs: Schema.Array(Identifier),
  calculationRefs: Schema.Array(Identifier),
  origin: FactOrigin,
});

export type SemanticFact = typeof SemanticFact.Type;

// The only per-fact shape a client may submit. A ledger fact names its
// retained row and states no amount; a non-ledger fact states a reviewed
// amount with its evidence and never names a row. Neither branch may carry
// both, and bindStatementFacts decides the branch from the exact key set so
// the invariant never depends on decoder excess-property policy.
export const SemanticFactRequest = Schema.Union([
  Schema.Struct({
    semanticId: Identifier,
    snapshotId: Identifier,
    rowId: Identifier,
    notApplicable: Schema.Boolean,
    evidenceRefs: Schema.Array(Identifier).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
    calculationRefs: Schema.Array(Identifier).check(Schema.isMaxLength(20)),
  }),
  Schema.Struct({
    semanticId: Identifier,
    valueMinor: SignedMinorUnits,
    notApplicable: Schema.Boolean,
    evidenceRefs: Schema.Array(Identifier).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
    calculationRefs: Schema.Array(Identifier).check(Schema.isMaxLength(20)),
  }),
]);

export type SemanticFactRequest = typeof SemanticFactRequest.Type;

// The only semantic ids a client may state as a reviewed non-ledger fact.
// A monetary fact is never in this set, so declaring a ledger concept
// "reviewed" cannot bypass deriving it from a retained statement row.
export const NonLedgerSemanticIds: ReadonlyArray<string> = [
  "board_member_count",
  "auditor_signing_count",
  "dividend_proposal_count",
  "prior_year_restatement_delta",
];

export const StatementRowAmount = Schema.Struct({
  snapshotId: Identifier,
  rowId: Identifier,
  amountMinor: SignedMinorUnits,
});

export type StatementRowAmount = typeof StatementRowAmount.Type;

export const BindStatementFactsInput = Schema.Struct({
  facts: Schema.Array(SemanticFactRequest).check(Schema.isMaxLength(500)),
  rows: Schema.Array(StatementRowAmount).check(Schema.isMaxLength(2000)),
});

export type BindStatementFactsInput = typeof BindStatementFactsInput.Type;

const statementRequestKeys: ReadonlySet<string> = new Set([
  "semanticId",
  "snapshotId",
  "rowId",
  "notApplicable",
  "evidenceRefs",
  "calculationRefs",
]);

const reviewedRequestKeys: ReadonlySet<string> = new Set([
  "semanticId",
  "valueMinor",
  "notApplicable",
  "evidenceRefs",
  "calculationRefs",
]);

function hasReviewedAmount(
  request: SemanticFactRequest,
): request is SemanticFactRequest & { readonly valueMinor: string } {
  return "valueMinor" in request;
}

function hasRowBinding(
  request: SemanticFactRequest,
): request is SemanticFactRequest & { readonly snapshotId: string; readonly rowId: string } {
  return "rowId" in request;
}

function requestBranch(request: SemanticFactRequest): "statement" | "reviewed" | null {
  const keys = Object.keys(request);
  const statement = hasRowBinding(request) && keys.every((key) => statementRequestKeys.has(key));
  const reviewed = hasReviewedAmount(request) && keys.every((key) => reviewedRequestKeys.has(key));

  if (statement === reviewed) return null;

  return statement ? "statement" : "reviewed";
}

// Sealing resolves each named row against the retained row amounts, so a
// client can name evidence but can never state a ledger amount. A named row
// no retained snapshot carries is a dangling reference, never a zero.
export function bindStatementFacts(input: BindStatementFactsInput): Checked<SemanticFact[]> {
  const amounts = new Map(
    input.rows.map((row) => [`${row.snapshotId}\u0000${row.rowId}`, row] as const),
  );

  const sealed: Array<SemanticFact> = [];

  for (const request of input.facts) {
    const branch = requestBranch(request);

    if (branch === null) {
      return fail(
        "ManufacturedFact",
        "A fact names a statement row, states an amount, or both; the two branches never overlap.",
      );
    }

    if (branch === "reviewed" && !NonLedgerSemanticIds.includes(request.semanticId)) {
      return fail(
        "ManufacturedFact",
        "Only a pinned non-financial fact may be a reviewed amount; a monetary fact derives from a retained row.",
      );
    }

    if (hasReviewedAmount(request)) {
      sealed.push(sealReviewedFact(request));
      continue;
    }

    if (!hasRowBinding(request)) {
      return fail("ManufacturedFact", "A fact is neither a named row nor a reviewed amount.");
    }

    const row = amounts.get(`${request.snapshotId}\u0000${request.rowId}`);

    if (row === undefined) {
      return fail(
        "DanglingReference",
        "A fact names a statement row no retained snapshot carries.",
      );
    }

    sealed.push(sealRowFact(request, row));
  }

  return Result.succeed(sealed);
}

function sealReviewedFact(
  request: SemanticFactRequest & { readonly valueMinor: string },
): SemanticFact {
  return {
    semanticId: request.semanticId,
    valueMinor: request.valueMinor,
    notApplicable: request.notApplicable,
    evidenceRefs: [...request.evidenceRefs],
    calculationRefs: [...request.calculationRefs],
    origin: { kind: "reviewed_explicit", evidenceRefs: [...request.evidenceRefs] },
  };
}

function sealRowFact(
  request: SemanticFactRequest & { readonly snapshotId: string; readonly rowId: string },
  row: StatementRowAmount,
): SemanticFact {
  return {
    semanticId: request.semanticId,
    valueMinor: row.amountMinor,
    notApplicable: request.notApplicable,
    evidenceRefs: [...request.evidenceRefs],
    calculationRefs: [...request.calculationRefs],
    origin: { kind: "statement_row", snapshotId: request.snapshotId, rowId: request.rowId },
  };
}

export const ComparativeBasis = Schema.Struct({
  snapshotId: Identifier,
  fiscalYear: Schema.String.check(Schema.isPattern(/^\d{4}$/u)),
});

export type ComparativeBasis = typeof ComparativeBasis.Type;

export const ComparativeSupportInput = Schema.Struct({
  currentFiscalYear: Schema.String.check(Schema.isPattern(/^\d{4}$/u)),
  currentSnapshotIds: Schema.Array(Identifier).check(Schema.isMinLength(1)),
  currentFacts: Schema.Array(SemanticFact),
  comparatives: Schema.Array(ComparativeBasis).check(Schema.isMaxLength(10)),
  comparativeFacts: Schema.Array(SemanticFact).check(Schema.isMaxLength(500)),
});

export type ComparativeSupportInput = typeof ComparativeSupportInput.Type;

function comparativeBlocker(input: ComparativeSupportInput): ReportFailure | null {
  const current = new Set(input.currentSnapshotIds);
  const years = new Set(input.comparatives.map((entry) => entry.fiscalYear));

  if (years.size !== input.comparatives.length || years.has(input.currentFiscalYear)) {
    return {
      code: "UnsupportedComparison",
      message: "Comparatives do not name distinct prior fiscal years.",
    };
  }

  if (input.comparatives.some((entry) => current.has(entry.snapshotId))) {
    return {
      code: "UnsupportedComparison",
      message: "A current-year snapshot cannot serve as comparative.",
    };
  }

  return null;
}

function currentFactBlocker(facts: ReadonlyArray<SemanticFact>, current: ReadonlySet<string>) {
  for (const fact of facts) {
    if (fact.origin.kind !== "statement_row" || !current.has(fact.origin.snapshotId)) {
      return {
        code: "DanglingReference",
        message: "A current-year fact binds no retained current-year row.",
      } satisfies ReportFailure;
    }
  }

  return null;
}

function comparativeFactBlocker(
  input: ComparativeSupportInput,
  named: Set<string>,
): ReportFailure | null {
  for (const fact of input.comparativeFacts) {
    const origin = fact.origin;

    if (origin.kind !== "statement_row") {
      return {
        code: "UnsupportedComparison",
        message: "A comparative fact must bind to a retained row.",
      };
    }

    if (!input.comparatives.some((entry) => entry.snapshotId === origin.snapshotId)) {
      return {
        code: "UnsupportedComparison",
        message: "A comparative fact binds outside the comparative basis.",
      };
    }

    if (named.has(fact.semanticId)) {
      return {
        code: "UnsupportedComparison",
        message: "A comparative fact repeats a current-year semantic id.",
      };
    }

    named.add(fact.semanticId);
  }

  if (input.comparatives.length === 0 && input.comparativeFacts.length > 0) {
    return {
      code: "UnsupportedComparison",
      message: "Comparative facts exist without a comparative basis.",
    };
  }

  return null;
}

// A comparative is supported only when it is a distinct retained fiscal
// year: not the current year, not a current-year snapshot, and bound to
// rows its own snapshot carries. Current-year labels never reach a
// comparative amount.
export function deriveComparativeSupport(
  input: ComparativeSupportInput,
): Checked<ComparativeBasis[]> {
  const basis = comparativeBlocker(input);

  if (basis !== null) return Result.fail(basis);

  const current = new Set(input.currentSnapshotIds);
  const unbound = currentFactBlocker(input.currentFacts, current);

  if (unbound !== null) return Result.fail(unbound);

  const named = new Set(input.currentFacts.map((fact) => fact.semanticId));
  const comparative = comparativeFactBlocker(input, named);

  if (comparative !== null) return Result.fail(comparative);

  return Result.succeed(input.comparatives.map((entry) => ({ ...entry })));
}

export const AnnualReportDraft = Schema.Struct({
  draftId: Identifier,
  fiscalYear: Schema.String.check(Schema.isPattern(/^\d{4}$/u)),
  frameworkRelease: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  closeCertificateRef: Identifier,
  statementSnapshotIds: Schema.Array(Identifier).check(Schema.isMinLength(1)),
  requirements: Schema.Array(DisclosureRequirement),
  facts: Schema.Array(SemanticFact),
  narrativeApprovalRef: Schema.NullOr(Identifier),
  comparativeSupported: Schema.Boolean,
  comparativeSnapshotIds: Schema.Array(Identifier),
});

export type AnnualReportDraft = typeof AnnualReportDraft.Type;

export const FinalSemanticReport = Schema.Struct({
  reportId: Identifier,
  draftId: Identifier,
  fiscalYear: Schema.String.check(Schema.isPattern(/^\d{4}$/u)),
  frameworkRelease: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  factCount: MinorUnits,
  requirementCount: MinorUnits,
  modelDigest: Digest,
});

export type FinalSemanticReport = typeof FinalSemanticReport.Type;

// Everything a finalized model requires apart from the retained narrative
// approval, so a draft can be reviewed before it is approved without the
// approval becoming its own precondition.
export function checkDraftSemantics(draft: AnnualReportDraft): ReportFailure | null {
  if (!SupportedK2Releases.includes(draft.frameworkRelease)) {
    return {
      code: "UnsupportedFramework",
      message: "This build produces the pinned K2 releases only; K3 is never implied.",
    };
  }

  const requirement = unresolvedRequirement(draft.requirements);

  if (requirement !== null) return requirement;

  if (!draft.comparativeSupported) {
    return {
      code: "UnsupportedComparison",
      message: "An unsupported comparative basis blocks finalization.",
    };
  }

  const current = new Set(draft.statementSnapshotIds);

  if (draft.comparativeSnapshotIds.some((snapshotId) => current.has(snapshotId))) {
    return {
      code: "UnsupportedComparison",
      message: "A current-year snapshot cannot serve as comparative.",
    };
  }

  return unboundFact(draft.facts, current);
}

// Finalization requires a supported framework release, every mandatory
// disclosure resolved, a supported comparative basis, a retained narrative
// approval, and every fact bound to its origin. A K2 release never implies
// K3 support: an unsupported framework is an explicit blocker, not a silent
// template substitution.
export function finalizeSemanticReport(
  draft: AnnualReportDraft,
  reportId: typeof Identifier.Type,
  modelDigest: typeof Digest.Type,
): Checked<FinalSemanticReport> {
  const semantic = checkDraftSemantics(draft);

  if (semantic !== null) return fail(semantic.code, semantic.message);

  if (draft.narrativeApprovalRef === null) {
    return fail(
      "UnapprovedNarrative",
      "Narratives without a retained approval block finalization.",
    );
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

function unresolvedRequirement(
  requirements: ReadonlyArray<DisclosureRequirement>,
): ReportFailure | null {
  for (const requirement of requirements) {
    if (requirement.applicability === "unknown") {
      return {
        code: "MissingMandatoryDisclosure",
        message: "A disclosure with unknown applicability keeps the report a draft.",
      };
    }

    if (
      requirement.applicability === "applicable" &&
      requirement.derivedMinor === null &&
      !requirement.reviewedExplicitFact
    ) {
      return {
        code: "MissingMandatoryDisclosure",
        message: "An applicable disclosure without a derived or reviewed fact blocks finalization.",
      };
    }

    if (requirement.applicability === "inapplicable" && requirement.inapplicableReason === null) {
      return {
        code: "MissingMandatoryDisclosure",
        message: "An inapplicable disclosure needs its retained reason.",
      };
    }
  }

  return null;
}

function unboundFact(
  facts: ReadonlyArray<SemanticFact>,
  current: ReadonlySet<string>,
): ReportFailure | null {
  for (const fact of facts) {
    if (fact.origin === undefined) {
      return {
        code: "ManufacturedFact",
        message: "A sealed fact states an amount without naming where it was derived.",
      };
    }

    if (fact.valueMinor === null && !fact.notApplicable) {
      return {
        code: "MissingMandatoryDisclosure",
        message: "A null fact that is not marked not-applicable blocks finalization.",
      };
    }

    if (fact.origin.kind === "statement_row" && !current.has(fact.origin.snapshotId)) {
      return {
        code: "DanglingReference",
        message: "A fact binds a snapshot outside this report's retained statements.",
      };
    }

    if (
      fact.origin.kind === "reviewed_explicit" &&
      !NonLedgerSemanticIds.includes(fact.semanticId)
    ) {
      return {
        code: "ManufacturedFact",
        message: "A monetary fact was reviewed instead of derived from a retained row.",
      };
    }
  }

  return null;
}

// The exact display rule. `scale` is the number of minor-unit decimals a
// major-unit decimal point replaces, so scale 3 renders 123456 as 123.456.
// There is no rounding, so a displayed value always denotes exactly the
// sealed minor amount it came from.
export const DisplayRule = Schema.Struct({
  scale: Schema.Int.check(Schema.isBetween({ minimum: -6, maximum: 6 })),
  rounding: Schema.Literal("exact"),
});

export type DisplayRule = typeof DisplayRule.Type;

export function deriveDisplayedMinor(minor: string, scale: number): string {
  const amount = BigInt(minor);
  const places = Math.abs(scale);
  const digits = (amount < 0n ? -amount : amount).toString().padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places);
  const tail = digits.slice(digits.length - places);
  const point = scale >= 0 ? `${whole}${places === 0 ? "" : `.${tail}`}` : `${whole}${tail}`;

  return `${amount < 0n ? "-" : ""}${point}`;
}

export const PresentedFact = Schema.Struct({
  semanticId: Identifier,
  sourceMinor: SignedMinorUnits,
  displayedMinor: SignedMinorUnits,
  roundingProvenance: Identifier,
});

export type PresentedFact = typeof PresentedFact.Type;

// A reconciled total names its own members, because summing assets,
// liabilities, equity and result across unrelated concepts is not a total.
export const PresentedTotal = Schema.Struct({
  label: Identifier,
  memberSemanticIds: Schema.Array(Identifier).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
});

export type PresentedTotal = typeof PresentedTotal.Type;

export const PresentationRevision = Schema.Struct({
  presentationId: Identifier,
  modelDigest: Digest,
  displayUnit: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16)),
  displayRule: DisplayRule,
  facts: Schema.Array(PresentedFact),
  totals: Schema.Array(PresentedTotal),
  presentationDigest: Digest,
});

export type PresentationRevision = typeof PresentationRevision.Type;

export const PreparePresentationInput = Schema.Struct({
  presentationId: Identifier,
  report: FinalSemanticReport,
  sealedFacts: Schema.Array(SemanticFact),
  displayRule: DisplayRule,
  totals: Schema.Array(PresentedTotal).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  presentationDigest: Digest,
});

export type PreparePresentationInput = typeof PreparePresentationInput.Type;

// Displayed values are derived here, never asserted by a client, and the
// presented set must cover the whole sealed model exactly once across the
// named totals. No balancing journal is created for display rounding.
export function preparePresentation(
  input: PreparePresentationInput,
): Checked<PresentationRevision> {
  if (BigInt(input.sealedFacts.length) !== BigInt(input.report.factCount)) {
    return fail("PresentationMismatch", "The presented set does not cover the sealed fact set.");
  }

  const facts = input.sealedFacts.map((sealed) => ({
    semanticId: sealed.semanticId,
    sourceMinor: sealed.valueMinor ?? "0",
    displayedMinor:
      sealed.valueMinor === null
        ? "0"
        : deriveDisplayedMinor(sealed.valueMinor, input.displayRule.scale),
    roundingProvenance: `${input.displayRule.rounding}_scale${input.displayRule.scale}`,
  }));

  const reconciled = reconcileTotals(input.totals, facts);

  if (reconciled !== null) return fail(reconciled.code, reconciled.message);

  return Result.succeed({
    presentationId: input.presentationId,
    modelDigest: input.report.modelDigest,
    displayUnit: "SEK",
    displayRule: input.displayRule,
    facts,
    totals: input.totals.map((total) => ({ ...total })),
    presentationDigest: input.presentationDigest,
  });
}

function reconcileTotals(
  totals: ReadonlyArray<PresentedTotal>,
  facts: ReadonlyArray<PresentedFact>,
): ReportFailure | null {
  const presented = new Set(facts.map((fact) => fact.semanticId));
  const counts = new Map<string, number>();

  for (const total of totals) {
    if (new Set(total.memberSemanticIds).size !== total.memberSemanticIds.length) {
      return {
        code: "PresentationMismatch",
        message: "A reconciled total repeats one of its members.",
      };
    }

    for (const member of total.memberSemanticIds) {
      if (!presented.has(member)) {
        return {
          code: "PresentationMismatch",
          message: "A reconciled total names a fact outside the model.",
        };
      }

      counts.set(member, (counts.get(member) ?? 0) + 1);
    }
  }

  if (counts.size !== facts.length || [...counts.values()].some((count) => count !== 1)) {
    return {
      code: "PresentationMismatch",
      message: "Named totals do not partition the sealed fact set.",
    };
  }

  return null;
}

const periodPattern = /^(?:\d{4}(?:-\d{2}-\d{2})?(?:\/\d{4}-\d{2}-\d{2})?)$/u;

export const IxbrlContext = Schema.Struct({
  contextRef: Identifier,
  entityIdentifier: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  period: Schema.String.check(Schema.isPattern(periodPattern)),
  dimensions: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
});

export type IxbrlContext = typeof IxbrlContext.Type;

export const IxbrlFact = Schema.Struct({
  concept: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  contextRef: Identifier,
  unitRef: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  valueMinor: SignedMinorUnits,
  decimals: Schema.String.check(Schema.isPattern(/^-?[0-9]{1,6}$/u)),
});

export type IxbrlFact = typeof IxbrlFact.Type;

export const IxbrlAssemblyInput = Schema.Struct({
  report: FinalSemanticReport,
  presentation: PresentationRevision,
  mappedFacts: Schema.Array(IxbrlFact),
  contexts: Schema.Array(IxbrlContext),
  units: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  taxonomyRelease: SyntheticTaxonomyRelease,
  unmappedConcepts: Schema.Array(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  ),
});

export type IxbrlAssemblyInput = typeof IxbrlAssemblyInput.Type;

// No bytesDigest: the application owns the real content hash over the exact
// bytes it retains, so this layer never restates a digest it did not compute.
export const IxbrlDocument = Schema.Struct({
  taxonomyRelease: SyntheticTaxonomyRelease,
  factCount: MinorUnits,
  contextCount: MinorUnits,
  unitCount: MinorUnits,
  xhtml: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000000)),
});

export type IxbrlDocument = typeof IxbrlDocument.Type;

type SyntheticConcept = {
  readonly qname: string;
  readonly datatype: "monetaryItem";
  readonly periodRole: "instant" | "duration";
  readonly unit: "SEK";
};

// The pinned synthetic profile. Every entry is an explicit synthetic,
// non-statutory stand-in: this is not reviewed taxonomy data.
const syntheticConcepts: ReadonlyArray<SyntheticConcept> = [
  { qname: "se:Assets", datatype: "monetaryItem", periodRole: "instant", unit: "SEK" },
  { qname: "se:Equity", datatype: "monetaryItem", periodRole: "instant", unit: "SEK" },
  { qname: "se:Liabilities", datatype: "monetaryItem", periodRole: "instant", unit: "SEK" },
  {
    qname: "se:ProfitLossForTheYear",
    datatype: "monetaryItem",
    periodRole: "duration",
    unit: "SEK",
  },
  { qname: "se:Revenue", datatype: "monetaryItem", periodRole: "duration", unit: "SEK" },
];

export function syntheticTaxonomyConcept(qname: string): SyntheticConcept | null {
  return syntheticConcepts.find((concept) => concept.qname === qname) ?? null;
}

const namespaceDeclarations = [
  'xmlns="http://www.w3.org/1999/xhtml"',
  'xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"',
  'xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"',
  'xmlns:link="http://www.xbrl.org/2003/linkbase"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'xmlns:xbrli="http://www.xbrl.org/2003/instance"',
  'xmlns:xbrldi="http://xbrl.org/2006/xbrldi"',
  'xmlns:se="http://open-erp.invalid/synthetic/se/2026-01-01"',
].join(" ");

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function displayDecimals(rule: DisplayRule): string {
  return rule.scale >= 0 ? rule.scale.toString() : "0";
}

function matchesPeriod(concept: SyntheticConcept, period: string): boolean {
  const [start, end] = period.split("/");

  if (concept.periodRole === "duration") {
    return start !== undefined && end !== undefined && start <= end;
  }

  return end === undefined;
}

// Deterministic iXBRL assembly over pinned contexts and units. Every concept
// must exist in the pinned synthetic release and match its period role, every
// referenced unit is declared as an xbrli:unit element, a duration period is
// never emitted as an instant, duplicate facts with inconsistent values
// refuse and dangling references refuse. The bytes are well-formed XHTML
// carrying no validation claim of any kind.
export function assembleIxbrl(input: IxbrlAssemblyInput): Checked<IxbrlDocument> {
  if (input.unmappedConcepts.length > 0) {
    return fail(
      "UnknownConceptMapping",
      "A semantic fact has no qualified taxonomy concept mapping.",
    );
  }

  if (input.report.modelDigest !== input.presentation.modelDigest) {
    return fail("FinancialMismatch", "The presentation does not belong to the finalized model.");
  }

  const contexts = new Map(input.contexts.map((context) => [context.contextRef, context]));
  const units = new Set(input.units);
  const seen = new Map<string, string>();
  const facts: Array<string> = [];

  if (input.contexts.length !== contexts.size) {
    return fail("DuplicateFactConflict", "Two contexts share one context reference.");
  }

  if (new Set(input.units).size !== input.units.length) {
    return fail("DuplicateFactConflict", "A unit is declared more than once.");
  }

  for (const fact of [...input.mappedFacts].sort(byConceptThenContext)) {
    const concept = syntheticTaxonomyConcept(fact.concept);
    const context = contexts.get(fact.contextRef);

    if (concept === null) {
      return fail("UnknownConceptMapping", "A concept is outside the pinned synthetic release.");
    }

    if (context === undefined) {
      return fail("DanglingReference", "A fact references an undeclared context.");
    }

    if (!units.has(fact.unitRef) || fact.unitRef !== concept.unit) {
      return fail("DanglingReference", "A fact references an undeclared or mismatched unit.");
    }

    if (!matchesPeriod(concept, context.period)) {
      return fail("FinancialMismatch", "A concept is reported over the wrong period type.");
    }

    if (fact.decimals !== displayDecimals(input.presentation.displayRule)) {
      return fail(
        "FinancialMismatch",
        "A fact declares precision its display rule cannot produce.",
      );
    }

    const key = `${fact.concept}\u0000${fact.contextRef}\u0000${fact.unitRef}`;
    const prior = seen.get(key);

    if (prior !== undefined && prior !== fact.valueMinor) {
      return fail("DuplicateFactConflict", "Duplicate facts carry inconsistent values.");
    }

    if (prior === undefined) {
      seen.set(key, fact.valueMinor);
      facts.push(factXml(fact, input.presentation.displayRule));
    }
  }

  return Result.succeed({
    taxonomyRelease: input.taxonomyRelease,
    factCount: facts.length.toString(),
    contextCount: input.contexts.length.toString(),
    unitCount: input.units.length.toString(),
    xhtml: documentXml(input, facts),
  });
}

function byConceptThenContext(left: IxbrlFact, right: IxbrlFact) {
  if (left.concept !== right.concept) return left.concept < right.concept ? -1 : 1;

  if (left.contextRef !== right.contextRef) return left.contextRef < right.contextRef ? -1 : 1;

  return left.unitRef < right.unitRef ? -1 : 1;
}

function factXml(fact: IxbrlFact, rule: DisplayRule): string {
  // The encoded value is the exact source amount; the display rule's scale is
  // carried as the iXBRL scale attribute, so the rendered number is exactly
  // the displayed number rather than a second, differently rounded value.
  const scale = rule.scale === 0 ? "" : ` scale="${-rule.scale}"`;

  return `<ix:nonFraction name="${escapeXml(fact.concept)}" contextRef="${escapeXml(fact.contextRef)}" unitRef="${escapeXml(fact.unitRef)}" decimals="${escapeXml(fact.decimals)}"${scale} format="ixt:num-dot-decimal">${escapeXml(fact.valueMinor)}</ix:nonFraction>`;
}

function contextXml(context: IxbrlContext): string {
  const [start, end] = context.period.split("/");

  const period =
    end === undefined
      ? `<xbrli:instant>${escapeXml(start ?? "")}</xbrli:instant>`
      : `<xbrli:startDate>${escapeXml(start ?? "")}</xbrli:startDate><xbrli:endDate>${escapeXml(end)}</xbrli:endDate>`;

  const dimensions = context.dimensions
    .map(
      (member) =>
        `<xbrldi:explicitMember dimension="${escapeXml(member)}">${escapeXml(member)}</xbrldi:explicitMember>`,
    )
    .join("");

  return `<xbrli:context id="${escapeXml(context.contextRef)}"><xbrli:entity><xbrli:identifier scheme="http://www.renskal.se/se/orgnr">${escapeXml(context.entityIdentifier)}</xbrli:identifier></xbrli:entity><xbrli:period>${period}</xbrli:period>${dimensions === "" ? "" : `<xbrli:scenario><xbrldi:explicitMember>${dimensions}</xbrldi:explicitMember></xbrli:scenario>`}</xbrli:context>`;
}

function headerXml(taxonomyRelease: string): string {
  return [
    "<ix:header>",
    "<ix:hidden>",
    '<xbrli:context id="document">',
    "<xbrli:entity><xbrli:identifier/></xbrli:entity>",
    "<xbrli:period><xbrli:instant>2026-01-01</xbrli:instant></xbrli:period>",
    "</xbrli:context>",
    "</ix:hidden>",
    "<ix:references>",
    '<link:schemaRef xlink:type="simple" xlink:href="http://open-erp.invalid/synthetic/se/2026-01-01/se-2026-01-01.xsd"/>',
    '<link:linkbaseRef xlink:type="simple" xlink:href="http://open-erp.invalid/synthetic/se/2026-01-01/se-2026-01-01_lab.xml" xlink:role="http://www.xbrl.org/2003/linkbase/lab"/>',
    '<link:linkbaseRef xlink:type="simple" xlink:href="http://open-erp.invalid/synthetic/se/2026-01-01/se-2026-01-01_pre.xml" xlink:role="http://www.xbrl.org/2003/linkbase/pre"/>',
    "</ix:references>",
    `<ix:resources><ix:resource xsi:schemaLocation="http://open-erp.invalid/synthetic/se/2026-01-01/se-2026-01-01.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="${escapeXml(taxonomyRelease)}"><ix:schemaRefs><ix:schemaRef>http://open-erp.invalid/synthetic/se/2026-01-01/se-2026-01-01.xsd</ix:schemaRef></ix:schemaRefs></ix:resource></ix:resources>`,
    '<ix:nonNumeric name="se:TaxonomyProfile" contextRef="document" format="ixt:text"><ix:nonFraction></ix:nonFraction></ix:nonNumeric>',
    "</ix:header>",
  ].join("");
}

function documentXml(input: IxbrlAssemblyInput, facts: ReadonlyArray<string>): string {
  const units = input.units
    .map(
      (unit) =>
        `<xbrli:unit id="${escapeXml(unit)}"><xbrli:measure>iso4217:${escapeXml(unit)}</xbrli:measure></xbrli:unit>`,
    )
    .join("");

  const contexts = [...input.contexts]
    .sort((left, right) => (left.contextRef < right.contextRef ? -1 : 1))
    .map(contextXml)
    .join("");

  return [
    `<html ${namespaceDeclarations}>`,
    "<head><title>Annual report</title></head>",
    "<body>",
    `<div style="display:none">${headerXml(input.taxonomyRelease)}</div>`,
    `<div>${contexts}${units}</div>`,
    `<div>${facts.join("")}</div>`,
    "</body></html>",
  ].join("");
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
// No qualified validator is released for this build, so nothing in this leaf
// records a pass: the application keeps every artifact pending.
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
