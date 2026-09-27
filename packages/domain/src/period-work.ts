// Evidence-aware period preparation: the pure layer.
//
// This module decides, for one frozen child of a period-work manifest, which
// owning operation should handle it, which reviewed rule applies, and what the
// sealed manifest and batch digests are. It performs no database access, holds
// no lock, starts no runtime and calls nothing over the network. Every
// unresolved fact stays unresolved here: an AI or an agent may propose a
// missing fact or a candidate rule, but it cannot supply a confirmed fact and
// it cannot approve.

import * as Schema from "effect/Schema";

import { AccountingDate, Description, Digest, Identifier, Scope } from "./values";
import { MinorUnits, SignedMinorUnits } from "./money";

// The stable identity of one unit of work inside a manifest. It is derived
// from the book, the requested interval and the child's own source identity,
// so the same child in the same interval always produces the same key. It is
// never derived from a queue claim, an attempt counter or a wall clock.
export const WorkIdentity = Schema.String.check(Schema.isPattern(/^period_work_[0-9a-f]{32}$/));

// The bounds this owner enforces. They are declared before every schema that
// reads one, so a bound cannot drift out of reach of the contract it limits.
export const periodWorkBoundary = {
  maximumChildren: 500,
  maximumExcluded: 200,
  maximumRules: 64,
  maximumMatchesPerChild: 32,
  maximumDependencies: 16,
  maximumMissingFacts: 32,
  maximumMembers: 200,
} as const;

export const WorkIdentityDigest = Digest;

// A reviewed relationship between this child and an economic event some other
// owner already recognizes. The packet is explicit that a bank row must not be
// copied into a new purchase identity when a matched invoice already
// establishes its recognition, so the reference is carried as a reference and
// never used to mint a second recognition.
export const ExistingRecognition = Schema.Struct({
  recognitionId: Identifier,
  // The owner that holds the recognition. Routing never re-derives it.
  owner: Schema.Literals([
    "purchases.recognition",
    "purchases.credits",
    "owner.operations",
    "commerce.invoice",
  ]),
  voucherId: Identifier,
  // What the recognized event already covers, so the router can tell a
  // settlement of a known obligation from a genuinely new recognition.
  covers: Schema.Literals(["recognition", "obligation", "settlement", "disposal"]),
});

export const ExistingMatch = Schema.Struct({
  matchId: Identifier,
  sourceSystem: Schema.String,
  sourceId: Schema.String,
  // The amount the source asserted, kept exact. A changed amount is a fact
  // change, which routes to review rather than silently re-routing.
  sourceMinor: MinorUnits,
  confirmed: Schema.Boolean,
});

// One reviewed treatment-selection rule. A rule is immutable and versioned;
// activating a rule approves this treatment-selection rule and not any future
// journal that later selects it.
export const PreparationRule = Schema.Struct({
  id: Identifier,
  version: Schema.Int,
  legalSupplierIdentity: Identifier,
  supportedDocumentClass: Schema.Literals([
    "domestic_invoice",
    "domestic_credit_note",
    "foreign_service_invoice",
    "bank_observation",
    "owner_expense",
  ]),
  currency: Schema.String,
  qualifiedTreatmentId: Identifier,
  acceptedEvidenceRequirements: Schema.Array(Identifier),
  operationFamily: Schema.Literals([
    "SupplierRecognition",
    "SupplierCredit",
    "OwnerPaidPurchase",
    "Settlement",
    "OwnedCorrection",
    "ReviewCase",
  ]),
  approvedExamples: Schema.Array(Identifier),
  negativeExamples: Schema.Array(Identifier),
  // The review that qualified this rule. It is a reference, never a boolean.
  activationReview: Identifier,
});

export type PreparationRule = typeof PreparationRule.Type;

export const WorkChildState = Schema.Literals([
  "pending",
  "waiting_predecessor",
  "needs_review",
  "prepared",
  "recovered",
  "committed",
  "refused",
]);

export type WorkChildState = typeof WorkChildState.Type;

// What the router decided, and the exact reason. A router that cannot decide
// must say which facts are missing rather than guessing a family.
export const RouteTarget = Schema.Literals([
  "existing_obligation_settlement",
  "OwnerPaidPurchase",
  "SupplierRecognition",
  "OwnedCorrectionReview",
  "ReviewCase",
]);

