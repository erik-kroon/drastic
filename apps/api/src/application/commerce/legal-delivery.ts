import * as Delivery from "@open-erp/contracts/legal-delivery";
import * as LegalPdf from "@open-erp/contracts/legal-invoice-pdf";
import * as Effect from "effect/Effect";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as ArDb from "../../db/commerce/ar-legal";
import * as DocumentDb from "../../db/commerce/documents";
import { requireHumanSession } from "../../db/human-actor";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";
import {
  toJsonObject,
  decode,
  objectField,
  withBook,
  requireTableAccess,
  requireRetainedEvidence,
  type Scope,
} from "./support";

import { decodeBase64, sha256HexOf } from "./documents";

const DeliveryRequestSchema = Delivery.LegalDeliveryRequest;

const DeliveryApprovalSchema = Delivery.LegalDeliveryApproval;

const DeliveryAttemptSchema = Delivery.LegalDeliveryAttempt;

const DeliveryReconciliationSchema = Delivery.LegalDeliveryReconciliation;

const DeliveryViewSchema = Delivery.LegalDeliveryView;

const DeliveryHistorySchema = Delivery.LegalDeliveryHistory;

const deliveryAttemptBound = 20;

const deliveryHistoryBound = 50;

export const getLegalDelivery = Effect.fn("commerce.legalDelivery.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, ArDb.arLegalDeliveryTables, false);

    const request = (yield* ArDb.readLegalDeliveryRequest(
      transaction,
      input.scope.bookId,
      input.id,
    ))[0];

    if (!request) return yield* failure("NotFound");

    return yield* legalDeliveryView(transaction, input.scope, request);
  });
});

export const readLegalDeliveryHistory = Effect.fn("commerce.legalDelivery.history")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, ArDb.arLegalDeliveryTables, false);

    const capture = (yield* DocumentDb.readLegalCapture(
      transaction,
      input.scope.bookId,
      input.id,
    ))[0];

    if (!capture) return yield* failure("NotFound");

    const requests = yield* ArDb.readLegalDeliveryRequestsByCapture(
      transaction,
      input.scope.bookId,
      input.id,
      deliveryHistoryBound,
    );

    if (requests.length > deliveryHistoryBound) return yield* failure("InvalidJournal");

    return yield* decode(DeliveryHistorySchema, {
      scope: input.scope,
      pdfCaptureId: input.id,
      complete: true,
      items: yield* Effect.forEach(requests, (request) =>
        legalDeliveryView(transaction, input.scope, request),
      ),
    });
  });
});

export function legalDeliveryView(
  transaction: Transaction,
  scope: Scope,
  request: ArDb.DeliveryRequestRow,
) {
  return Effect.gen(function* () {
    const approvalRow = (yield* ArDb.readLegalDeliveryApproval(
      transaction,
      scope.bookId,
      request.id,
    ))[0];

    const attemptRows = yield* ArDb.readLegalDeliveryAttempts(
      transaction,
      scope.bookId,
      request.id,
      deliveryAttemptBound,
    );

    if (attemptRows.length > deliveryAttemptBound) return yield* failure("InvalidJournal");

    const attempts = yield* Effect.forEach(attemptRows, (row) =>
      Effect.gen(function* () {
        const attempt = yield* decode(DeliveryAttemptSchema, row.attempt);

        const reconciliation =
          row.reconciliation === null
            ? null
            : yield* decode(DeliveryReconciliationSchema, row.reconciliation);

        return { attempt, reconciliation };
      }),
    );

    const latest = attempts.at(-1);
    const reconciled = latest?.reconciliation ?? undefined;

    const status =
      reconciled !== undefined
        ? reconciled.outcome
        : latest !== undefined
          ? "provider_unknown"
          : approvalRow === undefined
            ? "awaiting_send_approval"
            : request.channel === "peppol"
              ? "peppol_payload_blocked"
              : "approved_handoff_ready";

    return yield* decode(DeliveryViewSchema, {
      request: yield* decode(DeliveryRequestSchema, request.body),
      approval:
        approvalRow === undefined ? null : yield* decode(DeliveryApprovalSchema, approvalRow.body),
      attempts,
      status,
      delivered: false,
      complete: true,
    });
  });
}

function checkedArtifact(
  tx: Transaction,
  scope: Scope,
  input: typeof Delivery.PrepareLegalDelivery.Type,
) {
  return Effect.gen(function* () {
    const row = (yield* DocumentDb.readLegalCapture(tx, scope.bookId, input.pdfCaptureId))[0];
    const pdf = (yield* DocumentDb.readLegalArtifact(tx, scope.bookId, input.pdfCaptureId))[0];

    if (!row || !pdf) return yield* failure("NotFound");
    const capture = yield* decode(LegalPdf.LegalInvoicePdfCapture, row.body);
    const bytes = yield* decodeBase64(pdf.contentBase64, 2097152);
    const issue = (yield* DocumentDb.readLegalIssue(tx, scope.bookId, capture.issueId))[0];

    if (
      capture.digest !== input.captureDigest ||
      pdf.descriptor.captureDigest !== capture.digest ||
      pdf.descriptor.sha256 !== input.artifactSha256 ||
      (yield* sha256HexOf(bytes)) !== input.artifactSha256 ||
      !issue ||
      !equalJson(issue.body, objectField(objectField(row.body, "source"), "issue"))
    )
      return yield* failure("StaleDependency");

    return { capture, byteLength: bytes.byteLength };
  });
}

