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
  legalSupplierIdentity: Schema.Boolean,
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

export const RouteFailure = Schema.Literals([
  "ambiguous_rule",
  "unknown_entity",
  "unsupported_document_class",
  "currency_not_qualified",
  "missing_evidence",
  "rule_changed_since_selection",
  "unmatched_source",
]);

export const RouteDecision = Schema.Struct({
  target: RouteTarget,
  // Present only for existing_obligation_settlement. The owning settlement
  // operation is dispatched to; this router never posts a settlement itself.
  settlementOwner: Schema.optional(
    Schema.Literals(["purchases.settlement", "banking.settlement", "owner.operations"]),
  ),
  existingRecognitionId: Schema.optional(Identifier),
  ruleId: Schema.optional(Identifier),
  ruleVersion: Schema.optional(Schema.Int),
  // Exact missing facts, named. Never a boolean "insufficient evidence".
  missingFacts: Schema.Array(Schema.String),
  failure: Schema.optional(RouteFailure),
});

export type RouteDecision = typeof RouteDecision.Type;

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
  sourceMinor: MinorUnits,
  // True when the child came from a bank or owner payment rather than a
  // document. A bank row is never turned into a new purchase identity.
  isPaymentObservation: Schema.Boolean,
  existingRecognition: Schema.optional(ExistingRecognition),
  existingMatches: Schema.Array(ExistingMatch),
  // A child whose financial effect depends on an earlier child. A dependent
  // child cannot enter a preapproved batch before its predecessor commits.
  dependsOn: Schema.Array(WorkIdentity),
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

export const PeriodWorkManifest = Schema.Struct({
  scope: Scope,
  requestedInterval: Schema.Struct({
    startsOn: AccountingDate,
    endsOn: AccountingDate,
  }),
  cutoff: AccountingDate,
  sourceCoverage: SourceCoverage,
  children: Schema.Array(WorkChild),
  digest: Digest,
});

export type PeriodWorkManifest = typeof PeriodWorkManifest.Type;

// The explicit fixed manifest a human approves. It is a list of already sealed
// member plans, never a rule that admits a future arrival.
export const BatchMember = Schema.Struct({
  owner: Schema.Literals([
    "purchases.recognition",
    "purchases.credits",
    "owner.operations",
    "commerce.invoice",
  ]),
  planId: Identifier,
  planDigest: Digest,
  inputIdentity: Schema.String,
  workIdentity: WorkIdentity,
});

export type BatchMember = typeof BatchMember.Type;

export const ApprovalBatch = Schema.Struct({
  scope: Scope,
  members: Schema.Array(BatchMember).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  // Informational only. The combined total is shown for the human and is never
  // a journal line and never a balancing figure.
  combinedInformationalMinor: SignedMinorUnits,
  digest: Digest,
});

export type ApprovalBatch = typeof ApprovalBatch.Type;

export const periodWorkBoundary = {
  maximumChildren: 500,
  maximumExcluded: 200,
  maximumRules: 64,
  maximumMatchesPerChild: 32,
  maximumDependencies: 16,
} as const;

const code = (left: string, right: string): 0 | 1 | -1 =>
  left < right ? -1 : left > right ? 1 : 0;

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

    if (recognition === undefined || !reviewedInput.committedPurchaseExists) {
      return {
        target: "ReviewCase",
        missingFacts: [
          recognition === undefined
            ? "payment_observation_without_matching_recognition"
            : "payment_observation_without_committed_purchase",
        ],
        failure: "unmatched_source",
      };
    }

    return {
      target: "existing_obligation_settlement",
      settlementOwner:
        recognition.owner === "owner.operations" ? "owner.operations" : "purchases.settlement",
      existingRecognitionId: recognition.recognitionId,
      missingFacts: [],
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
      rule.currency === child.currency,
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
export function countChildStates(states: ReadonlyArray<WorkChildState>): {
  readonly pending: number;
  readonly waitingPredecessor: number;
  readonly needsReview: number;
  readonly prepared: number;
  readonly recovered: number;
  readonly committed: number;
  readonly refused: number;
  readonly visited: number;
  readonly total: number;
} {
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

  return counts;
}

export const periodWorkDescription = Description;
