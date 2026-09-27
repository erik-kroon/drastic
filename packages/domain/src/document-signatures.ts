import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Digest, Identifier } from "./values";
import { MinorUnits } from "./money";

// Pure signature math for one document and purpose.
// NEXT-47 leaf: purpose-bound signature evidence over an exact content
// manifest. Ordinary login or accounting approval is never a document
// signature; authority for one purpose never satisfies another; a
// signature covers exactly the bytes it was made over. Technical
// validity and usage eligibility are evaluated independently: a role
// change can retire future use without erasing history. The application
// owns intent persistence, provider calls outside transactions and
// receipt retention; a selected signing adapter owns the qualified
// protocol bytes, which this design does not invent.

export const SignatureFailureCode = Schema.Literals([
  "ContentNotImmutable",
  "ValidationMissing",
  "SignerRoleUnqualified",
  "DisplayMismatch",
  "AuthenticationOnlyProfile",
  "PurposeMismatch",
  "OrderRefMismatch",
  "EnvironmentMismatch",
  "DigestMismatch",
  "SignerMismatch",
  "ChainUnverified",
  "DuplicateEvidence",
  "IncompleteSignerSet",
  "UnknownStartAttempt",
]);

export type SignatureFailureCode = typeof SignatureFailureCode.Type;

export const SignatureFailure = Schema.Struct({
  code: SignatureFailureCode,
  message: Description,
});

export type SignatureFailure = typeof SignatureFailure.Type;

export type Checked<A> = Result.Result<A, SignatureFailure>;

function fail(code: SignatureFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

export const SignaturePurpose = Schema.Literals([
  "annual_report_signing",
  "plan_approval",
  "copy_certification",
]);

export type SignaturePurpose = typeof SignaturePurpose.Type;

export const RequiredSigner = Schema.Struct({
  signerId: Identifier,
  role: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
});

export type RequiredSigner = typeof RequiredSigner.Type;

export const SignatureManifest = Schema.Struct({
  manifestId: Identifier,
  bookId: Identifier,
  legalEntityRevision: Identifier,
  purpose: SignaturePurpose,
  modelDigest: Digest,
  artifactDigest: Digest,
  artifactLength: MinorUnits,
  displayRepresentationDigest: Digest,
  requiredSigners: Schema.Array(RequiredSigner).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(20),
  ),
  policyRelease: Identifier,
});

export type SignatureManifest = typeof SignatureManifest.Type;

export const SignatureIntent = Schema.Struct({
  intentId: Identifier,
  manifestId: Identifier,
  manifestDigest: Digest,
  expectedSigner: Identifier,
  purpose: SignaturePurpose,
  consentTextHash: Digest,
  providerEnvironment: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  requestDigest: Digest,
});

export type SignatureIntent = typeof SignatureIntent.Type;

export const PrepareIntentInput = Schema.Struct({
  intentId: Identifier,
  manifest: SignatureManifest,
  contentImmutable: Schema.Boolean,
  requiredValidationDone: Schema.Boolean,
  expectedSigner: Identifier,
  signerRoleQualified: Schema.Boolean,
  displayAgreesWithManifest: Schema.Boolean,
  consentTextHash: Digest,
  providerEnvironment: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  signingProfile: Schema.Literals(["qualified_signature", "authentication_only"]),
  requestDigest: Digest,
});

export type PrepareIntentInput = typeof PrepareIntentInput.Type;

// Freezes one intent over the exact manifest. Login-strength profiles
// never qualify; the displayed consent must agree with the manifest, and
// the signer role must come from reviewed governance facts.
export function prepareSignatureIntent(input: PrepareIntentInput): Checked<SignatureIntent> {
  if (!input.contentImmutable) {
    return fail("ContentNotImmutable", "Only immutable selected content can be signed.");
  }

  if (!input.requiredValidationDone) {
    return fail("ValidationMissing", "Required document validation precedes signing.");
  }

  if (!input.signerRoleQualified) {
    return fail(
      "SignerRoleUnqualified",
      "The signer role is not established by reviewed governance facts.",
    );
  }

  if (!input.displayAgreesWithManifest) {
    return fail(
      "DisplayMismatch",
      "The rendered content shown to the signer disagrees with the manifest.",
    );
  }

  if (input.signingProfile !== "qualified_signature") {
    return fail(
      "AuthenticationOnlyProfile",
      "An authentication-only login is not document signature evidence.",
    );
  }

  return Result.succeed({
    intentId: input.intentId,
    manifestId: input.manifest.manifestId,
    manifestDigest: input.manifest.artifactDigest,
    expectedSigner: input.expectedSigner,
    purpose: input.manifest.purpose,
    consentTextHash: input.consentTextHash,
    providerEnvironment: input.providerEnvironment,
    requestDigest: input.requestDigest,
  });
}

export const ProviderCompletion = Schema.Struct({
  orderRef: Identifier,
  expectedOrderRef: Identifier,
  environment: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  expectedEnvironment: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  signedDigest: Digest,
  actualSigner: Identifier,
  chainVerified: Schema.Boolean,
  statusOk: Schema.Boolean,
});

export type ProviderCompletion = typeof ProviderCompletion.Type;

