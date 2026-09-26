import type * as Deadlines from "@open-erp/contracts/deadlines";
import type * as Impact from "@open-erp/contracts/rule-impact";

type Reference = typeof Deadlines.FulfillmentReference.Type;

type OutcomeKind = typeof Deadlines.OutcomeKind.Type;

type Environment = typeof Deadlines.FulfillmentEnvironment.Type;

type Witness = typeof Deadlines.FulfillmentWitness.Type;

type Verification = typeof Deadlines.FulfillmentVerification.Type;

type ChangeKind = typeof Impact.RuleChangeKind.Type;

type ImpactKind = typeof Impact.ImpactKind.Type;

type DecisionKind = typeof Impact.ImpactDecisionKind.Type;

type ExecutionState = typeof Impact.ImpactTarget.Type.executionState;

export type ImpactClassification = {
  readonly impactKind: ImpactKind;
  readonly decision: DecisionKind;
};

export function unattestedWitness(): Witness {
  return {
    owner: null,
    outcomeConfirmed: false,
    periodConfirmed: false,
    familyConfirmed: false,
    revisionConfirmed: false,
    environmentConfirmed: false,
    digestConfirmed: false,
    observedPeriodId: null,
    observedFamily: null,
    observedRevision: null,
    limitations: [],
  };
}

// An owner that cannot confirm a requirement leaves the obligation unfulfilled
// with a precise reason. It never receives a pass for what it does not attest.
export function openWitness(reason: string): Verification {
  return { state: "pending", reason, witness: unattestedWitness() };
}

export function verification(
  state: Verification["state"],
  reason: string,
  witness: Witness,
): Verification {
  return { state, reason, witness };
}

// The canonical identity a resolved reference is recorded under. Two links of the
// same reference to the same obligation converge instead of duplicating.
export function referenceIdentity(reference: Reference) {
  if (reference.kind === "local_prepared_artifact") {
    return `${reference.owner}:${reference.artifactId}@${reference.digest}`;
  }

  if (reference.kind === "submitted_attempt") {
    return `${reference.owner}:${reference.attemptId}@${reference.digest}`;
  }

  if (reference.kind === "authority_outcome") {
    return `authority_outcome:${reference.observationId}@${reference.receiptIdentity}`;
  }

  return `reviewed_external_evidence:${reference.originalRef}@${reference.reviewer}`;
}

// The exact required-outcome predicate. A higher outcome never stands in for a
// lower one, and a lower one never stands in for a higher one.
export function outcomePredicateSatisfied(required: OutcomeKind, reference: Reference) {
  if (required === "prepared") return reference.kind === "local_prepared_artifact";

  if (required === "submitted") return reference.kind === "submitted_attempt";

  return reference.kind === "authority_outcome";
}

export function environmentMatches(required: Environment, reference: Reference) {
  return required === reference.environment;
}

// A future-only rule change does not reach a prior period, and a retroactive
// correction reaches a period without rewriting the report already produced.
export function intersects(startsOn: string, endsOn: string, from: string, to: string | null) {
  return endsOn >= from && (to === null || startsOn <= to);
}

// The bounded impact classification. It reads captured rows and starts no
// runtime, and missing old facts are never reported as unaffected.
export function classifyImpact(input: {
  readonly changeKind: ChangeKind;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly periodStartsOn: string;
  readonly periodEndsOn: string;
  readonly executionState: ExecutionState;
}): ImpactClassification {
  const changed = changedKind(input.changeKind);

  if (
    !intersects(input.periodStartsOn, input.periodEndsOn, input.effectiveFrom, input.effectiveTo)
  ) {
    return { impactKind: "outside_effective_scope", decision: "unaffected_with_reason" };
  }

  return { impactKind: changed, decision: decide(changed, input.executionState) };
}

export function undetermined(): ImpactClassification {
  return { impactKind: "undetermined", decision: "human_review" };
}

function changedKind(changeKind: ChangeKind): ImpactKind {
  if (changeKind === "applicability") return "applicability_changed";

  if (changeKind === "calculation") return "calculation_changed";

  return "schedule_changed";
}

function decide(changeKind: ImpactKind, state: ExecutionState): DecisionKind {
  if (state === "activation_effective") return "human_review";

  if (state === "not_recorded" || state === "activation_pending") return "reprepare";

  if (state === "recorded_prepared") return "reprepare";

  if (state === "recorded_submitted") return "human_review";

  if (changeKind === "schedule_changed") return "reprepare";

  return "amend";
}