export type RouteTarget = typeof RouteTarget.Type;

export const RouteFailure = Schema.Literals([
  "ambiguous_rule",
  "unknown_entity",
  "unsupported_document_class",
  "currency_not_qualified",
  "missing_evidence",
  "rule_changed_since_selection",
  "unmatched_source",
  // The child needs a settlement that no released owner performs. It stays a
  // review case naming the gap; it is never dispatched to a name that has no
  // implementation.
  "settlement_owner_not_released",
]);

// The released settlement owners, narrowed to the ones that actually exist.
// `purchases.settlement` and `banking.settlement` are named in the packet's
// vocabulary but no operation in this repository posts a company-bank payment
// against a recognized supplier obligation, so neither is listed here. A child
// that needs one is a review case, not a dispatch to an absent owner.
export const SettlementOwner = Schema.Literal("owner.operations");

export type SettlementOwner = typeof SettlementOwner.Type;

export const RouteDecision = Schema.Struct({
  target: RouteTarget,
  // Present only for existing_obligation_settlement. The owning settlement
  // operation is dispatched to; this router never posts a settlement itself.
  settlementOwner: Schema.optional(SettlementOwner),
  existingRecognitionId: Schema.optional(Identifier),
  ruleId: Schema.optional(Identifier),
  ruleVersion: Schema.optional(Schema.Int),
  // Exact missing facts, named. Never a boolean "insufficient evidence".
  missingFacts: Schema.Array(Schema.String),
  failure: Schema.optional(RouteFailure),
});

export type RouteDecision = typeof RouteDecision.Type;

// The owning operation a routed child is dispatched to. Every value here is a
// real named operation in this repository. A route that cannot be dispatched is
// a review case and never appears in this list.
export const BatchOwner = Schema.Literals([
  "purchases.recognition",
  "purchases.credits",
  "owner.operations",
  "commerce.invoice",
]);

export type BatchOwner = typeof BatchOwner.Type;

// One child of the manifest. Frozen membership: a source that arrives after the
// manifest was sealed is not in it, and a new manifest is required to select
// it explicitly.
export const WorkChild = Schema.Struct({
  workIdentity: WorkIdentity,
  // The economic identity this work would act on, and the exact source revision
  // it was selected at. Both are frozen.
  economicIdentity: Schema.String,
  sourceRevision: Schema.String,
  sourceSystem: Schema.String,
  sourceId: Schema.String,
  documentClass: Schema.Literals([
    "domestic_invoice",
    "domestic_credit_note",
    "foreign_service_invoice",
    "bank_observation",
    "owner_expense",
  ]),
  currency: Schema.String,
  legalSupplierIdentity: Schema.optional(Identifier),
  qualifiedTreatmentId: Schema.optional(Identifier),
  evidenceIds: Schema.optional(Schema.Array(Identifier)),
  sourceMinor: MinorUnits,
  // True when the child came from a bank or owner payment rather than a
  // document. A bank row is never turned into a new purchase identity.
  isPaymentObservation: Schema.Boolean,
  existingRecognition: Schema.optional(ExistingRecognition),
  existingMatches: Schema.Array(ExistingMatch),
  // A child whose financial effect depends on an earlier child. A dependent
  // child cannot enter a preapproved batch before its predecessor commits.
  dependsOn: Schema.Array(WorkIdentity),
  // The operation this child is intended for, reviewed when the manifest was
  // sealed. It is a declared expectation, not a dispatch: routing may still send
  // the child to review, and a child whose intended owner disagrees with the
  // routed owner is a review case rather than a silent substitution.
  intendedOwner: Schema.optional(BatchOwner),
  // The exact, reviewed command the owning prepare operation is called with.
  //
  // A child carries no financial inputs of its own, so this is the only way a
  // period run can call a real owner operation without inventing a fact. It is
  // absent whenever the reviewed inputs are not yet available, and the run then
  // records a precise case naming exactly which inputs are missing rather than
  // fabricating a command. An absent input is never treated as a zero, a default
  // or an AI-supplied guess.
  prepareInput: Schema.optional(Schema.JsonObject),
});

