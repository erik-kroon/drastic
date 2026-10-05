import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup, HttpApi } from "effect/http-api";
import * as A from "./accounting";
import * as Commerce from "./commerce";
import { accountingErrors } from "./accounting-errors";
import { SignaturePurpose, RequiredSigner } from "@open-erp/domain/document-signatures";

export const RecordFields = {
  id: A.Identifier,
  scope: A.Scope,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: A.Digest,
};

export const CaptureGovernance = Schema.Struct({
  legalEntityRevision: A.Identifier,
  fiscalYearId: A.Identifier,
  evidenceId: A.Identifier,
  requiredSigners: Schema.Array(RequiredSigner).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(20),
  ),
  certifierIds: Schema.Array(A.Identifier).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  supersedesId: Schema.NullOr(A.Identifier),
});

export const GovernanceRevision = Schema.Struct({
  ...RecordFields,
  input: CaptureGovernance,
  creatorId: A.Identifier,
  evidenceHash: A.Digest,
});

export const ReviewGovernance = Schema.Struct({
  digest: A.Digest,
  result: Schema.Literals(["confirmed", "revoked"]),
  reason: A.Description,
});

export const GovernanceReview = Schema.Struct({
  ...RecordFields,
  governanceId: A.Identifier,
  governanceDigest: A.Digest,
  reviewerId: A.Identifier,
  result: ReviewGovernance.fields.result,
  reason: A.Description,
});

export const ValidateDocument = Schema.Struct({ artifactId: A.Identifier });

export const DocumentValidation = Schema.Struct({
  ...RecordFields,
  artifactId: A.Identifier,
  artifactHash: A.Digest,
  artifactLength: A.MinorUnits,
  modelDigest: A.Digest,
  presentationDigest: A.Digest,
  extractedFactsDigest: A.Digest,
  profile: Schema.Literal("synthetic-xhtml-v1"),
  result: Schema.Literals(["passed", "failed"]),
  diagnostics: Schema.Array(A.Description),
});

export const PrepareDocumentManifest = Schema.Struct({
  artifactId: A.Identifier,
  validationId: A.Identifier,
  governanceId: A.Identifier,
  purpose: SignaturePurpose,
  consentText: A.Description,
  policyRelease: Schema.Literal("synthetic-signature-v1"),
});

export const DocumentManifest = Schema.Struct({
  ...RecordFields,
  artifactId: A.Identifier,
  finalId: A.Identifier,
  presentationId: A.Identifier,
  fiscalYearId: A.Identifier,
  legalEntityRevision: A.Identifier,
  purpose: SignaturePurpose,
  modelDigest: A.Digest,
  artifactHash: A.Digest,
  artifactLength: A.MinorUnits,
  presentationDigest: A.Digest,
  consentText: A.Description,
  consentTextHash: A.Digest,
  requiredSigners: Schema.Array(RequiredSigner),
  policyRelease: Schema.Literal("synthetic-signature-v1"),
  validationId: A.Identifier,
  validationDigest: A.Digest,
  governanceId: A.Identifier,
  governanceDigest: A.Digest,
  artifactRelations: Schema.Array(
    Schema.Struct({
      artifactId: A.Identifier,
      relationship: Schema.Literal("signed_original"),
      contentHash: A.Digest,
    }),
  ),
  environment: Schema.Literal("synthetic-loopback"),
});

export const PrepareSignatureIntent = Schema.Struct({
  manifestId: A.Identifier,
  signerId: A.Identifier,
});

export const DocumentSignatureIntent = Schema.Struct({
  ...RecordFields,
  manifestId: A.Identifier,
  manifestDigest: A.Digest,
  signerId: A.Identifier,
  purpose: SignaturePurpose,
  consentTextHash: A.Digest,
  correlation: A.Identifier,
  environment: Schema.Literal("synthetic-loopback"),
  expiresAt: Schema.String,
});

export const SignatureAttempt = Schema.Struct({
  ...RecordFields,
  intentId: A.Identifier,
  intentDigest: A.Digest,
  correlation: A.Identifier,
});

export const SignaturePayload = Schema.Struct({
  profile: Schema.Literal("synthetic-ed25519-v1"),
  intentId: A.Identifier,
  manifestDigest: A.Digest,
  signerId: A.Identifier,
  purpose: SignaturePurpose,
  consentTextHash: A.Digest,
  environment: Schema.String,
  correlation: A.Identifier,
  orderRef: A.Identifier,
});

export const SignatureProviderResult = Schema.Struct({
  status: Schema.Literals(["pending", "complete"]),
  keyId: A.Identifier,
  payload: SignaturePayload,
  signature: Schema.String.check(Schema.isMaxLength(1024)),
});

export const FixtureVerificationKey = Schema.Struct({
  algorithm: Schema.Literal("Ed25519"),
  keyId: A.Identifier,
  publicKey: Schema.String.check(Schema.isMinLength(44), Schema.isMaxLength(44)),
});

