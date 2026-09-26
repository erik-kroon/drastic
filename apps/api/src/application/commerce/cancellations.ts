import * as Accounting from "@open-erp/contracts/accounting";
import * as Corrections from "@open-erp/contracts/corrections";
import * as Cancellations from "@open-erp/contracts/invoice-cancellations";
import * as Issuance from "@open-erp/contracts/invoice-issuance";
import * as Effect from "effect/Effect";
import * as Db from "../../db/commerce/invoice-cancellations";
import * as Documents from "../../db/commerce/documents";
import * as Ledger from "../../db/posting";
import * as Impact from "../../db/posting-corrections";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import {
  digest,
  isoNow,
  newId,
  readBook,
  replay,
  saveCommand,
  validatePlan,
  prepareCorrectionInTransaction,
  approveChangeInTransaction,
  executeChangeInTransaction,
} from "../posting";
import { toJsonObject, decode, withBook, type Scope } from "./support";
import { liveInvoice } from "./register";

export const cancellationSnapshot = Effect.fn("commerce.cancellation.snapshot")(function* (
  tx: Transaction,
  scope: Scope,
  issueId: string,
  postingDate: string,
) {
  const book = yield* readBook(tx, scope);

  if (book.profile !== "synthetic-core-v1" || book.authority !== "native")
    return yield* failure("UnsupportedProfile");
  const row = (yield* Documents.readIssueWithReview(tx, scope.bookId, issueId, "share"))[0];

  if (!row) return yield* failure("NotFound");
  const issue = yield* decode(Issuance.InvoiceIssueReceipt, row.issue);

  if (
    issue.profile !== "synthetic-manual-invoice-v1" ||
    issue.legalInvoice ||
    issue.delivered ||
    issue.legalDocumentNumber !== null
  )
    return yield* failure("UnsupportedProfile");

  if ((yield* Db.readInvoiceCancellationReceiptForIssue(tx, scope.bookId, issueId)).length)
    return yield* failure("AlreadyPosted");
  const invoice = yield* liveInvoice(tx, scope.bookId, issue.registerInvoiceId);
  const voucher = (yield* Ledger.readVoucher(tx, scope.bookId, invoice.recognition.voucherId))[0];

  if (
    !voucher ||
    invoice.blockers.length ||
    invoice.direction !== "customer" ||
    issue.postingReceipt.voucherId !== voucher.id ||
    (yield* Ledger.readVoucherByReversal(tx, scope.bookId, voucher.id)).length
  )
    return yield* failure("StaleDependency");

  if (BigInt(invoice.recordedAllocatedMinor) !== 0n) return yield* failure("StaleDependency");
  const period = (yield* Db.readRecognitionSourcePeriod(tx, scope.bookId, voucher.id))[0];

  if (!period) return yield* failure("InternalError");

  if (period.locked) return yield* failure("PeriodLocked");
  const action = yield* decode(Accounting.VoucherPostingAction, voucher.action);

  for (const line of action.lines)
    if ((yield* Db.readBankSourceAccount(tx, scope.bookId, line.accountId))[0]?.present)
      return yield* failure("StaleDependency");

  if ((yield* Db.readSubledgerBasisForVoucher(tx, scope.bookId, voucher.id))[0]?.present)
    return yield* failure("StaleDependency");
  const rows = yield* Impact.readImpactResources(tx, scope.bookId, voucher.id, postingDate);

  if (rows.length > 1000) return yield* failure("UnsupportedProfile");

  const resources = yield* Effect.forEach(rows, (row) =>
    decode(Corrections.CorrectionImpactResource, row.resource),
  );

  if (
    resources.some(
      (resource) => resource.blocks && !(resource.kind === "invoice" && resource.id === invoice.id),
    )
  )
    return yield* failure("StaleDependency");

  return { issue, invoice, sourcePeriod: { id: period.id, version: period.version }, resources };
});

