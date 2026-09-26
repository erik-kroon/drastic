import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

const EvidenceRef = Schema.Struct({
  evidenceId: Accounting.Identifier,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});

const Channel = Schema.Literals(["email", "peppol"]);

export const PrepareLegalDelivery = Schema.Struct({
  pdfCaptureId: Accounting.Identifier,
  captureDigest: Accounting.Digest,
  artifactSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  channel: Channel,
  destination: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(200)),
  providerProfileKey: Accounting.Identifier,
  reason: Accounting.Description,
});

export const LegalDeliveryRequest = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  input: PrepareLegalDelivery,
  issueId: Accounting.Identifier,
  artifactByteLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2097152 })),
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  sendAuthorized: Schema.Literal(false),
  delivered: Schema.Literal(false),
  digest: Accounting.Digest,
});

export const ApproveLegalDelivery = Schema.Struct({
  requestDigest: Accounting.Digest,
  reason: Accounting.Description,
  approveSendHandoff: Schema.Literal(true),
});

export const LegalDeliveryApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  requestId: Accounting.Identifier,
  requestDigest: Accounting.Digest,
  actorId: Accounting.Identifier,
  reason: Accounting.Description,
  approvedAt: Schema.String,
  sendAuthorized: Schema.Literal(true),
  providerPayloadReady: Schema.Boolean,
  delivered: Schema.Literal(false),
  digest: Accounting.Digest,
});

export const StartLegalDeliveryAttempt = Schema.Struct({
  requestDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  providerProfileKey: Accounting.Identifier,
  acknowledgeUncertainBoundary: Schema.Literal(true),
});

export const LegalDeliveryAttempt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  requestId: Accounting.Identifier,
  approvalId: Accounting.Identifier,
  ordinal: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
  providerRequestId: Accounting.Identifier,
  providerProfileKey: Accounting.Identifier,
  pdfCaptureId: Accounting.Identifier,
  artifactSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  channel: Schema.Literal("email"),
  destination: Schema.String,
  startedBy: Accounting.Identifier,
  startedAt: Schema.String,
  status: Schema.Literal("provider_unknown"),
  externalTrafficProven: Schema.Literal(false),
  delivered: Schema.Literal(false),
  digest: Accounting.Digest,
});

export const ReconcileLegalDeliveryAttempt = Schema.Struct({
  attemptDigest: Accounting.Digest,
  providerRequestId: Accounting.Identifier,
  outcome: Schema.Literals(["provider_accepted", "provider_rejected", "confirmed_not_sent"]),
  providerMessageId: Schema.NullOr(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  ),
  providerEvidence: EvidenceRef,
  reason: Accounting.Description,
});

export const LegalDeliveryReconciliation = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  attemptId: Accounting.Identifier,
  attemptDigest: Accounting.Digest,
  providerRequestId: Accounting.Identifier,
  providerMessageId: Schema.NullOr(Schema.String),
  providerEvidence: EvidenceRef,
  outcome: Schema.Literals(["provider_accepted", "provider_rejected", "confirmed_not_sent"]),
  reason: Accounting.Description,
  actorId: Accounting.Identifier,
  reconciledAt: Schema.String,
  delivered: Schema.Literal(false),
  digest: Accounting.Digest,
});

export const LegalDeliveryView = Schema.Struct({
  request: LegalDeliveryRequest,
  approval: Schema.NullOr(LegalDeliveryApproval),
  attempts: Schema.Array(
    Schema.Struct({
      attempt: LegalDeliveryAttempt,
      reconciliation: Schema.NullOr(LegalDeliveryReconciliation),
    }),
  ).check(Schema.isMaxLength(20)),
  status: Schema.Literals([
    "awaiting_send_approval",
    "peppol_payload_blocked",
    "approved_handoff_ready",
    "provider_unknown",
    "provider_accepted",
    "provider_rejected",
    "confirmed_not_sent",
  ]),
  delivered: Schema.Literal(false),
  complete: Schema.Literal(true),
});

export const LegalDeliveryHistory = Schema.Struct({
  scope: Accounting.Scope,
  pdfCaptureId: Accounting.Identifier,
  complete: Schema.Literal(true),
  items: Schema.Array(LegalDeliveryView).check(Schema.isMaxLength(50)),
});

const base = "/v1/entities/:entityId/books/:bookId/commerce";

const identified = { params: Accounting.ChangePath, error: accountingErrors };

const mutation = { ...identified, headers: Accounting.IdempotencyHeaders };

export const LegalDeliveryApi = HttpApiGroup.make("legalDeliveries").add(
  HttpApiEndpoint.post("prepareLegalDelivery", `${base}/legal-deliveries`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareLegalDelivery.annotate({ parseOptions: { onExcessProperty: "error" } }),
    error: accountingErrors,
    success: LegalDeliveryView,
  }),
  HttpApiEndpoint.post("approveLegalDelivery", `${base}/legal-deliveries/:id/send-approval`, {
    ...mutation,
    payload: ApproveLegalDelivery.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: LegalDeliveryView,
  }),
  HttpApiEndpoint.post(
    "startLegalDeliveryAttempt",
    `${base}/legal-deliveries/:id/provider-attempts`,
    {
      ...mutation,
      payload: StartLegalDeliveryAttempt.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: LegalDeliveryView,
    },
  ),
  HttpApiEndpoint.post(
    "reconcileLegalDeliveryAttempt",
    `${base}/legal-delivery-attempts/:id/reconcile`,
    {
      ...mutation,
      payload: ReconcileLegalDeliveryAttempt.annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
      success: LegalDeliveryView,
    },
  ),
  HttpApiEndpoint.get("getLegalDelivery", `${base}/legal-deliveries/:id`, {
    ...identified,
    success: LegalDeliveryView,
  }),
  HttpApiEndpoint.get("legalDeliveryHistory", `${base}/legal-invoice-pdfs/:id/deliveries`, {
    ...identified,
    success: LegalDeliveryHistory,
  }),
);

export const LegalDeliveryCapabilities = {
  commerce_get_legal_delivery: {
    description:
      "Read legal PDF outbox, separate send approval and uncertain provider request recovery. Provider acceptance is not customer delivery.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: LegalDeliveryView,
    readOnly: true,
  },
  commerce_legal_delivery_history: {
    description:
      "Read complete bounded delivery intents and outcomes tied to one immutable legal PDF.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: LegalDeliveryHistory,
    readOnly: true,
  },
};
