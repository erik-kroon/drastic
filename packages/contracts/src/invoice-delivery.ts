import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

export const DeliveryChannel = Schema.Literals(["email", "peppol", "local_simulation"]);
export const PrepareInvoiceDelivery = Schema.Struct({
  pdfCaptureId: Accounting.Identifier,
  captureDigest: Accounting.Digest,
  artifactSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  channel: DeliveryChannel,
  destination: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  reason: Accounting.Description,
  acknowledgeNoTransmission: Schema.Literal(true),
});
export const InvoiceDeliveryRequest = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  input: PrepareInvoiceDelivery,
  artifactByteLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1048576 })),
  pdfIssueId: Accounting.Identifier,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  status: Schema.Literal("review_only"),
  legalInvoice: Schema.Literal(false),
  sendAuthorized: Schema.Literal(false),
  digest: Accounting.Digest,
});
export const ApproveInvoiceDelivery = Schema.Struct({
  requestDigest: Accounting.Digest,
  reason: Accounting.Description,
  acknowledgeNoTransmission: Schema.Literal(true),
});
export const InvoiceDeliveryApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  requestId: Accounting.Identifier,
  input: ApproveInvoiceDelivery,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  sendAuthorized: Schema.Literal(false),
  simulationAuthorized: Schema.Boolean,
  digest: Accounting.Digest,
});
export const StartInvoiceDeliverySimulation = Schema.Struct({
  requestDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  acknowledgeNoExternalCall: Schema.Literal(true),
});
export const InvoiceDeliveryAttempt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  requestId: Accounting.Identifier,
  ordinal: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
  approvalId: Accounting.Identifier,
  artifactSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  startedBy: Accounting.Identifier,
  startedAt: Schema.String,
  status: Schema.Literal("simulated_unknown"),
  externalTraffic: Schema.Literal(false),
  providerRequestId: Schema.Null,
  digest: Accounting.Digest,
});
export const ResolveInvoiceDeliverySimulation = Schema.Struct({
  attemptDigest: Accounting.Digest,
  reason: Accounting.Description,
  assertNoExternalCall: Schema.Literal(true),
});
export const InvoiceDeliveryResolution = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  attemptId: Accounting.Identifier,
  actorId: Accounting.Identifier,
  reason: Accounting.Description,
  outcome: Schema.Literal("simulated_not_sent"),
  externalTraffic: Schema.Literal(false),
  resolvedAt: Schema.String,
  digest: Accounting.Digest,
});
export const InvoiceDeliveryView = Schema.Struct({
  request: InvoiceDeliveryRequest,
  approval: Schema.NullOr(InvoiceDeliveryApproval),
  attempts: Schema.Array(
    Schema.Struct({
      attempt: InvoiceDeliveryAttempt,
      resolution: Schema.NullOr(InvoiceDeliveryResolution),
    }),
  ).check(Schema.isMaxLength(20)),
  status: Schema.Literals([
    "review_only",
    "simulation_ready",
    "simulated_unknown",
    "simulated_not_sent",
    "provider_blocked",
  ]),
  sendAuthorized: Schema.Literal(false),
  complete: Schema.Literal(true),
});
export const InvoiceDeliveryHistory = Schema.Struct({
  scope: Accounting.Scope,
  pdfCaptureId: Accounting.Identifier,
  complete: Schema.Literal(true),
  items: Schema.Array(InvoiceDeliveryView).check(Schema.isMaxLength(50)),
});
const base = "/v1/entities/:entityId/books/:bookId/commerce";
const identified = { params: Accounting.ChangePath, error: accountingErrors };
const mutation = { ...identified, headers: Accounting.IdempotencyHeaders };
export const InvoiceDeliveryApi = HttpApiGroup.make("invoiceDeliveries").add(
  HttpApiEndpoint.post("prepareInvoiceDelivery", `${base}/invoice-deliveries`, {
    params: Accounting.Scope,
    error: accountingErrors,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareInvoiceDelivery.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: InvoiceDeliveryView,
  }),
  HttpApiEndpoint.post("approveInvoiceDelivery", `${base}/invoice-deliveries/:id/approve`, {
    ...mutation,
    payload: ApproveInvoiceDelivery.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: InvoiceDeliveryView,
  }),
  HttpApiEndpoint.post(
    "startInvoiceDeliverySimulation",
    `${base}/invoice-deliveries/:id/simulate`,
    {
      ...mutation,
      payload: StartInvoiceDeliverySimulation.annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
      success: InvoiceDeliveryView,
    },
  ),
  HttpApiEndpoint.post(
    "resolveInvoiceDeliverySimulation",
    `${base}/invoice-delivery-attempts/:id/resolve`,
    {
      ...mutation,
      payload: ResolveInvoiceDeliverySimulation.annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
      success: InvoiceDeliveryView,
    },
  ),
  HttpApiEndpoint.get("getInvoiceDelivery", `${base}/invoice-deliveries/:id`, {
    ...identified,
    success: InvoiceDeliveryView,
  }),
  HttpApiEndpoint.get("invoiceDeliveryHistory", `${base}/invoice-pdfs/:id/deliveries`, {
    ...identified,
    success: InvoiceDeliveryHistory,
  }),
);
export const InvoiceDeliveryCapabilities = {
  commerce_get_invoice_delivery: {
    description:
      "Read a reviewed-only delivery intent, exact PDF byte identity, and simulated attempt recovery. No external delivery.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: InvoiceDeliveryView,
    readOnly: true,
  },
  commerce_invoice_delivery_history: {
    description:
      "Read complete bounded delivery intents for a retained PDF. Email and Peppol remain blocked.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: InvoiceDeliveryHistory,
    readOnly: true,
  },
};
