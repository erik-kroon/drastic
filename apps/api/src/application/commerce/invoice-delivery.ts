import * as Delivery from "@open-erp/contracts/invoice-delivery";
import * as Pdf from "@open-erp/contracts/invoice-pdf";
import * as Effect from "effect/Effect";
import { digestJson } from "../../db/commerce/access";
import * as DeliveryDb from "../../db/commerce/invoice-delivery";
import type { Transaction } from "../../db/transaction";
import { isoNow, newId, replay, saveCommand } from "../posting";
import { lockBookForUpdate } from "../../db/posting";
import { failure } from "../failures";
import { decode, requireTableAccess, withBook, type JsonObject, type Scope } from "./support";

const ViewSchema = Delivery.InvoiceDeliveryView;
const HistorySchema = Delivery.InvoiceDeliveryHistory;
const PrepareSchema = Delivery.PrepareInvoiceDelivery;
const ApproveSchema = Delivery.ApproveInvoiceDelivery;
const StartSchema = Delivery.StartInvoiceDeliverySimulation;
const ResolveSchema = Delivery.ResolveInvoiceDeliverySimulation;
const RequestSchema = Delivery.InvoiceDeliveryRequest;

const maxRequests = 50;
const maxAttempts = 20;

function deliveryStatus(
  approval: DeliveryDb.DeliveryApprovalRow | undefined,
  attempts: ReadonlyArray<DeliveryDb.DeliveryAttemptViewRow>,
  channel: string,
) {
  const last = attempts[attempts.length - 1];
  if (last?.resolution) return "simulated_not_sent";
  if (last) return "simulated_unknown";
  if (!approval) return "review_only";
  return channel === "local_simulation" ? "simulation_ready" : "provider_blocked";
}

function readDeliveryView(transaction: Transaction, bookId: string, id: string) {
  return Effect.gen(function* () {
    const requests = yield* DeliveryDb.readDeliveryRequest(transaction, bookId, id);
    const request = requests[0];
    if (!request) return yield* failure("NotFound");
    const approvals = yield* DeliveryDb.readDeliveryApprovalForRequest(transaction, bookId, id);
    const attempts = yield* DeliveryDb.readDeliveryAttempts(transaction, bookId, id);
    const approval = approvals[0];
    return yield* decode(ViewSchema, {
      request: request.body,
      approval: approval?.body ?? null,
      attempts: attempts.map((row) => ({ attempt: row.body, resolution: row.resolution })),
      status: deliveryStatus(approval, attempts, request.channel),
      sendAuthorized: false,
      complete: true,
    });
  });
}

export const prepareDelivery = Effect.fn("commerce.invoiceDelivery.prepare")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Delivery.PrepareInvoiceDelivery.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_invoice_delivery",
        principal.actorId,
        command.input,
        ViewSchema,
      );
      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, DeliveryDb.invoiceDeliveryTables, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const input = yield* decode(PrepareSchema, command.input);
      const captures = yield* DeliveryDb.readPdfCaptureIdentity(
        transaction,
        command.scope.bookId,
        input.pdfCaptureId,
        "update",
      );
      const capture = captures[0];
      if (!capture) return yield* failure("NotFound");
      const artifacts = yield* DeliveryDb.readPdfArtifactIdentity(
        transaction,
        command.scope.bookId,
        capture.id,
      );
      const artifact = artifacts[0];
      if (!artifact) return yield* failure("StaleDependency");
      const captureValue = yield* decode(Pdf.InvoicePdfCapture, capture.body);
      if (
        input.captureDigest !== captureValue.digest ||
        input.artifactSha256 !== artifact.descriptor.sha256 ||
        artifact.descriptor.sha256 !== artifact.sha256 ||
        artifact.descriptor.captureDigest !== captureValue.digest ||
        captureValue.legalInvoice !== false
      ) {
        return yield* failure("StaleDependency");
      }
      const duplicates = yield* DeliveryDb.readDeliveryDuplicate(
        transaction,
        command.scope.bookId,
        capture.id,
        input.channel,
        input.destination,
      );
      if (duplicates[0]?.present === true) return yield* failure("IdempotencyConflict");
      const counts = yield* DeliveryDb.readDeliveryRequestCount(transaction, command.scope.bookId);
      if ((counts[0]?.count ?? 0) >= maxRequests) return yield* failure("UnsupportedProfile");
      const id = newId("invoice_delivery");
      const withoutDigest: JsonObject = {
        id,
        scope: command.scope,
        input,
        artifactByteLength: artifact.byteLength,
        pdfIssueId: capture.issueId,
        createdBy: principal.actorId,
        createdAt: yield* isoNow(transaction),
        status: "review_only",
        legalInvoice: false,
        sendAuthorized: false,
      };
      const digests = yield* digestJson(transaction, withoutDigest);
      const digest = digests[0]?.digest;
      if (digest === undefined) return yield* failure("InternalError");
      const body: JsonObject = Object.assign({}, withoutDigest, { digest });
      yield* DeliveryDb.insertDeliveryRequest(transaction, {
        bookId: command.scope.bookId,
        id: id,
        captureId: capture.id,
        actorId: principal.actorId,
        channel: input.channel,
        body,
      });
      const view = yield* readDeliveryView(transaction, command.scope.bookId, id);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_invoice_delivery",
        principal.actorId,
        view,
      );
      return view;
    },
    "update",
  );
});

