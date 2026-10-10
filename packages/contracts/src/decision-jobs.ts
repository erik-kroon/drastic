import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as A from "./accounting";
import { accountingErrors } from "./accounting-errors";
import * as D from "@open-erp/domain/decisions";
import { DecisionResultView } from "./decisions";

export const DecisionPolicy = Schema.Struct({
  id: A.Identifier,
  mode: Schema.Literals(["off", "shadow"]),
  questionId: Schema.Literal("document_kind"),
  dataUse: Schema.Literal("synthetic_fixture_only"),
  modelRelease: Schema.String,
  requestedModel: Schema.String,
  expectedReportedModel: Schema.String,
  dispatchBudget: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10000 })),
});

export const AdmitDecisionRequest = Schema.Struct({
  questionId: Schema.Literal("document_kind"),
  subject: Schema.Struct({
    owner: Schema.Literal("supplier_draft"),
    id: A.Identifier,
    revision: Schema.String,
    digest: A.Digest,
  }),
});

export const FrozenDecisionRequest = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  subject: AdmitDecisionRequest.fields.subject,
  question: Schema.Struct({ id: A.Identifier, version: Schema.String, digest: A.Digest }),
  builders: Schema.Struct({
    state: Schema.String,
    options: Schema.String,
    precedent: Schema.String,
  }),
  originalCommitCutoff: A.MinorUnits,
  inputDigest: A.Digest,
  optionSetDigest: A.Digest,
  policy: DecisionPolicy,
  input: D.SystemOneRequest,
  digest: A.Digest,
});

export const StoredDecisionResult = Schema.Struct({
  ...DecisionResultView.fields,
  reportedModel: Schema.String,
  releaseQualification: Schema.Literal("unsubstantiated"),
  wireEvidence: Schema.Literals(["bounded_utf8_unique_keys", "already_parsed_object"]),
  requestDigest: A.Digest,
  digest: A.Digest,
});

export const DecisionRequestView = Schema.Struct({
  ...FrozenDecisionRequest.fields,
  status: Schema.Literals([
    "ready",
    "running",
    "validated",
    "failed",
    "stale",
    "skipped",
    "uncertain",
  ]),
  reason: Schema.NullOr(Schema.String),
  result: Schema.NullOr(StoredDecisionResult),
});

export const DecisionAdmission = Schema.Struct({
  status: Schema.Literals(["off", "admitted", "skipped"]),
  reason: Schema.NullOr(Schema.String),
  request: Schema.NullOr(DecisionRequestView),
});

const path = "/v1/entities/:entityId/books/:bookId/automation/decision-requests";

export const DecisionJobsApi = HttpApiGroup.make("decisionJobs")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiEndpoint.post("admitDecisionRequest", path, {
      params: A.Scope,
      headers: A.IdempotencyHeaders,
      payload: AdmitDecisionRequest,
      success: DecisionAdmission,
      error: accountingErrors,
    }),
    HttpApiEndpoint.get("getDecisionRequest", `${path}/:id`, {
      params: A.ChangePath,
      success: DecisionRequestView,
      error: accountingErrors,
    }),
    HttpApiEndpoint.post(
      "processDecisionRequest",
      "/v1/entities/:entityId/books/:bookId/internal/decision-requests/:id/process",
      { params: A.ChangePath, success: DecisionRequestView, error: accountingErrors },
    ),
  );
