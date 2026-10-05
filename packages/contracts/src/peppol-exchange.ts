import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import * as Source from "./source-intake";

export const releaseSha256 = "b4a2bb071345361feaacc429cd70a1d82aa3a43c8746ba611ab8bf22f73c87be";

export const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

const Label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

export const DocumentReference = Schema.Struct({
  kind: Schema.Literals(["invoice", "credit"]),
  id: Accounting.Identifier,
});

export const RegisterBinding = Schema.Struct({
  document: DocumentReference,
  role: Schema.Literals(["sender", "recipient"]),
  participantId: Schema.String.check(Schema.isPattern(/^[0-9]{10}$/)),
  schemeId: Schema.Literal("0007"),
  providerAccount: Schema.Literal("synthetic-ap-v1"),
  active: Schema.Boolean,
  evidenceId: Accounting.Identifier,
  buyerReference: Schema.NullOr(Label),
  paymentAccountReference: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[0-9]{7,8}$/))),
  acknowledgeSyntheticAccessPoint: Schema.Literal(true),
});

export const Binding = Schema.Struct({
  ...RegisterBinding.fields,
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  subjectKey: Accounting.Digest,
  partyDigest: Accounting.Digest,
  revision: Accounting.MinorUnits,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  digest: Accounting.Digest,
});

export const ExpectedSemantic = Schema.Struct({
  documentId: Label,
  documentType: Schema.Literals(["Invoice", "CreditNote"]),
  currency: Schema.Literal("SEK"),
  sellerParticipant: Schema.String,
  buyerParticipant: Schema.String,
  exclusiveMinor: Accounting.MinorUnits,
  taxMinor: Accounting.MinorUnits,
  payableMinor: Accounting.MinorUnits,
  originalInvoiceRef: Schema.NullOr(Label),
});

export const ValidationRequest = Schema.Struct({
  xml: Schema.String.check(Schema.isMaxLength(1048576)),
  releaseSha256: Hash,
  expected: ExpectedSemantic,
});

export const ValidationReport = Schema.Struct({
  outcome: Schema.String,
  releaseSha256: Schema.optional(Hash),
  xmlSha256: Schema.optional(Hash),
  semantic: Schema.optional(ExpectedSemantic),
  diagnostics: Schema.Array(Schema.JsonObject),
  networkResolution: Schema.optional(Schema.Literal("disabled")),
  networkAccessPointQualification: Schema.optional(Schema.Literal("not-established")),
});

export const Prepare = Schema.Struct({
  document: DocumentReference,
  senderBindingId: Accounting.Identifier,
  recipientBindingId: Accounting.Identifier,
});

export const Artifact = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  input: Prepare,
  documentDigest: Accounting.Digest,
  sender: Binding,
  recipient: Binding,
  expected: ExpectedSemantic,
  rendererVersion: Schema.Literal("ubl21-se-domestic-25-v1"),
  xml: ValidationRequest.fields.xml,
  xmlSha256: Hash,
  validation: ValidationReport,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  digest: Accounting.Digest,
});

export const Approve = Schema.Struct({ digest: Accounting.Digest });

export const Approval = Schema.Struct({
  id: Accounting.Identifier,
  artifactId: Accounting.Identifier,
  digest: Accounting.Digest,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  createdAt: Schema.String,
});

export const Dispatch = Schema.Struct({
  digest: Accounting.Digest,
  approvalId: Accounting.Identifier,
});

export const ProviderMessage = Schema.Struct({
  providerAccount: Schema.Literal("synthetic-ap-v1"),
  providerKey: Label,
  artifactId: Accounting.Identifier,
  documentId: Label,
  documentHash: Hash,
  senderParticipant: Schema.String,
  recipientParticipant: Schema.String,
  senderBindingDigest: Accounting.Digest,
  recipientBindingDigest: Accounting.Digest,
  releaseSha256: Hash,
  expected: ExpectedSemantic,
  xml: ValidationRequest.fields.xml,
});