export const approveDelivery = Effect.fn("commerce.invoiceDelivery.approve")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Delivery.ApproveInvoiceDelivery.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const replayInput = { id: command.id, input: command.input } satisfies JsonObject;
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "approve_invoice_delivery",
        principal.actorId,
        replayInput,
        ViewSchema,
      );
      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, DeliveryDb.invoiceDeliveryTables, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const input = yield* decode(ApproveSchema, command.input);
      const requests = yield* DeliveryDb.readDeliveryRequest(
        transaction,
        command.scope.bookId,
        command.id,
      );
      const delivery = requests[0];
      if (!delivery) return yield* failure("NotFound");
      if (input.requestDigest !== delivery.body.digest) return yield* failure("StaleDependency");
      if (delivery.actorId === principal.actorId) return yield* failure("ApprovalRequired");
      const approvals = yield* DeliveryDb.readDeliveryApprovalForRequest(
        transaction,
        command.scope.bookId,
        command.id,
      );
      if (approvals.length > 0) return yield* failure("IdempotencyConflict");
      const id = newId("invoice_delivery_approval");
      const withoutDigest: JsonObject = {
        id,
        scope: command.scope,
        requestId: command.id,
        input,
        createdBy: principal.actorId,
        createdAt: yield* isoNow(transaction),
        sendAuthorized: false,
        simulationAuthorized: delivery.channel === "local_simulation",
      };
      const digests = yield* digestJson(transaction, withoutDigest);
      const digest = digests[0]?.digest;
      if (digest === undefined) return yield* failure("InternalError");
      yield* DeliveryDb.insertDeliveryApproval(transaction, {
        bookId: command.scope.bookId,
        id: id,
        requestId: command.id,
        actorId: principal.actorId,
        body: Object.assign({}, withoutDigest, { digest }),
      });
      const view = yield* readDeliveryView(transaction, command.scope.bookId, command.id);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "approve_invoice_delivery",
        principal.actorId,
        view,
      );
      return view;
    },
    "update",
  );
});

export const startSimulation = Effect.fn("commerce.invoiceDelivery.startSimulation")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Delivery.StartInvoiceDeliverySimulation.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const replayInput = { id: command.id, input: command.input } satisfies JsonObject;
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "start_invoice_delivery_simulation",
        principal.actorId,
        replayInput,
        ViewSchema,
      );
      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, DeliveryDb.invoiceDeliveryTables, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const input = yield* decode(StartSchema, command.input);
      const requests = yield* DeliveryDb.readDeliveryRequest(
        transaction,
        command.scope.bookId,
        command.id,
      );
      const delivery = requests[0];
      if (!delivery) return yield* failure("NotFound");
      if (delivery.channel !== "local_simulation") return yield* failure("UnsupportedProfile");
      const approvals = yield* DeliveryDb.readDeliveryApprovalForRequest(
        transaction,
        command.scope.bookId,
        command.id,
      );
      const approval = approvals[0];
      if (
        !approval ||
        approval.id !== input.approvalId ||
        approval.actorId !== principal.actorId ||
        input.requestDigest !== delivery.body.digest
      ) {
        return yield* failure("ApprovalRequired");
      }
      const deliveryValue = yield* decode(RequestSchema, delivery.body);
      const artifacts = yield* DeliveryDb.readPdfArtifactIdentity(
        transaction,
        command.scope.bookId,
        delivery.captureId,
      );
      const artifact = artifacts[0];
      if (
        !artifact ||
        deliveryValue.input.artifactSha256 !== artifact.sha256 ||
        deliveryValue.artifactByteLength !== artifact.byteLength
      ) {
        return yield* failure("StaleDependency");
      }
      const progress = yield* DeliveryDb.readAttemptProgress(
        transaction,
        command.scope.bookId,
        command.id,
      );
      if (progress[0]?.unresolved === true) return yield* failure("StaleDependency");
      const ordinal = (progress[0]?.maxOrdinal ?? 0) + 1;
      if (ordinal > maxAttempts) return yield* failure("UnsupportedProfile");
      const id = newId("invoice_delivery_attempt");
      const withoutDigest: JsonObject = {
        id,
        scope: command.scope,
        requestId: command.id,
        ordinal,
        approvalId: approval.id,
        artifactSha256: deliveryValue.input.artifactSha256,
        startedBy: principal.actorId,
        startedAt: yield* isoNow(transaction),
        status: "simulated_unknown",
        externalTraffic: false,
        providerRequestId: null,
      };
      const digests = yield* digestJson(transaction, withoutDigest);
      const digest = digests[0]?.digest;
      if (digest === undefined) return yield* failure("InternalError");
      yield* DeliveryDb.insertDeliveryAttempt(transaction, {
        bookId: command.scope.bookId,
        id: id,
        requestId: command.id,
        approvalId: approval.id,
        ordinal,
        body: Object.assign({}, withoutDigest, { digest }),
      });
      const view = yield* readDeliveryView(transaction, command.scope.bookId, command.id);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "start_invoice_delivery_simulation",
        principal.actorId,
        view,
      );
      return view;
    },
    "update",
  );
});