export type WorkChild = typeof WorkChild.Type;

export const SourceCoverage = Schema.Struct({
  // The exact population the manifest was cut from, and whether that population
  // was complete. A run with every child visited is not a reconciled period.
  populationComplete: Schema.Boolean,
  selectedCount: Schema.Int,
  // Sources deliberately excluded from this manifest, each with its reason.
  excluded: Schema.Array(Schema.Struct({ sourceId: Schema.String, reason: Schema.String })),
});

export type SourceCoverage = typeof SourceCoverage.Type;

export const PeriodWorkManifest = Schema.Struct({
  id: Identifier,
  scope: Scope,
  requestedInterval: Schema.Struct({
    startsOn: AccountingDate,
    endsOn: AccountingDate,
  }),
  cutoff: AccountingDate,
  sourceCoverage: SourceCoverage,
  children: Schema.Array(WorkChild),
  rules: Schema.Array(PreparationRule),
  digest: Digest,
});

export type PeriodWorkManifest = typeof PeriodWorkManifest.Type;

// The explicit fixed manifest a human approves. It is a list of already sealed
// member plans, never a rule that admits a future arrival.
export const BatchMember = Schema.Struct({
  owner: BatchOwner,
  planId: Identifier,
  planDigest: Digest,
  inputIdentity: Schema.String,
  workIdentity: WorkIdentity,
  // The owning operation's own review and approval identities. The batch approval
  // is a human gesture over the exact members; each member's own approval stays
  // with its owner and is what that owner's execute consumes.
  ownerReviewId: Identifier,
  ownerReviewDigest: Digest,
});

export type BatchMember = typeof BatchMember.Type;

export const ApprovalBatch = Schema.Struct({
  id: Identifier,
  manifestId: Identifier,
  scope: Scope,
  members: Schema.Array(BatchMember).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(periodWorkBoundary.maximumMembers),
  ),
  // Informational only. The combined total is shown for the human and is never
  // a journal line and never a balancing figure.
  combinedInformationalMinor: SignedMinorUnits,
  digest: Digest,
});

export type ApprovalBatch = typeof ApprovalBatch.Type;

const code = (left: string, right: string): 0 | 1 | -1 =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * The owning operation a routed child is dispatched to.
 *
 * Only a route that a released operation can actually perform resolves to an
 * owner. `OwnedCorrectionReview` and `ReviewCase` resolve to nothing, because
 * naming an owner for them would be a claim that this run can post a correction
 * or a review, which it cannot: it routes and records, and the owning
 * operation posts.
 */
export function ownerForTarget(target: RouteTarget): BatchOwner | undefined {
  switch (target) {
    case "existing_obligation_settlement":
      return "owner.operations";
    case "OwnerPaidPurchase":
      return "owner.operations";
    case "SupplierRecognition":
      return "purchases.recognition";
    case "OwnedCorrectionReview":
    case "ReviewCase":
      return undefined;
  }
}

/**
 * The stable command identity for one child of one run.
 *
 * It is derived from the run, the child and the exact source revision the child
 * was frozen at, never from a queue claim, an attempt counter or a wall clock.
 * A redelivered handler therefore recovers the same command rather than minting
 * a second one, and a changed source revision is a different command and
 * therefore a new preparation rather than a silent reuse of an approved plan.
 */
export function childCommandKey(manifestId: string, child: WorkChild): string {
  return `pw_${manifestId}_${child.workIdentity}_${child.sourceRevision}`;
}

/**
 * The exact missing facts a child must be told about, bounded and sorted. A
 * child with more facts than this is not a review case a human can act on.
 */
export function boundedMissingFacts(facts: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(facts)].sort(code).slice(0, periodWorkBoundary.maximumMissingFacts);
}

/**
 * Deterministic evidence-aware routing for one child.
 *
 * The order of the tests is the packet's order and is load-bearing: a committed
 * purchase plus a new payment routes to the existing obligation's settlement
 * owner before anything else is considered, so a matched bank row can never
 * become a second recognition of the same economic event.
 */