export const ProviderOutcome = Schema.Struct({
  providerAccount: Schema.Literal("synthetic-ap-v1"),
  providerKey: Label,
  externalMessageId: Label,
  artifactId: Accounting.Identifier,
  documentId: Label,
  documentHash: Hash,
  senderParticipant: Schema.String,
  recipientParticipant: Schema.String,
  releaseSha256: Hash,
  outcome: Schema.Literals(["transport_accepted", "recipient_delivered", "unknown"]),
  observedAt: Schema.String,
});

export const NotSubmitted = Schema.Struct({
  kind: Schema.Literal("not_submitted"),
  providerAccount: ProviderMessage.fields.providerAccount,
  providerKey: Label,
  observedAt: Schema.String,
});

export const ProviderStatus = Schema.Union([ProviderOutcome, NotSubmitted]);

export const SubmissionAdmission = Schema.Struct({
  id: Accounting.Identifier,
  attemptId: Accounting.Identifier,
  artifactId: Accounting.Identifier,
  approval: Approval,
  executorId: Accounting.Identifier,
  admittedAt: Schema.String,
  providerKey: Label,
  messageDigest: Accounting.Digest,
  absence: Schema.NullOr(NotSubmitted),
  kind: Schema.Literals(["first_submission", "confirmed_absence_retry"]),
});

export const Attempt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  artifactId: Accounting.Identifier,
  artifactDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  admittedBy: Accounting.Identifier,
  admittedAt: Schema.String,
  message: ProviderMessage,
  providerKey: Label,
  outcome: ProviderOutcome.fields.outcome,
  externalMessageId: Schema.NullOr(Label),
  paid: Schema.Literal(false),
  posted: Schema.Literal(false),
  digest: Accounting.Digest,
});

export const GetAttempt = Schema.Struct({
  attempt: Attempt,
  observations: Schema.Array(ProviderOutcome),
  submissions: Schema.Array(SubmissionAdmission),
});

export const Envelope = Schema.Struct({
  providerAccount: Schema.Literal("synthetic-ap-v1"),
  transportMessageId: Label,
  recipientParticipant: Schema.String,
  senderParticipant: Schema.String,
  xml: ValidationRequest.fields.xml,
  xmlSha256: Hash,
  expected: ExpectedSemantic,
});

export const Receive = Schema.Struct({
  bindingId: Accounting.Identifier,
  transportMessageId: Label,
});

export const SourceAssertion = Schema.Struct({
  field: Label,
  value: Schema.String,
  sourceLocation: Label,
  sourceHash: Accounting.Digest,
  origin: Schema.Literal("SOURCE"),
});

export const InboundReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  providerAccount: Schema.Literal("synthetic-ap-v1"),
  transportMessageId: Label,
  recipientParticipant: Schema.String,
  businessIdentity: Accounting.Digest,
  occurrence: Source.SourceOccurrence,
  duplicateCandidate: Schema.Boolean,
  assertions: Schema.Array(SourceAssertion),
  validation: ValidationReport,
  posted: Schema.Literal(false),
  paid: Schema.Literal(false),
  approved: Schema.Literal(false),
  createdAt: Schema.String,
  digest: Accounting.Digest,
});

const path = "/v1/entities/:entityId/books/:bookId/commerce/peppol";

const mutation = { headers: Accounting.IdempotencyHeaders, error: accountingErrors };

