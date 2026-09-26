import * as Schema from "effect/Schema";
import { Identifier, Scope, IdempotencyHeaders } from "./accounting";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { accountingErrors } from "./accounting-errors";
import { FulfillmentEnvironment, RuleFamily, StatutoryBasis } from "./deadlines";

export const RuleChangeKind = Schema.Literals(["applicability", "calculation", "schedule"]);

// A rule change is a claim about a reviewed rule release. The notice is
// immutable: it states the corrected rule, not that a code version moved.
export const RecordRuleChangeNotice = Schema.Struct({
  oldReleaseId: Identifier,
  newReleaseId: Identifier,
  changeKind: RuleChangeKind,
  effectiveFrom: Schema.String,
  effectiveTo: Schema.optional(Schema.String),
  reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  qualificationEvidence: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000)),
  changedSelectors: Schema.Array(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
});

export const RuleChangeNotice = Schema.Struct({
  id: Identifier,
  scope: Scope,
  oldReleaseId: Identifier,
  newReleaseId: Identifier,
  oldReleaseChecksum: Schema.String,
  newReleaseChecksum: Schema.String,
  changeKind: RuleChangeKind,
  effectiveFrom: Schema.String,
  effectiveTo: Schema.NullOr(Schema.String),
  reason: Schema.String,
  qualificationEvidence: Schema.String,
  changedSelectors: Schema.Array(Schema.String),
  capturedBy: Identifier,
  capturedAt: Schema.String,
  digest: Schema.String,
});

export const RuleChangeNoticeList = Schema.Array(RuleChangeNotice);

export const TargetKind = Schema.Literals(["deadline_obligation", "company_activation"]);

export const ImpactKind = Schema.Literals([
  "outside_effective_scope",
  "applicability_changed",
  "calculation_changed",
  "schedule_changed",
  "undetermined",
]);

export const ImpactDecisionKind = Schema.Literals([
  "unaffected_with_reason",
  "reprepare",
  "amend",
  "human_review",
]);

// A target is one retained record that still names the superseded rule. Its
// revision and period interval are frozen with it.
export const ImpactTarget = Schema.Struct({
  ordinal: Schema.Int,
  targetKind: TargetKind,
  targetId: Identifier,
  targetRevision: Schema.String,
  family: RuleFamily,
  periodId: Schema.NullOr(Identifier),
  periodStartsOn: Schema.NullOr(Schema.String),
  periodEndsOn: Schema.NullOr(Schema.String),
  usedRule: Schema.String,
  basisDigest: Schema.String,
  impactKind: ImpactKind,
  // The execution state the classification reads. A committed artifact is never
  // reversed by a rule change; this only says what kind of review it needs.
  executionState: Schema.Literals([
    "not_recorded",
    "recorded_prepared",
    "recorded_submitted",
    "recorded_accepted",
    "activation_effective",
    "activation_pending",
  ]),
  suggestedDecision: ImpactDecisionKind,
  decisionKind: Schema.NullOr(ImpactDecisionKind),
  decisionReason: Schema.NullOr(Schema.String),
});

export const ImpactSnapshotHeader = Schema.Struct({
  id: Identifier,
  scope: Scope,
  noticeId: Identifier,
  recordedCutoff: Schema.String,
  completeTargetMembership: Schema.Boolean,
  totalTargets: Schema.Int,
  decidedTargets: Schema.Int,
  continuation: Schema.NullOr(Schema.String),
});

export const ImpactSnapshot = Schema.Struct({
  ...ImpactSnapshotHeader.fields,
  targets: Schema.Array(ImpactTarget),
});

export const ImpactSnapshotList = Schema.Array(ImpactSnapshotHeader);

// An amendment proposal is a qualified successor basis supplied by a reviewer.
// The application never computes the successor's due date.
export const ProposedSuccessor = Schema.Struct({
  periodId: Identifier,
  basis: StatutoryBasis,
  dueAt: Schema.String,
  requiredEnvironment: FulfillmentEnvironment,
  outcomeKind: Schema.Literals(["prepared", "submitted", "accepted"]),
  reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
});