export function routeWork(
  child: WorkChild,
  rules: ReadonlyArray<PreparationRule>,
  reviewedInput: {
    readonly ownerPaidExpenseIsUnrecognized: boolean;
    readonly sourceRevisesRecognizedFacts: boolean;
    readonly invoiceEntityIsKnown: boolean;
    readonly committedPurchaseExists: boolean;
  },
): RouteDecision {
  // A payment observation is only ever a settlement of something already
  // recognized. Without an existing recognition there is nothing to settle, and
  // inventing a purchase identity here is exactly the copy the packet forbids.
  if (child.isPaymentObservation) {
    const recognition = child.existingRecognition;

    if (recognition === undefined) {
      return {
        target: "ReviewCase",
        missingFacts: ["payment_observation_without_matching_recognition"],
        failure: "unmatched_source",
      };
    }

    if (!reviewedInput.committedPurchaseExists) {
      return {
        target: "ReviewCase",
        existingRecognitionId: recognition.recognitionId,
        missingFacts: ["payment_observation_without_committed_purchase"],
        failure: "unmatched_source",
      };
    }

    // The owner-paid route has a released owner: NEXT-06 discharges a recognized
    // supplier payable against the owner's own private liability. A company-bank
    // payment against a recognized supplier obligation has no released owner in
    // this repository, so the obligation stays open and the case names the gap
    // rather than dispatching to a name with no implementation.
    if (recognition.owner === "owner.operations") {
      return {
        target: "existing_obligation_settlement",
        settlementOwner: "owner.operations",
        existingRecognitionId: recognition.recognitionId,
        missingFacts: [],
      };
    }

    return {
      target: "ReviewCase",
      existingRecognitionId: recognition.recognitionId,
      missingFacts: ["company_bank_settlement_owner_not_released"],
      failure: "settlement_owner_not_released",
    };
  }

  if (reviewedInput.ownerPaidExpenseIsUnrecognized) {
    const selected = selectRule(child, rules, "OwnerPaidPurchase");

    return selected.failure !== undefined
      ? selected
      : { ...selected, target: "OwnerPaidPurchase", missingFacts: [] };
  }

  if (reviewedInput.sourceRevisesRecognizedFacts) {
    // A revised source is an owned correction or credit review, never a new
    // recognition of the same economic event.
    return {
      target: "OwnedCorrectionReview",
      ruleId: undefined,
      ruleVersion: undefined,
      missingFacts: [],
    };
  }

  if (!reviewedInput.invoiceEntityIsKnown) {
    return {
      target: "ReviewCase",
      missingFacts: ["legal_supplier_identity"],
      failure: "unknown_entity",
    };
  }

  if (child.documentClass === "domestic_credit_note") {
    const selected = selectRule(child, rules, "SupplierCredit");

    return selected.failure === undefined
      ? { ...selected, target: "OwnedCorrectionReview" }
      : selected;
  }

  const selected = selectRule(child, rules, "SupplierRecognition");

  if (selected.failure !== undefined) return selected;

  return { ...selected, target: "SupplierRecognition", missingFacts: [] };
}

/**
 * Rule selection. A rule is a candidate only when the invoicing entity, the
 * document class, the currency and the treatment all match exactly, and
 * exactly one candidate must remain. Zero candidates and two candidates are
 * both refusals: an ambiguous rule is never resolved by preferring the first.
 */
export function selectRule(
  child: WorkChild,
  rules: ReadonlyArray<PreparationRule>,
  operationFamily: "SupplierRecognition" | "OwnerPaidPurchase" | "SupplierCredit",
): RouteDecision {
  if (rules.length > periodWorkBoundary.maximumRules) {
    return {
      target: "ReviewCase",
      missingFacts: ["rule_population_exceeds_bound"],
      failure: "ambiguous_rule",
    };
  }

  const candidates = rules.filter(
    (rule) =>
      rule.operationFamily === operationFamily &&
      rule.supportedDocumentClass === child.documentClass &&
      rule.currency === child.currency &&
      rule.legalSupplierIdentity === child.legalSupplierIdentity &&
      rule.qualifiedTreatmentId === child.qualifiedTreatmentId,
  );

  const distinct = new Map<string, PreparationRule>();

  for (const rule of candidates) distinct.set(`${rule.id}@${rule.version}`, rule);

  if (distinct.size === 0) {
    return {
      target: "ReviewCase",
      missingFacts: [
        `no_active_rule_for:${child.documentClass}:${child.currency}:${operationFamily}`,
      ],
      failure: "unsupported_document_class",
    };
  }

  if (distinct.size > 1) {
    return {
      target: "ReviewCase",
      missingFacts: [...distinct.keys()].sort(code).map((key) => `ambiguous_rule:${key}`),
      failure: "ambiguous_rule",
    };
  }

  const rule = [...distinct.values()][0];

  if (rule === undefined) {
    return {
      target: "ReviewCase",
      missingFacts: ["rule_population_empty"],
      failure: "ambiguous_rule",
    };
  }

  const missing = rule.acceptedEvidenceRequirements.filter(
    (id) => !child.evidenceIds?.includes(id),
  );

  if (missing.length > 0)
    return { target: "ReviewCase", missingFacts: missing, failure: "missing_evidence" };

  return {
    target: "ReviewCase",
    ruleId: rule.id,
    ruleVersion: rule.version,
    missingFacts: [],
  };
}