export const SignatureEvidence = Schema.Struct({
  evidenceId: Identifier,
  intentId: Identifier,
  providerOrderRef: Identifier,
  signedPayloadDigest: Digest,
  actualSigner: Identifier,
  technicalResult: Schema.Literals(["valid", "invalid"]),
  usageEligibility: Schema.Literals(["eligible", "ineligible"]),
  purpose: SignaturePurpose,
});

export type SignatureEvidence = typeof SignatureEvidence.Type;

export const CompleteSignatureInput = Schema.Struct({
  evidenceId: Identifier,
  intent: SignatureIntent,
  completion: ProviderCompletion,
  retainedEvidence: Schema.Array(SignatureEvidence),
  signerPermittedNow: Schema.Boolean,
});

export type CompleteSignatureInput = typeof CompleteSignatureInput.Type;

// Completes one signature from an authentic provider result. The order
// reference, environment, signed digest and signer must all agree with
// the intent; a replay returns the retained record. Technical validity
// is recorded independently from current usage eligibility, so a later
// revocation retires future use while history stands.
export function completeSignature(input: CompleteSignatureInput): Checked<SignatureEvidence> {
  for (const evidence of input.retainedEvidence) {
    if (evidence.providerOrderRef === input.completion.orderRef) {
      return Result.succeed(evidence);
    }
  }

  if (input.completion.orderRef !== input.completion.expectedOrderRef) {
    return fail("OrderRefMismatch", "The returned order does not match the original attempt.");
  }

  if (input.completion.environment !== input.completion.expectedEnvironment) {
    return fail("EnvironmentMismatch", "The provider environment disagrees with the intent.");
  }

  if (!input.completion.chainVerified || !input.completion.statusOk) {
    return fail("ChainUnverified", "The signature chain and status do not verify.");
  }

  if (input.completion.signedDigest !== input.intent.manifestDigest) {
    return fail("DigestMismatch", "The signed digest is not the exact manifest digest.");
  }

  if (input.completion.actualSigner !== input.intent.expectedSigner) {
    return fail("SignerMismatch", "The actual signer is not the intended permitted signer.");
  }

  return Result.succeed({
    evidenceId: input.evidenceId,
    intentId: input.intent.intentId,
    providerOrderRef: input.completion.orderRef,
    signedPayloadDigest: input.completion.signedDigest,
    actualSigner: input.completion.actualSigner,
    technicalResult: "valid",
    usageEligibility: input.signerPermittedNow ? "eligible" : "ineligible",
    purpose: input.intent.purpose,
  });
}

export const SignerSetInput = Schema.Struct({
  manifest: SignatureManifest,
  evidence: Schema.Array(SignatureEvidence),
});

export type SignerSetInput = typeof SignerSetInput.Type;

// Completion needs exactly the required signer set under the governance
// policy: distinct coverage per required role, never a bare count. A
// duplicate signature never substitutes for another required role, and
// evidence for another purpose never counts.
export function assertSignerSetComplete(
  input: SignerSetInput,
): Checked<ReadonlyArray<typeof Identifier.Type>> {
  const covered = new Set<string>();

  for (const evidence of input.evidence) {
    if (evidence.technicalResult !== "valid") continue;

    if (evidence.purpose !== input.manifest.purpose) continue;

    const required = input.manifest.requiredSigners.find(
      (signer) => signer.signerId === evidence.actualSigner,
    );

    if (required !== undefined) covered.add(`${required.signerId}\u0000${required.role}`);
  }

  const missing = input.manifest.requiredSigners.filter(
    (signer) => !covered.has(`${signer.signerId}\u0000${signer.role}`),
  );

  if (missing.length > 0) {
    return fail(
      "IncompleteSignerSet",
      "The required signer set is not covered by distinct valid signatures.",
    );
  }

  return Result.succeed(input.manifest.requiredSigners.map((signer) => signer.signerId));
}

export const StartAttemptOutcome = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("started"), orderRef: Identifier }),
  Schema.Struct({ kind: Schema.Literal("unknown_attempt"), orderRef: Schema.NullOr(Identifier) }),
]);

export type StartAttemptOutcome = typeof StartAttemptOutcome.Type;

export const StartAttemptInput = Schema.Struct({
  intent: SignatureIntent,
  responseLost: Schema.Boolean,
  returnedOrderRef: Schema.NullOr(Identifier),
  safeLookupAvailable: Schema.Boolean,
});

export type StartAttemptInput = typeof StartAttemptInput.Type;

// A lost start response without a safe provider lookup stays an unknown
// attempt. No second order starts merely because a local lease expired;
// the pending order is collected or cancelled through its actual
// contract.
export function recordStartAttempt(input: StartAttemptInput): Checked<StartAttemptOutcome> {
  if (!input.responseLost && input.returnedOrderRef !== null) {
    return Result.succeed({ kind: "started", orderRef: input.returnedOrderRef });
  }

  if (input.responseLost && !input.safeLookupAvailable) {
    return Result.succeed({ kind: "unknown_attempt", orderRef: null });
  }

  if (input.returnedOrderRef !== null) {
    return Result.succeed({ kind: "started", orderRef: input.returnedOrderRef });
  }

  return fail(
    "UnknownStartAttempt",
    "The start outcome cannot be established without a safe lookup.",
  );
}