export const PeppolExchangeApi = HttpApiGroup.make("peppolExchange")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiEndpoint.post("registerPeppolBinding", `${path}/bindings`, {
      ...mutation,
      params: Accounting.Scope,
      payload: RegisterBinding,
      success: Binding,
    }),
    HttpApiEndpoint.get("getPeppolBinding", `${path}/bindings/:id`, {
      params: Accounting.ChangePath,
      error: accountingErrors,
      success: Binding,
    }),
    HttpApiEndpoint.post("preparePeppolArtifact", `${path}/artifacts`, {
      ...mutation,
      params: Accounting.Scope,
      payload: Prepare,
      success: Artifact,
    }),
    HttpApiEndpoint.get("getPeppolArtifact", `${path}/artifacts/:id`, {
      params: Accounting.ChangePath,
      error: accountingErrors,
      success: Artifact,
    }),
    HttpApiEndpoint.post("approvePeppolExchange", `${path}/artifacts/:id/approvals`, {
      ...mutation,
      params: Accounting.ChangePath,
      payload: Approve,
      success: Approval,
    }),
    HttpApiEndpoint.post("dispatchPeppolExchange", `${path}/artifacts/:id/dispatch`, {
      ...mutation,
      params: Accounting.ChangePath,
      payload: Dispatch,
      success: Attempt,
    }),
    HttpApiEndpoint.get("getPeppolAttempt", `${path}/attempts/:id`, {
      params: Accounting.ChangePath,
      error: accountingErrors,
      success: GetAttempt,
    }),
    HttpApiEndpoint.post("collectPeppolOutcome", `${path}/attempts/:id/collect`, {
      ...mutation,
      params: Accounting.ChangePath,
      payload: Schema.Struct({}),
      success: Attempt,
    }),
    HttpApiEndpoint.post("receivePeppolEnvelope", `${path}/inbound`, {
      ...mutation,
      params: Accounting.Scope,
      payload: Receive,
      success: InboundReceipt,
    }),
    HttpApiEndpoint.get("getPeppolInbound", `${path}/inbound/:id`, {
      params: Accounting.ChangePath,
      error: accountingErrors,
      success: InboundReceipt,
    }),
  );

const command = { scope: Accounting.Scope, idempotencyKey: Accounting.Identifier };

export const PeppolExchangeCapabilities = {
  commerce_register_peppol_binding: {
    description:
      "Register a reviewed synthetic Peppol participant mapping from an issued financial snapshot.",
    input: Schema.Struct({ ...command, input: RegisterBinding }),
    output: Binding,
    readOnly: false,
    agentCallable: false,
  },
  commerce_get_peppol_binding: {
    description: "Read a retained participant binding and its exact source identity.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: Binding,
    readOnly: true,
  },
  commerce_prepare_peppol_artifact: {
    description:
      "Render and actually validate a retained issued domestic invoice or linked credit using pinned offline rules. No financial writes or delivery.",
    input: Schema.Struct({ ...command, input: Prepare }),
    output: Artifact,
    readOnly: false,
  },
  commerce_get_peppol_artifact: {
    description:
      "Read exact validated Peppol XML and full diagnostics from its retained financial source.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: Artifact,
    readOnly: true,
  },
  commerce_approve_peppol_exchange: {
    description:
      "Human approval for the exact XML, recipient, source and selected synthetic access point.",
    input: Schema.Struct({ ...command, artifactId: Accounting.Identifier, input: Approve }),
    output: Approval,
    readOnly: false,
    agentCallable: false,
  },
  commerce_dispatch_peppol_exchange: {
    description:
      "Admit one human-approved exact delivery and contact the selected authenticated synthetic access point outside the transaction. Unknown outcomes retain one correlation.",
    input: Schema.Struct({ ...command, artifactId: Accounting.Identifier, input: Dispatch }),
    output: Attempt,
    readOnly: false,
  },
  commerce_get_peppol_attempt: {
    description:
      "Read transport observations separately from legal issuance, payment and financial posting.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: GetAttempt,
    readOnly: true,
  },
  commerce_collect_peppol_outcome: {
    description:
      "Recover the same retained provider correlation without sending another legal document.",
    input: Schema.Struct({
      ...command,
      attemptId: Accounting.Identifier,
      input: Schema.Struct({}),
    }),
    output: Attempt,
    readOnly: false,
  },
  commerce_receive_peppol_envelope: {
    description:
      "Receive authenticated synthetic access-point XML into ordinary supplier source intake and human review. No posting, approval or payment.",
    input: Schema.Struct({ ...command, input: Receive }),
    output: InboundReceipt,
    readOnly: false,
    agentCallable: false,
  },
  commerce_get_peppol_inbound: {
    description:
      "Read retained original provenance, source assertions and duplicate diagnosis for a Peppol inbox occurrence.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: InboundReceipt,
    readOnly: true,
  },
};