/**
 * The next child state implied by a decision and the child's own recorded
 * state. A child that is already terminal never moves again, so a redelivered
 * queue message cannot reopen a committed child.
 */
export function nextChildState(
  current: WorkChildState,
  decision: RouteDecision,
  predecessorCommitted: boolean,
): WorkChildState {
  if (
    current === "prepared" ||
    current === "recovered" ||
    current === "committed" ||
    current === "refused"
  ) {
    return current;
  }

  if (decision.failure !== undefined) return "needs_review";

  if (!predecessorCommitted) return "waiting_predecessor";

  if (decision.target === "ReviewCase") return "needs_review";

  return "pending";
}

/**
 * The deterministic member order of an approval batch. Ordering is by owner,
 * then plan identity, so the same selection always seals the same digest and a
 * human gesture covers exactly the members shown.
 */
export function orderBatchMembers(members: ReadonlyArray<BatchMember>): ReadonlyArray<BatchMember> {
  return [...members].sort((left, right) => {
    const byOwner = code(left.owner, right.owner);

    if (byOwner !== 0) return byOwner;

    const byPlan = code(left.planId, right.planId);

    if (byPlan !== 0) return byPlan;

    return code(left.workIdentity, right.workIdentity);
  });
}

/**
 * The combined informational total shown beside a batch. It is a sum of exact
 * minor units as bigint and is returned as a decimal string. It is never a
 * journal line, never a balancing figure and never a rounded amount.
 */
export function combinedInformationalMinor(
  members: ReadonlyArray<{ readonly amountMinor: string }>,
): string {
  let total = 0n;

  for (const member of members) total += BigInt(member.amountMinor);

  return total.toString();
}

/**
 * The child state counts an operator reads. Prepared, committed, blocked and
 * unresolved are distinct, and a run whose children are all visited is not a
 * reconciled period.
 */
export function countChildStates(states: ReadonlyArray<WorkChildState>) {
  const counts = {
    pending: 0,
    waitingPredecessor: 0,
    needsReview: 0,
    prepared: 0,
    recovered: 0,
    committed: 0,
    refused: 0,
    visited: 0,
    total: states.length,
  };

  for (const state of states) {
    if (state === "pending") counts.pending += 1;

    if (state === "waiting_predecessor") counts.waitingPredecessor += 1;

    if (state === "needs_review") counts.needsReview += 1;

    if (state === "prepared") counts.prepared += 1;

    if (state === "recovered") counts.recovered += 1;

    if (state === "committed") counts.committed += 1;

    if (state === "refused") counts.refused += 1;

    if (state !== "pending") counts.visited += 1;
  }

  return ChildStateCounts.make(counts);
}

// The counts an operator reads. Prepared, committed, blocked and unresolved stay
// distinct on purpose, and `visited` is deliberately not `total`.
export type ChildStateCounts = typeof ChildStateCounts.Type;

export const ChildStateCounts = Schema.Struct({
  pending: Schema.Int,
  waitingPredecessor: Schema.Int,
  needsReview: Schema.Int,
  prepared: Schema.Int,
  recovered: Schema.Int,
  committed: Schema.Int,
  refused: Schema.Int,
  visited: Schema.Int,
  total: Schema.Int,
});

export const periodWorkDescription = Description;
