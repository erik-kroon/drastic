import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

// ADR 0020. Gestures that a book's authority policy can reserve to a person who
// proves presence with an enrolled authenticator. The application gesture table
// marks the same names.
export const PresenceGesture = Schema.Literals([
  "approve_payroll_settlement_instruction",
  "verify_employee_payee",
  "approve_claim_payment_file",
  "prepare_document_signature",
  "authorize_filing",
  "grant_posting_mandate",
]);

const Base64Url = (maximum: number) =>
  Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]+$/), Schema.isMaxLength(maximum));

const Ticket = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{32,128}$/));

// The exact request the gesture will receive. The guarded operation rebuilds
// this subject from its own command, so a proof for one request cannot approve
// another: the idempotency key, resource identifier and full input all count.
export const PresenceSubject = Schema.Struct({
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
  id: Schema.NullOr(Accounting.Identifier),
  input: Schema.Json,
});

export const RegistrationResponse = Schema.Struct({
  id: Base64Url(1366),
  rawId: Base64Url(1366),
  type: Schema.Literal("public-key"),
  response: Schema.Struct({
    clientDataJSON: Base64Url(8192),
    attestationObject: Base64Url(65536),
    transports: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(8))),
  }),
  clientExtensionResults: Schema.Struct({}),
  authenticatorAttachment: Schema.optional(Schema.Literals(["platform", "cross-platform"])),
});

export const AuthenticationResponse = Schema.Struct({
  id: Base64Url(1366),
  rawId: Base64Url(1366),
  type: Schema.Literal("public-key"),
  response: Schema.Struct({
    clientDataJSON: Base64Url(8192),
    authenticatorData: Base64Url(8192),
    signature: Base64Url(2048),
    userHandle: Schema.optional(Base64Url(256)),
  }),
  clientExtensionResults: Schema.Struct({}),
  authenticatorAttachment: Schema.optional(Schema.Literals(["platform", "cross-platform"])),
});

export const BeginEnrollment = Schema.Struct({ ticket: Ticket });

export const CompleteEnrollment = Schema.Struct({
  challengeId: Accounting.Identifier,
  ticket: Ticket,
  response: RegistrationResponse,
});

export const BeginPresence = Schema.Struct({
  gesture: PresenceGesture,
  subject: PresenceSubject,
});

export const CompletePresence = Schema.Struct({ response: AuthenticationResponse });

// WebAuthn options are passed unchanged to navigator.credentials.
export const EnrollmentChallenge = Schema.Struct({
  id: Accounting.Identifier,
  expiresAt: Schema.String,
  options: Schema.JsonObject,
});

export const EnrolledAuthenticator = Schema.Struct({ credentialId: Base64Url(1366) });

export const PresenceChallenge = Schema.Struct({
  id: Accounting.Identifier,
  gesture: PresenceGesture,
  bindingDigest: Schema.String,
  expiresAt: Schema.String,
  options: Schema.JsonObject,
});

export const PresenceProof = Schema.Struct({
  challengeId: Accounting.Identifier,
  verified: Schema.Literal(true),
});

const bookPath = "/v1/entities/:entityId/books/:bookId/presence";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;

export const PresenceApi = HttpApiGroup.make("presence")
  .add(
    HttpApiEndpoint.post("beginPresenceEnrollment", "/v1/presence/enrollment-challenges", {
      payload: BeginEnrollment.annotate(strict),
      success: EnrollmentChallenge,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("completePresenceEnrollment", "/v1/presence/authenticators", {
      payload: CompleteEnrollment.annotate(strict),
      success: EnrolledAuthenticator,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("beginPresence", `${bookPath}/challenges`, {
      params: Accounting.Scope,
      payload: BeginPresence.annotate(strict),
      success: PresenceChallenge,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("completePresence", `${bookPath}/challenges/:id/assertion`, {
      params: Accounting.ChangePath,
      payload: CompletePresence.annotate(strict),
      success: PresenceProof,
      error: accountingErrors,
    }),
  );
