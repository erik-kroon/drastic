import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as A from "./accounting";
import * as Sie from "./sie-import";
import { accountingErrors } from "./accounting-errors";

export const CompareOnboardingDelta = Schema.Struct({
  candidatePreviewId: A.Identifier,
  expectedPreviewDigest: A.Digest,
});

export const OnboardingDeltaRow = Schema.Struct({
  sourceReference: Schema.String,
  kind: Schema.Literals(["new", "changed", "removed", "unchanged"]),
  previous: Schema.NullOr(Sie.Voucher),
  candidate: Schema.NullOr(Sie.Voucher),
  originalVoucherId: Schema.NullOr(A.Identifier),
});

export const OnboardingDelta = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  candidatePreviewId: A.Identifier,
  candidatePreviewDigest: A.Digest,
  sourceSystem: Schema.String,
  sourceAccountId: Schema.String,
  baselineDigest: A.Digest,
  rows: Schema.Array(OnboardingDeltaRow),
  comparedBy: A.Identifier,
  comparedAt: Schema.String,
  digest: A.Digest,
});

export const DecideOnboardingDelta = Schema.Struct({
  deltaId: A.Identifier,
  expectedDigest: A.Digest,
  sourceReference: Schema.String,
  choice: Schema.Literals(["use_change", "keep_previous"]),
  reason: A.Description,
});

export const OnboardingDeltaDecision = Schema.Struct({
  ...DecideOnboardingDelta.fields,
  id: A.Identifier,
  scope: A.Scope,
  actorId: A.Identifier,
  decidedAt: Schema.String,
});

export const PrepareOnboardingDeltaEffect = Schema.Struct({
  deltaId: A.Identifier,
  expectedDeltaDigest: A.Digest,
  sourceReference: Schema.String,
  sourcePlanId: A.Identifier,
  expectedSourcePlanDigest: A.Digest,
  accountingPeriodId: A.Identifier,
  rationale: A.Description,
});

export const OnboardingDeltaProposal = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  deltaId: A.Identifier,
  deltaDigest: A.Digest,
  sourceReference: Schema.String,
  decisionId: A.Identifier,
  sourcePlanId: A.Identifier,
  sourcePlanDigest: A.Digest,
  changes: Schema.Array(A.ChangeSet).check(Schema.isMinLength(1), Schema.isMaxLength(2)),
  preparedBy: A.Identifier,
  preparedAt: Schema.String,
  digest: A.Digest,
});

export const ApproveOnboardingDeltaEffect = Schema.Struct({
  proposalId: A.Identifier,
  expectedDigest: A.Digest,
});

export const OnboardingDeltaApproval = Schema.Struct({
  proposalId: A.Identifier,
  approvals: Schema.Array(A.Approval).check(Schema.isMinLength(1), Schema.isMaxLength(2)),
});

export const ExecuteOnboardingDeltaEffect = Schema.Struct({
  ...ApproveOnboardingDeltaEffect.fields,
  approvalIds: Schema.Array(A.Identifier).check(Schema.isMinLength(1), Schema.isMaxLength(2)),
});

export const OnboardingDeltaEffect = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  deltaId: A.Identifier,
  proposalId: A.Identifier,
  sourceSystem: Schema.String,
  sourceAccountId: Schema.String,
  sourceReference: Schema.String,
  decisionId: A.Identifier,
  candidate: Schema.NullOr(Sie.Voucher),
  effectiveVoucherId: Schema.NullOr(A.Identifier),
  sourceDigest: A.Digest,
  sourceYear: Schema.String.check(Schema.isPattern(/^\d{4}$/)),
  executedSequence: A.AggregateMinorUnits,
  receipts: Schema.Array(A.ExecutionReceipt).check(Schema.isMinLength(1), Schema.isMaxLength(2)),
  executedBy: A.Identifier,
  executedAt: Schema.String,
  digest: A.Digest,
});

export const OnboardingDeltaProposalView = Schema.Struct({
  proposal: OnboardingDeltaProposal,
  approvals: Schema.Array(A.Approval),
  current: Schema.Boolean,
});

export const OnboardingDeltaView = Schema.Struct({
  delta: OnboardingDelta,
  decisions: Schema.Array(OnboardingDeltaDecision),
  proposals: Schema.Array(OnboardingDeltaProposal),
  effects: Schema.Array(OnboardingDeltaEffect),
  current: Schema.Boolean,
  blockers: Schema.Array(Schema.String),
});

export const OnboardingDeltaInventory = Schema.Struct({
  items: Schema.Array(OnboardingDelta),
  hasMore: Schema.Boolean,
});

const base = "/v1/entities/:entityId/books/:bookId/onboarding";

const scoped = { params: A.Scope, error: accountingErrors };

const mutation = { ...scoped, headers: A.IdempotencyHeaders };

export const OnboardingDeltasApi = HttpApiGroup.make("onboardingDeltas")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiEndpoint.post("compareOnboardingDelta", `${base}/source-deltas`, {
      ...mutation,
      payload: CompareOnboardingDelta,
      success: OnboardingDelta,
    }),
    HttpApiEndpoint.get("listOnboardingDeltas", `${base}/source-deltas`, {
      params: A.Scope,
      error: accountingErrors,
      success: OnboardingDeltaInventory,
    }),
    HttpApiEndpoint.get("getOnboardingDelta", `${base}/source-deltas/:id`, {
      params: A.ChangePath,
      error: accountingErrors,
      success: OnboardingDeltaView,
    }),
    HttpApiEndpoint.post("prepareOnboardingDeltaEffect", `${base}/source-delta-proposals`, {
      ...mutation,
      payload: PrepareOnboardingDeltaEffect,
      success: OnboardingDeltaProposal,
    }),
    HttpApiEndpoint.get("getOnboardingDeltaProposal", `${base}/source-delta-proposals/:id`, {
      params: A.ChangePath,
      error: accountingErrors,
      success: OnboardingDeltaProposalView,
    }),
    HttpApiEndpoint.post("approveOnboardingDeltaEffect", `${base}/source-delta-approvals`, {
      ...mutation,
      payload: ApproveOnboardingDeltaEffect,
      success: OnboardingDeltaApproval,
    }),
    HttpApiEndpoint.post("executeOnboardingDeltaEffect", `${base}/source-delta-effects`, {
      ...mutation,
      payload: ExecuteOnboardingDeltaEffect,
      success: OnboardingDeltaEffect,
    }),
    HttpApiEndpoint.post("decideOnboardingDelta", `${base}/source-delta-decisions`, {
      ...mutation,
      payload: DecideOnboardingDelta,
      success: OnboardingDeltaDecision,
    }),
  );
