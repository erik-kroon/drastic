import { digest as digestNative } from "../json";
import * as Policy from "@open-erp/contracts/invoice-policy";
import * as Effect from "effect/Effect";

import * as PolicyDb from "../../db/commerce/invoice-policy";
import type { Transaction } from "../../db/transaction";
import { isoNow, newId, replay, saveCommand } from "../posting";
import { lockBookForUpdate } from "../../db/posting";
import { failure } from "../failures";
import { decode, requireTableAccess, withBook, type JsonObject, type Scope } from "./support";

const CandidateSchema = Policy.InvoicePolicyCandidate;

const ReviewSchema = Policy.InvoicePolicyReview;

const CandidateInputSchema = Policy.InvoicePolicyCandidateInput;

const ReviewInputSchema = Policy.ReviewInvoicePolicy;

const ViewSchema = Policy.InvoicePolicyView;

const HistorySchema = Policy.InvoicePolicyHistory;

const evidenceFields = [
  "sellerEvidence",
  "numberingEvidence",
  "vatEvidence",
  "roundingEvidence",
  "correctionEvidence",
] as const;

function requireRetainedEvidence(
  transaction: Transaction,
  bookId: string,
  references: ReadonlyArray<JsonObject>,
) {
  return Effect.forEach(references, (reference) =>
    PolicyDb.readPolicyEvidence(transaction, bookId, reference).pipe(
      Effect.flatMap((rows) =>
        rows[0]?.present === true ? Effect.void : failure("MissingEvidence"),
      ),
    ),
  );
}

function policyView(row: PolicyDb.PolicyHistoryRow) {
  return {
    candidate: row.body,
    review: row.review,
    legalInvoiceEnabled: false,
  } satisfies JsonObject;
}

export const saveCandidate = Effect.fn("commerce.invoicePolicy.saveCandidate")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Policy.InvoicePolicyCandidateInput.Type;
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
        "save_invoice_policy_candidate",
        principal.actorId,
        command.input,
        CandidateSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, PolicyDb.invoicePolicyTables, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const input = yield* decode(CandidateInputSchema, command.input);

      const existing = yield* PolicyDb.readCandidateByProfileKey(
        transaction,
        command.scope.bookId,
        input.profileKey,
      );

      if (existing.length > 0) return yield* failure("IdempotencyConflict");
      yield* requireRetainedEvidence(
        transaction,
        command.scope.bookId,
        evidenceFields.map((field) => input[field]),
      );
      const counts = yield* PolicyDb.readCandidateCount(transaction, command.scope.bookId);

      if ((counts[0]?.count ?? 0) >= 50) return yield* failure("UnsupportedProfile");

      const withoutDigest: JsonObject = {
        id: newId("invoice_policy"),
        scope: command.scope,
        input,
        status: "unactivated",
        createdBy: principal.actorId,
        createdAt: yield* isoNow(transaction),
      };

      const digest = yield* digestNative(withoutDigest);
      const body: JsonObject = Object.assign({}, withoutDigest, { digest });

      if (JSON.stringify(body).length > 131072) return yield* failure("UnsupportedProfile");
      const result = yield* decode(CandidateSchema, body);
      yield* PolicyDb.insertCandidate(transaction, {
        bookId: command.scope.bookId,
        id: result.id,
        profileKey: input.profileKey,
        actorId: principal.actorId,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "save_invoice_policy_candidate",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const reviewCandidate = Effect.fn("commerce.invoicePolicy.reviewCandidate")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Policy.ReviewInvoicePolicy.Type;
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
        "review_invoice_policy_candidate",
        principal.actorId,
        replayInput,
        ReviewSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, PolicyDb.invoicePolicyTables, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const input = yield* decode(ReviewInputSchema, command.input);
      const rows = yield* PolicyDb.readCandidate(transaction, command.scope.bookId, command.id);
      const candidate = rows[0];

      if (!candidate) return yield* failure("NotFound");

      if (input.candidateDigest !== candidate.body.digest) return yield* failure("StaleDependency");

      if (candidate.actorId === principal.actorId) return yield* failure("ApprovalRequired");
      yield* requireRetainedEvidence(transaction, command.scope.bookId, [input.reviewEvidence]);

      const reviews = yield* PolicyDb.readReviewForCandidate(
        transaction,
        command.scope.bookId,
        command.id,
      );

      if (reviews.length > 0) return yield* failure("IdempotencyConflict");

      const withoutDigest: JsonObject = {
        id: newId("invoice_policy_review"),
        scope: command.scope,
        candidateId: command.id,
        input,
        createdBy: principal.actorId,
        createdAt: yield* isoNow(transaction),
        status: "reviewed_unactivated",
        legalInvoiceEnabled: false,
      };

      const digest = yield* digestNative(withoutDigest);
      const body: JsonObject = Object.assign({}, withoutDigest, { digest });
      const result = yield* decode(ReviewSchema, body);
      yield* PolicyDb.insertReview(transaction, {
        bookId: command.scope.bookId,
        id: result.id,
        candidateId: candidate.id,
        actorId: principal.actorId,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "review_invoice_policy_candidate",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const getCandidate = Effect.fn("commerce.invoicePolicy.getCandidate")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, PolicyDb.invoicePolicyTables, false);

    const rows = yield* PolicyDb.readPolicyCandidateWithReview(
      transaction,
      input.scope.bookId,
      input.id,
    );

    const row = rows[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(ViewSchema, policyView(row));
  });
});

export const readHistory = Effect.fn("commerce.invoicePolicy.readHistory")(function* (
  token: string,
  input: { scope: Scope },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, PolicyDb.invoicePolicyTables, false);
    const rows = yield* PolicyDb.readPolicyHistory(transaction, input.scope.bookId);

    return yield* decode(HistorySchema, {
      scope: input.scope,
      complete: true,
      items: rows.map(policyView),
    });
  });
});