export const resolveSimulation = Effect.fn("commerce.invoiceDelivery.resolveSimulation")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Delivery.ResolveInvoiceDeliverySimulation.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const replayInput = { id: command.id, input: command.input } satisfies JsonObject;
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "resolve_invoice_delivery_simulation",
        principal.actorId,
        replayInput,
        ViewSchema,
      );
      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, DeliveryDb.invoiceDeliveryTables, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const input = yield* decode(ResolveSchema, command.input);
      const attempts = yield* DeliveryDb.readDeliveryAttempt(
        transaction,
        command.scope.bookId,
        command.id,
      );
      const attempt = attempts[0];
      if (!attempt) return yield* failure("NotFound");
      if (
        input.attemptDigest !== attempt.body.digest ||
        attempt.body.startedBy !== principal.actorId
      ) {
        return yield* failure("ApprovalRequired");
      }
      const existing = yield* DeliveryDb.readDeliveryResolution(
        transaction,
        command.scope.bookId,
        command.id,
      );
      if (existing[0]?.present === true) return yield* failure("IdempotencyConflict");
      const id = newId("invoice_delivery_resolution");
      const withoutDigest: JsonObject = {
        id,
        scope: command.scope,
        attemptId: command.id,
        actorId: principal.actorId,
        reason: input.reason,
        outcome: "simulated_not_sent",
        externalTraffic: false,
        resolvedAt: yield* isoNow(transaction),
      };
      const digests = yield* digestJson(transaction, withoutDigest);
      const digest = digests[0]?.digest;
      if (digest === undefined) return yield* failure("InternalError");
      yield* DeliveryDb.insertDeliveryResolution(transaction, {
        bookId: command.scope.bookId,
        id: id,
        attemptId: command.id,
        body: Object.assign({}, withoutDigest, { digest }),
      });
      const view = yield* readDeliveryView(transaction, command.scope.bookId, attempt.requestId);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "resolve_invoice_delivery_simulation",
        principal.actorId,
        view,
      );
      return view;
    },
    "update",
  );
});

export const getDelivery = Effect.fn("commerce.invoiceDelivery.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, DeliveryDb.invoiceDeliveryTables, false);
    return yield* readDeliveryView(transaction, input.scope.bookId, input.id);
  });
});

export const readDeliveryHistory = Effect.fn("commerce.invoiceDelivery.history")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, DeliveryDb.invoiceDeliveryTables, false);
    const captures = yield* DeliveryDb.readPdfCaptureIdentity(
      transaction,
      input.scope.bookId,
      input.id,
      "share",
    );
    if (captures.length === 0) return yield* failure("NotFound");
    const requests = yield* DeliveryDb.readDeliveryRequestIdsForCapture(
      transaction,
      input.scope.bookId,
      input.id,
    );
    const views = yield* Effect.forEach(requests, (row) =>
      readDeliveryView(transaction, input.scope.bookId, row.id),
    );
    return yield* decode(HistorySchema, {
      scope: input.scope,
      pdfCaptureId: input.id,
      complete: true,
      items: views,
    });
  });
});
