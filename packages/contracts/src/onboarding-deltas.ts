import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as A from "./accounting";
import * as Sie from "./sie-import";
import { accountingErrors } from "./accounting-errors";

export const CompareOnboardingDelta = Schema.Struct({ candidatePreviewId: A.Identifier, expectedPreviewDigest: A.Digest });

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

export const OnboardingDeltaView = Schema.Struct({
  delta: OnboardingDelta,
  decisions: Schema.Array(OnboardingDeltaDecision),
  current: Schema.Boolean,
  blockers: Schema.Array(Schema.String),
});

const base = "/v1/entities/:entityId/books/:bookId/onboarding";
const scoped = { params: A.Scope, error: accountingErrors };
const mutation = { ...scoped, headers: A.IdempotencyHeaders };

export const OnboardingDeltasApi = HttpApiGroup.make("onboardingDeltas")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiEndpoint.post("compareOnboardingDelta", `${base}/source-deltas`, { ...mutation, payload: CompareOnboardingDelta, success: OnboardingDelta }),
    HttpApiEndpoint.get("getOnboardingDelta", `${base}/source-deltas/:id`, { params: A.ChangePath, error: accountingErrors, success: OnboardingDeltaView }),
    HttpApiEndpoint.post("decideOnboardingDelta", `${base}/source-delta-decisions`, { ...mutation, payload: DecideOnboardingDelta, success: OnboardingDeltaDecision }),
  );