export const RecordImpactDecision = Schema.Struct({
  targetKind: TargetKind,
  targetId: Identifier,
  targetRevision: Schema.String,
  decisionKind: ImpactDecisionKind,
  reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
  evidence: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  proposedSuccessor: Schema.optional(ProposedSuccessor),
});

export const ImpactDecision = Schema.Struct({
  id: Identifier,
  scope: Scope,
  snapshotId: Identifier,
  noticeId: Identifier,
  targetKind: TargetKind,
  targetId: Identifier,
  targetRevision: Schema.String,
  decisionKind: ImpactDecisionKind,
  reason: Schema.String,
  evidence: Schema.String,
  proposedSuccessor: Schema.NullOr(ProposedSuccessor),
  reviewer: Identifier,
  recordedAt: Schema.String,
  digest: Schema.String,
});

export const ImpactDecisionList = Schema.Array(ImpactDecision);

// A capture is an explicit partition. The operator names the reporting window;
// the application never widens it and never infers one.
export const CaptureRuleImpact = Schema.Struct({
  scope: Scope,
  idempotencyKey: Schema.String,
  noticeId: Identifier,
  periodFrom: Schema.String,
  periodTo: Schema.String,
});

export const RuleImpactCapabilities = {
  rules_list_change_notices: {
    description:
      "Read recorded rule-change notices for a book. A notice states a corrected rule release and its effective scope; it is not a claim that a deployment changed.",
    input: Schema.Struct({ scope: Scope }),
    output: RuleChangeNoticeList,
    readOnly: true,
  },
  rules_list_impact: {
    description:
      "Read the captured rule-change impact snapshots for a book with their frozen membership and how many targets are decided.",
    input: Schema.Struct({ scope: Scope }),
    output: ImpactSnapshotList,
    readOnly: true,
  },
  rules_get_impact_snapshot: {
    description:
      "Read one frozen impact snapshot page with each target's execution state, the classification and the decision recorded for it.",
    input: Schema.Struct({
      scope: Scope,
      snapshotId: Identifier,
      after: Schema.optional(Schema.String),
    }),
    output: ImpactSnapshot,
    readOnly: true,
  },
  rules_list_impact_decisions: {
    description:
      "Read the reviewed impact decisions of one rule-change notice, including any proposed successor basis for an amendment obligation.",
    input: Schema.Struct({ scope: Scope, noticeId: Identifier }),
    output: ImpactDecisionList,
    readOnly: true,
  },
};

const base = "/v1/entities/:entityId/books/:bookId/rule-impact";

const snapshotPath = Schema.Struct({ ...Scope.fields, snapshotId: Identifier });

const noticePath = Schema.Struct({ ...Scope.fields, noticeId: Identifier });

export const RuleImpactApi = HttpApiGroup.make("ruleImpact")
  .add(
    HttpApiEndpoint.get("listRuleChangeNotices", base, {
      params: Scope,
      success: RuleChangeNoticeList,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("recordRuleChangeNotice", `${base}/notices`, {
      params: Scope,
      headers: IdempotencyHeaders,
      payload: RecordRuleChangeNotice,
      success: RuleChangeNotice,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("captureRuleImpact", `${base}/notices/:noticeId/impact`, {
      params: noticePath,
      headers: IdempotencyHeaders,
      payload: Schema.Struct({ periodFrom: Schema.String, periodTo: Schema.String }),
      success: ImpactSnapshotHeader,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("listRuleImpact", `${base}/impact`, {
      params: Scope,
      success: ImpactSnapshotList,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getRuleImpactSnapshot", `${base}/impact/:snapshotId`, {
      params: snapshotPath,
      query: Schema.Struct({ after: Schema.optional(Schema.String) }),
      success: ImpactSnapshot,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("decideRuleImpact", `${base}/impact/:snapshotId/decisions`, {
      params: snapshotPath,
      headers: IdempotencyHeaders,
      payload: RecordImpactDecision,
      success: ImpactDecision,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("listRuleImpactDecisions", `${base}/notices/:noticeId/decisions`, {
      params: noticePath,
      success: ImpactDecisionList,
      error: accountingErrors,
    }),
  );