export const checkedCancellation = Effect.fn("commerce.cancellation.checked")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expected: string,
) {
  const row = (yield* Db.readInvoiceCancellationReview(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");
  const review = yield* decode(Cancellations.InvoiceCancellationReview, row.body);
  const saved = review.digest;
  const body = { ...yield* toJsonObject(review) };
  delete body.digest;

  if (saved !== expected || (yield* digest(body)) !== saved)
    return yield* failure("StaleDependency");

  const snapshot = yield* cancellationSnapshot(
    tx,
    scope,
    review.input.issueId,
    review.input.postingDate,
  );

  if ((yield* digest(snapshot)) !== (yield* digest(review.snapshot)))
    return yield* failure("StaleDependency");
  yield* validatePlan(tx, scope, review.postingPlan);

  return review;
});

export const prepareInvoiceCancellation = Effect.fn("commerce.cancellation.prepare")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Cancellations.PrepareInvoiceCancellation.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, input, idempotencyKey } = command,
        operation = "prepare_invoice_cancellation";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        input,
        Cancellations.InvoiceCancellationReview,
      );

      if (request.previous) return request.previous;
      const snapshot = yield* cancellationSnapshot(tx, scope, input.issueId, input.postingDate);

      if (snapshot.issue.digest !== input.issueDigest) return yield* failure("StaleDependency");

      const ordinal =
        (yield* Db.readInvoiceCancellationReviewSummaries(tx, scope.bookId, input.issueId, 51))
          .length + 1;

      if (ordinal > 50) return yield* failure("UnsupportedProfile");

      const postingPlan = yield* prepareCorrectionInTransaction(tx, principal, {
        scope,
        voucherId: snapshot.issue.postingReceipt.voucherId,
        idempotencyKey: newId("cancellation_prepare"),
        input: {
          accountingPeriodId: input.accountingPeriodId,
          postingDate: input.postingDate,
          rationale: input.reason,
        },
      });

      const body = {
        id: newId("invoice_cancel_review"),
        scope,
        version: 1,
        input,
        snapshot,
        postingPlan,
        createdAt: yield* isoNow(tx),
        createdBy: principal.actorId,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Cancellations.InvoiceCancellationReview, {
        ...body,
        digest: yield* digest(body),
      });

      if (new TextEncoder().encode(JSON.stringify(result)).length > 262144)
        return yield* failure("UnsupportedProfile");
      yield* Db.insertReview(tx, scope.bookId, result, ordinal);
      yield* saveCommand(
        tx,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const approveInvoiceCancellation = Effect.fn("commerce.cancellation.approve")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Cancellations.ApproveInvoiceCancellation.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, id, input, idempotencyKey } = command,
        operation = "approve_invoice_cancellation";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Cancellations.InvoiceCancellationApproval,
      );

      if (request.previous) return request.previous;
      const review = yield* checkedCancellation(tx, scope, id, input.digest);
      const ordinal = (yield* Db.readInvoiceCancellationApprovals(tx, scope.bookId, id)).length + 1;

      if (ordinal > 50) return yield* failure("UnsupportedProfile");

      const result = yield* decode(Cancellations.InvoiceCancellationApproval, {
        id: newId("invoice_cancel_approval"),
        scope,
        reviewId: id,
        digest: review.digest,
        actorId: principal.actorId,
        expiresAt: new Date(Date.parse(yield* isoNow(tx)) + 3600000).toISOString(),
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      });

      yield* Db.insertApproval(tx, scope.bookId, result, ordinal);
      yield* saveCommand(
        tx,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const executeInvoiceCancellation = Effect.fn("commerce.cancellation.execute")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Cancellations.ExecuteInvoiceCancellation.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, id, input, idempotencyKey } = command,
        operation = "execute_invoice_cancellation";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Cancellations.InvoiceCancellationReceipt,
      );

      if (request.previous) return request.previous;
      const prior = (yield* Db.readInvoiceCancellationReceiptForReview(tx, scope.bookId, id))[0];

      if (prior) {
        const result = yield* decode(Cancellations.InvoiceCancellationReceipt, prior.body);

        if (result.approvalId !== input.approvalId || result.reviewDigest !== input.digest)
          return yield* failure("StaleDependency");
        yield* saveCommand(
          tx,
          scope,
          idempotencyKey,
          request.expected,
          operation,
          principal.actorId,
          result,
        );

        return result;
      }

      const review = yield* checkedCancellation(tx, scope, id, input.digest);

      const row = (yield* Db.readInvoiceCancellationApprovals(tx, scope.bookId, id)).find(
        (row) => row.body.id === input.approvalId,
      );

      if (
        !row ||
        row.revocation !== null ||
        row.actorId !== principal.actorId ||
        Date.parse(row.expiresAt) <= Date.parse(yield* isoNow(tx))
      )
        return yield* failure("ApprovalRequired");
      const approval = yield* decode(Cancellations.InvoiceCancellationApproval, row.body);

      if (approval.digest !== review.digest) return yield* failure("ApprovalRequired");

      const kernel = yield* approveChangeInTransaction(tx, principal, {
        scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: newId("cancellation_approve"),
        input: { version: 1, planDigest: review.postingPlan.planDigest },
      });

      yield* Db.insertExecution(tx, scope.bookId, id, approval.id);

      const postingReceipt = yield* executeChangeInTransaction(tx, principal, {
        scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: newId("cancellation_post"),
        input: { version: 1, planDigest: review.postingPlan.planDigest, approvalId: kernel.id },
        owner: { kind: "invoice_cancellation", id },
      });

      const issue = review.snapshot.issue;

      const body = {
        id: newId("invoice_cancellation"),
        scope,
        reviewId: id,
        reviewDigest: review.digest,
        approvalId: approval.id,
        issueId: issue.id,
        registerInvoiceId: issue.registerInvoiceId,
        internalDocumentNumber: issue.internalDocumentNumber,
        originalVoucherId: issue.postingReceipt.voucherId,
        reversalVoucherId: postingReceipt.voucherId,
        postingDate: review.input.postingDate,
        committedAt: postingReceipt.committedAt,
        amountMinor: review.snapshot.invoice.amountMinor,
        reason: review.input.reason,
        postingReceipt,
        cancelled: true,
        legalCreditIssued: false,
        refundInitiated: false,
        delivered: false,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Cancellations.InvoiceCancellationReceipt, {
        ...body,
        digest: yield* digest(body),
      });

      yield* Db.insertCancellation(tx, scope.bookId, result);
      yield* saveCommand(
        tx,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const revokeInvoiceCancellationApproval = Effect.fn("commerce.cancellation.revoke")(
  function* (
    token: string,
    command: {
      scope: Scope;
      id: string;
      idempotencyKey: string;
      input: typeof Cancellations.RevokeInvoiceCancellationApproval.Type;
    },
  ) {
    return yield* withBook(
      token,
      command.scope,
      true,
      function* (tx, principal) {
        const { scope, id, input, idempotencyKey } = command,
          operation = "revoke_invoice_cancellation_approval";

        const request = yield* replay(
          tx,
          scope,
          idempotencyKey,
          operation,
          principal.actorId,
          { id, input },
          Cancellations.InvoiceCancellationRevocation,
        );

        if (request.previous) return request.previous;
        const row = (yield* Db.readApprovalForRevocation(tx, scope.bookId, id))[0];

        if (!row) return yield* failure("NotFound");

        if (row.used) return yield* failure("AlreadyPosted");

        const result = yield* decode(
          Cancellations.InvoiceCancellationRevocation,
          row.revoked ?? {
            approvalId: id,
            actorId: principal.actorId,
            reason: input.reason,
            revokedAt: yield* isoNow(tx),
            receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
          },
        );

        if (!row.revoked) yield* Db.insertRevocation(tx, scope.bookId, result);
        yield* saveCommand(
          tx,
          scope,
          idempotencyKey,
          request.expected,
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
