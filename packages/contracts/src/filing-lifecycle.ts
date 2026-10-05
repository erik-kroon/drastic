import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup, HttpApi } from "effect/http-api";
import * as A from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { SubmissionState } from "@open-erp/domain/filing-lifecycle";
import { RecordFields, ExactDocumentCommand, FixtureVerificationKey } from "./document-signatures";

export const CaptureAdoption = Schema.Struct({
  manifestId: A.Identifier,
  evidenceId: A.Identifier,
  adoptedOn: A.AccountingDate,
});

export const AdoptionRecord = Schema.Struct({
  ...RecordFields,
  manifestId: A.Identifier,
  manifestDigest: A.Digest,
  fiscalYearId: A.Identifier,
  evidenceId: A.Identifier,
  evidenceHash: A.Digest,
  adoptedOn: A.AccountingDate,
  creatorId: A.Identifier,
});

export const ReviewAdoption = Schema.Struct({ digest: A.Digest, reason: A.Description });

export const AdoptionReview = Schema.Struct({
  ...RecordFields,
  adoptionId: A.Identifier,
  adoptionDigest: A.Digest,
  reviewerId: A.Identifier,
  reason: A.Description,
});

export const PrepareFiling = Schema.Struct({
  manifestId: A.Identifier,
  copyArtifactId: A.Identifier,
  copyValidationId: A.Identifier,
  adoptionId: A.Identifier,
  governanceId: A.Identifier,
  certifierId: A.Identifier,
  requiredOutcome: Schema.Literals(["received", "registered"]),
  predecessorIntentId: Schema.NullOr(A.Identifier),
});

export const FilingIntent = Schema.Struct({
  ...RecordFields,
  input: PrepareFiling,
  manifestDigest: A.Digest,
  copyArtifactHash: A.Digest,
  copyArtifactLength: A.MinorUnits,
  copyValidationDigest: A.Digest,
  modelDigest: A.Digest,
  presentationDigest: A.Digest,
  fiscalYearId: A.Identifier,
  governanceDigest: A.Digest,
  adoptionDate: A.AccountingDate,
  adoptionId: A.Identifier,
  adoptionDigest: A.Digest,
  certifierId: A.Identifier,
  environment: Schema.Literal("synthetic-loopback"),
  providerProfile: Schema.Literal("synthetic-filing-v1"),
  correlation: A.Identifier,
  signatureEvidenceIds: Schema.Array(A.Identifier),
});

export const FilingAuthorization = Schema.Struct({
  ...RecordFields,
  intentId: A.Identifier,
  intentDigest: A.Digest,
  actorId: A.Identifier,
  expiresAt: Schema.String,
});

export const FilingAttempt = Schema.Struct({
  ...RecordFields,
  intentId: A.Identifier,
  intentDigest: A.Digest,
  authorizationId: A.Identifier,
  correlation: A.Identifier,
});

export const FilingProviderReceipt = Schema.Struct({
  profile: Schema.Literal("synthetic-filing-v1"),
  entityId: A.Identifier,
  fiscalYearId: A.Identifier,
  artifactHash: A.Digest,
  intentId: A.Identifier,
  attemptId: A.Identifier,
  correlation: A.Identifier,
  environment: Schema.String,
  status: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  receiptId: A.Identifier,
});

export const FilingProviderResult = Schema.Struct({
  keyId: A.Identifier,
  payload: FilingProviderReceipt,
  signature: Schema.String.check(Schema.isMaxLength(1024)),
});

export const FilingObservation = Schema.Struct({
  ...RecordFields,
  intentId: A.Identifier,
  attemptId: A.Identifier,
  state: SubmissionState,
  provider: Schema.NullOr(FilingProviderResult),
  quarantined: Schema.Boolean,
  technicalVerified: Schema.Boolean,
  verificationKey: FixtureVerificationKey,
});

export const FilingView = Schema.Struct({
  intent: FilingIntent,
  authorization: Schema.NullOr(FilingAuthorization),
  attempt: Schema.NullOr(FilingAttempt),
  observations: Schema.Array(FilingObservation),
  state: SubmissionState,
  fulfilled: Schema.Boolean,
  eligibleNow: Schema.Boolean,
  qualification: Schema.Literal("synthetic_only"),
});

export const FilingHistory = Schema.Struct({
  scope: A.Scope,
  fiscalYearId: A.Identifier,
  items: Schema.Array(FilingView),
});

const path = "/v1/entities/:entityId/books/:bookId/filings";

const write = { params: A.Scope, headers: A.IdempotencyHeaders, error: accountingErrors };

const change = { ...write, params: A.ChangePath };

export const FilingLifecycleApi = HttpApiGroup.make("filingLifecycle")
  .add(
    HttpApiEndpoint.post("captureFilingAdoption", `${path}/adoptions`, {
      ...write,
      payload: CaptureAdoption,
      success: AdoptionRecord,
    }),
    HttpApiEndpoint.post("reviewFilingAdoption", `${path}/adoptions/:id/reviews`, {
      ...change,
      payload: ReviewAdoption,
      success: AdoptionReview,
    }),
    HttpApiEndpoint.post("retainFilingObservation", `${path}/intents/:id/retain`, {
      ...change,
      payload: ExactDocumentCommand,
      success: FilingView,
    }),
    HttpApiEndpoint.post("prepareFilingIntent", `${path}/intents`, {
      ...write,
      payload: PrepareFiling,
      success: FilingIntent,
    }),
    HttpApiEndpoint.post("authorizeFiling", `${path}/intents/:id/authorizations`, {
      ...change,
      payload: ExactDocumentCommand,
      success: FilingAuthorization,
    }),
    HttpApiEndpoint.post("uploadFiling", `${path}/intents/:id/upload`, {
      ...change,
      payload: ExactDocumentCommand,
      success: FilingView,
    }),
    HttpApiEndpoint.post("certifyFiling", `${path}/intents/:id/certify`, {
      ...change,
      payload: ExactDocumentCommand,
      success: FilingView,
    }),
    HttpApiEndpoint.post("collectFiling", `${path}/intents/:id/collect`, {
      ...change,
      payload: ExactDocumentCommand,
      success: FilingView,
    }),
    HttpApiEndpoint.get("getFiling", `${path}/intents/:id`, {
      params: A.ChangePath,
      success: FilingView,
      error: accountingErrors,
    }),
    HttpApiEndpoint.get("filingHistory", `${path}/years/:id/history`, {
      params: A.ChangePath,
      success: FilingHistory,
      error: accountingErrors,
    }),
  )
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" });

export const FilingCapabilities = {
  filings_get_submission: {
    description:
      "Read retained synthetic filing observations. Uploaded, certified, received and registered remain distinct. No actual authority acceptance.",
    input: Schema.Struct({ scope: A.Scope, id: A.Identifier }),
    output: FilingView,
    readOnly: true,
  },
  filings_submission_history: {
    description:
      "Read synthetic fiscal-year filing history with retained original attempts and corrected predecessor links.",
    input: Schema.Struct({ scope: A.Scope, id: A.Identifier }),
    output: FilingHistory,
    readOnly: true,
  },
};
