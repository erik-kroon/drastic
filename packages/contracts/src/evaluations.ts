import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as A from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CompanyProfile, RecordClass } from "./company-profiles";
import { SourceOccurrence } from "./source-intake";
import { CommandReceipt } from "./commerce";

const UnknownCoverage = Schema.Struct({ status: Schema.Literal("unknown"), reason: A.Description });

const Predecessor = Schema.Struct({ id: A.Identifier, digest: A.Digest });

const Assistance = Schema.Literals([
  "original_fact_clarification",
  "evidence_completion",
  "required_human_approval",
]);

export const CaptureEvaluationContract = Schema.Struct({
  recordClass: RecordClass,
  interval: Schema.Struct({ startsOn: A.AccountingDate, endsOn: A.AccountingDate }).check(
    Schema.makeFilter(
      (range) => range.startsOn <= range.endsOn || "Interval ends before its start.",
    ),
  ),
  originalIds: Schema.Array(A.Identifier).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  openingBasis: UnknownCoverage,
  familyPopulation: UnknownCoverage,
  permittedAssistance: Schema.Array(Assistance).check(Schema.isMaxLength(3)),
  allowedCapabilities: Schema.Array(A.Identifier).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(100),
  ),
  predecessor: Schema.NullOr(Predecessor),
});

export const EvaluationContract = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  state: Schema.Literal("contract_only"),
  recordClass: RecordClass,
  interval: CaptureEvaluationContract.fields.interval,
  originals: Schema.Array(SourceOccurrence).check(Schema.isMaxLength(100)),
  profile: CompanyProfile,
  openingBasis: UnknownCoverage,
  familyPopulation: UnknownCoverage,
  permittedAssistance: CaptureEvaluationContract.fields.permittedAssistance,
  allowedCapabilities: CaptureEvaluationContract.fields.allowedCapabilities,
  capabilityPolicy: Schema.Literal("declared_not_enforced"),
  wholeYearComplete: Schema.Literal(false),
  predecessor: Schema.NullOr(Predecessor),
  createdBy: A.Identifier,
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: A.Digest,
});

const path = "/v1/entities/:entityId/books/:bookId/evaluations/contracts";

export const EvaluationsApi = HttpApiGroup.make("evaluations")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiEndpoint.post("captureEvaluationContract", path, {
      params: A.Scope,
      headers: A.IdempotencyHeaders,
      payload: CaptureEvaluationContract.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: EvaluationContract,
      error: accountingErrors,
    }),
    HttpApiEndpoint.get("getEvaluationContract", `${path}/:id`, {
      params: A.ChangePath,
      success: EvaluationContract,
      error: accountingErrors,
    }),
  );

export const EvaluationCapabilities = {
  evaluation_capture_contract: {
    description:
      "Capture an immutable incomplete evaluation input contract. Declared policy does not enforce candidate isolation or assistance limits.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      input: CaptureEvaluationContract,
    }),
    output: EvaluationContract,
    readOnly: false,
    agentCallable: false,
  },
  evaluation_get_contract: {
    description:
      "Rediscover an immutable evaluation contract through current operator authority. No candidate run, reference disclosure or freeze is available.",
    input: Schema.Struct({ scope: A.Scope, id: A.Identifier }),
    output: EvaluationContract,
    readOnly: true,
    agentCallable: false,
  },
};