function readRequest(tx: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const row = (yield* ArDb.readLegalDeliveryRequest(tx, scope.bookId, id))[0];

    if (!row) return yield* failure("NotFound");
    const request = yield* decode(Delivery.LegalDeliveryRequest, row.body);
    const sealed = request.digest;
    const body = { ...(yield* toJsonObject(request)) };
    delete body.digest;

    if ((yield* digest(body)) !== sealed) return yield* failure("StaleDependency");

    return { row, request };
  });
}

export const prepareLegalDelivery = Effect.fn("commerce.legalDelivery.prepare")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Delivery.PrepareLegalDelivery.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, input, idempotencyKey } = command,
        operation = "prepare_ar_legal_delivery";

      const replayed = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        input,
        Delivery.LegalDeliveryView,
      );

      if (replayed.previous) return replayed.previous;

      if (
        !/^[a-z][a-z0-9_-]{2,127}$/.test(input.providerProfileKey) ||
        !input.reason.trim() ||
        !(
          input.channel === "email"
            ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/
            : /^[0-9]{4}:[A-Za-z0-9._-]{1,160}$/
        ).test(input.destination)
      )
        return yield* failure("InvalidJournal");
      const { capture, byteLength } = yield* checkedArtifact(tx, scope, input);
      const requests = yield* ArDb.readDeliveryRequestSummaries(tx, scope.bookId);

      if (
        requests.some(
          (r) =>
            r.captureId === capture.id &&
            r.channel === input.channel &&
            r.destination === input.destination,
        )
      )
        return yield* failure("IdempotencyConflict");

      if (requests.length >= 50) return yield* failure("UnsupportedProfile");

      const body = {
        id: newId("ar_delivery"),
        scope,
        input,
        issueId: capture.issueId,
        artifactByteLength: byteLength,
        createdBy: principal.actorId,
        createdAt: yield* isoNow(tx),
        sendAuthorized: false,
        delivered: false,
      };

      const request = yield* decode(Delivery.LegalDeliveryRequest, {
        ...body,
        digest: yield* digest(body),
      });

      yield* ArDb.insertDeliveryRequest(tx, scope.bookId, request);

      const result = yield* legalDeliveryView(tx, scope, {
        id: request.id,
        captureId: capture.id,
        channel: input.channel,
        createdBy: principal.actorId,
        body: request,
      });

      yield* saveCommand(
        tx,
        scope,
        idempotencyKey,
        replayed.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const approveLegalDelivery = Effect.fn("commerce.legalDelivery.approve")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Delivery.ApproveLegalDelivery.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireHumanSession(principal);

      const { scope, id, input, idempotencyKey } = command,
        operation = "approve_ar_legal_delivery";

      const replayed = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Delivery.LegalDeliveryView,
      );

      if (replayed.previous) return replayed.previous;
      const { row, request } = yield* readRequest(tx, scope, id);

      if (
        request.digest !== input.requestDigest ||
        request.createdBy === principal.actorId ||
        !input.approveSendHandoff
      )
        return yield* failure("ApprovalRequired");

      if (!input.reason.trim()) return yield* failure("InvalidJournal");
      yield* checkedArtifact(tx, scope, request.input);

      if ((yield* ArDb.readLegalDeliveryApproval(tx, scope.bookId, id)).length)
        return yield* failure("IdempotencyConflict");

      const body = {
        id: newId("ar_send_approval"),
        scope,
        requestId: id,
        requestDigest: request.digest,
        actorId: principal.actorId,
        reason: input.reason,
        approvedAt: yield* isoNow(tx),
        sendAuthorized: true,
        providerPayloadReady: request.input.channel === "email",
        delivered: false,
      };

      const approval = yield* decode(Delivery.LegalDeliveryApproval, {
        ...body,
        digest: yield* digest(body),
      });

      yield* ArDb.insertDeliveryApproval(tx, scope.bookId, approval);
      const result = yield* legalDeliveryView(tx, scope, row);
      yield* saveCommand(
        tx,
        scope,
        idempotencyKey,
        replayed.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const startLegalDeliveryAttempt = Effect.fn("commerce.legalDelivery.start")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Delivery.StartLegalDeliveryAttempt.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireHumanSession(principal);

      const { scope, id, input, idempotencyKey } = command,
        operation = "start_ar_legal_delivery_attempt";

      const replayed = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Delivery.LegalDeliveryView,
      );

      if (replayed.previous) return replayed.previous;
      const { row, request } = yield* readRequest(tx, scope, id);

      if (request.input.channel !== "email") return yield* failure("UnsupportedProfile");
      const stored = (yield* ArDb.readLegalDeliveryApproval(tx, scope.bookId, id))[0];

      if (!stored) return yield* failure("ApprovalRequired");
      const approval = yield* decode(Delivery.LegalDeliveryApproval, stored.body);

      if (
        approval.id !== input.approvalId ||
        approval.actorId !== principal.actorId ||
        request.digest !== input.requestDigest ||
        approval.requestDigest !== request.digest ||
        request.input.providerProfileKey !== input.providerProfileKey ||
        !input.acknowledgeUncertainBoundary
      )
        return yield* failure("ApprovalRequired");
      const artifact = yield* checkedArtifact(tx, scope, request.input);

      if (artifact.byteLength !== request.artifactByteLength)
        return yield* failure("StaleDependency");
      const view = yield* legalDeliveryView(tx, scope, row);

      if (view.attempts.some((a) => a.reconciliation?.outcome !== "confirmed_not_sent"))
        return yield* failure("StaleDependency");
      const ordinal = view.attempts.length + 1;

      if (ordinal > 20) return yield* failure("UnsupportedProfile");

      const body = {
        id: newId("ar_attempt"),
        scope,
        requestId: id,
        approvalId: approval.id,
        ordinal,
        providerRequestId: newId("ar_provider_request"),
        providerProfileKey: input.providerProfileKey,
        pdfCaptureId: request.input.pdfCaptureId,
        artifactSha256: request.input.artifactSha256,
        channel: "email",
        destination: request.input.destination,
        startedBy: principal.actorId,
        startedAt: yield* isoNow(tx),
        status: "provider_unknown",
        externalTrafficProven: false,
        delivered: false,
      };

      const attempt = yield* decode(Delivery.LegalDeliveryAttempt, {
        ...body,
        digest: yield* digest(body),
      });

      yield* ArDb.insertDeliveryAttempt(tx, scope.bookId, attempt);
      const result = yield* legalDeliveryView(tx, scope, row);
      yield* saveCommand(
        tx,
        scope,
        idempotencyKey,
        replayed.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const reconcileLegalDeliveryAttempt = Effect.fn("commerce.legalDelivery.reconcile")(
  function* (
    token: string,
    command: {
      scope: Scope;
      id: string;
      idempotencyKey: string;
      input: typeof Delivery.ReconcileLegalDeliveryAttempt.Type;
    },
  ) {
    return yield* withBook(
      token,
      command.scope,
      true,
      function* (tx, principal) {
        yield* requireHumanSession(principal);

        const { scope, id, input, idempotencyKey } = command,
          operation = "reconcile_ar_legal_delivery_attempt";

        const replayed = yield* replay(
          tx,
          scope,
          idempotencyKey,
          operation,
          principal.actorId,
          { id, input },
          Delivery.LegalDeliveryView,
        );

        if (replayed.previous) return replayed.previous;
        const stored = (yield* ArDb.readDeliveryAttempt(tx, scope.bookId, id))[0];

        if (!stored) return yield* failure("NotFound");
        const attempt = yield* decode(Delivery.LegalDeliveryAttempt, stored.body);

        if (
          attempt.digest !== input.attemptDigest ||
          attempt.providerRequestId !== input.providerRequestId ||
          attempt.startedBy === principal.actorId
        )
          return yield* failure("ApprovalRequired");

        if (
          !input.reason.trim() ||
          (input.outcome === "provider_accepted"
            ? !input.providerMessageId?.trim()
            : input.providerMessageId !== null)
        )
          return yield* failure("InvalidJournal");
        yield* requireRetainedEvidence(tx, scope.bookId, input.providerEvidence);
        const { row } = yield* readRequest(tx, scope, attempt.requestId);
        const view = yield* legalDeliveryView(tx, scope, row);

        if (view.attempts.find((a) => a.attempt.id === id)?.reconciliation)
          return yield* failure("IdempotencyConflict");

        const body = {
          id: newId("ar_reconciliation"),
          scope,
          attemptId: id,
          attemptDigest: attempt.digest,
          providerRequestId: attempt.providerRequestId,
          providerMessageId: input.providerMessageId,
          providerEvidence: input.providerEvidence,
          outcome: input.outcome,
          reason: input.reason,
          actorId: principal.actorId,
          reconciledAt: yield* isoNow(tx),
          delivered: false,
        };

        const reconciliation = yield* decode(Delivery.LegalDeliveryReconciliation, {
          ...body,
          digest: yield* digest(body),
        });

        yield* ArDb.insertDeliveryReconciliation(tx, scope.bookId, reconciliation);
        const result = yield* legalDeliveryView(tx, scope, row);
        yield* saveCommand(
          tx,
          scope,
          idempotencyKey,
          replayed.expected,
          operation,
          principal.actorId,
          result,
        );

        return result;
      },
      "update",
    );
  },
);