export const RetainedSignatureEvidence = Schema.Struct({
  ...RecordFields,
  intentId: A.Identifier,
  manifestId: A.Identifier,
  manifestDigest: A.Digest,
  attemptId: A.Identifier,
  provider: SignatureProviderResult,
  payloadHash: A.Digest,
  technicalResult: Schema.Literals(["valid", "invalid"]),
  usageEligibility: Schema.Literals(["eligible", "ineligible"]),
  verifierVersion: Schema.Literal("synthetic-ed25519-v1"),
  verificationKey: FixtureVerificationKey,
});

export const SignatureObservation = Schema.Struct({
  ...RecordFields,
  attemptId: A.Identifier,
  state: Schema.Literals(["start_unknown", "pending", "complete", "invalid"]),
  provider: Schema.NullOr(SignatureProviderResult),
});

export const SignatureIntentView = Schema.Struct({
  intent: DocumentSignatureIntent,
  attempt: Schema.NullOr(SignatureAttempt),
  evidence: Schema.NullOr(RetainedSignatureEvidence),
  observations: Schema.Array(SignatureObservation),
  state: Schema.Literals(["prepared", "start_unknown", "pending", "complete", "invalid"]),
  eligibleNow: Schema.Boolean,
});

export const SignatureManifestView = Schema.Struct({
  displayArtifact: Schema.Struct({
    artifactId: A.Identifier,
    xhtml: Schema.String,
    contentHash: A.Digest,
    sizeBytes: Schema.Int,
  }),
  manifest: DocumentManifest,
  signatures: Schema.Array(RetainedSignatureEvidence),
  missingSignerIds: Schema.Array(A.Identifier),
  complete: Schema.Boolean,
  governanceCurrent: Schema.Boolean,
});

export const ExactDocumentCommand = Schema.Struct({ digest: A.Digest });

const path = "/v1/entities/:entityId/books/:bookId/documents";

const write = { params: A.Scope, headers: A.IdempotencyHeaders, error: accountingErrors };

const change = { ...write, params: A.ChangePath };

export const DocumentSignaturesApi = HttpApiGroup.make("documentSignatures")
  .add(
    HttpApiEndpoint.post("captureDocumentGovernance", `${path}/governance`, {
      ...write,
      payload: CaptureGovernance,
      success: GovernanceRevision,
    }),
    HttpApiEndpoint.post("reviewDocumentGovernance", `${path}/governance/:id/reviews`, {
      ...change,
      payload: ReviewGovernance,
      success: GovernanceReview,
    }),
    HttpApiEndpoint.post("validateSignatureDocument", `${path}/validations`, {
      ...write,
      payload: ValidateDocument,
      success: DocumentValidation,
    }),
    HttpApiEndpoint.post("prepareDocumentManifest", `${path}/manifests`, {
      ...write,
      payload: PrepareDocumentManifest,
      success: DocumentManifest,
    }),
    HttpApiEndpoint.post("prepareDocumentSignature", `${path}/signature-intents`, {
      ...write,
      payload: PrepareSignatureIntent,
      success: DocumentSignatureIntent,
    }),
    HttpApiEndpoint.post("startDocumentSignature", `${path}/signature-intents/:id/start`, {
      ...change,
      payload: ExactDocumentCommand,
      success: SignatureIntentView,
    }),
    HttpApiEndpoint.post("collectDocumentSignature", `${path}/signature-intents/:id/collect`, {
      ...change,
      payload: ExactDocumentCommand,
      success: SignatureIntentView,
    }),
    HttpApiEndpoint.post("retainDocumentSignature", `${path}/signature-intents/:id/retain`, {
      ...change,
      payload: ExactDocumentCommand,
      success: SignatureIntentView,
    }),
    HttpApiEndpoint.get("getDocumentSignatureManifest", `${path}/manifests/:id`, {
      params: A.ChangePath,
      success: SignatureManifestView,
      error: accountingErrors,
    }),
    HttpApiEndpoint.get("getDocumentSignatureIntent", `${path}/signature-intents/:id`, {
      params: A.ChangePath,
      success: SignatureIntentView,
      error: accountingErrors,
    }),
  )
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" });

export const DocumentSignatureCapabilities = {
  documents_get_signature_manifest: {
    description:
      "Read exact synthetic document manifest and current distinct signer coverage. No BankID or legal qualification.",
    input: Schema.Struct({ scope: A.Scope, id: A.Identifier }),
    output: SignatureManifestView,
    readOnly: true,
  },
  documents_get_signature_intent: {
    description:
      "Read synthetic document signing intent, authentic cryptographic evidence and current eligibility.",
    input: Schema.Struct({ scope: A.Scope, id: A.Identifier }),
    output: SignatureIntentView,
    readOnly: true,
  },
};
