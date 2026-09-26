import { digest as digestNative } from "../json";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Cancellations from "@open-erp/contracts/invoice-cancellations";
import * as Issuance from "@open-erp/contracts/invoice-issuance";
import * as Policy from "@open-erp/contracts/legal-sales-policy";
import * as Effect from "effect/Effect";
import { readInstant } from "../../db/commerce/access";
import * as ArDb from "../../db/commerce/ar-legal";
import * as DocumentDb from "../../db/commerce/documents";
import * as CancellationDb from "../../db/commerce/invoice-cancellations";
import * as DraftDb from "../../db/commerce/invoice-lifecycle";
import { checkedLegalIssue } from "./legal-issue-basis";
import { checkedCancellation } from "./cancellations";
import * as LegalPolicyDb from "../../db/commerce/legal-policies";
import { lockBookForUpdate, readOperatorMembership } from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { newId, replay, saveCommand } from "../posting";
import {
  decode,
  exactKeys,
  objectField,
  requireInsertAccess,
  requireRetainedEvidence,
  requireTableAccess,
  textField,
  toJsonObject,
  unsupported,
  withBook,
  type JsonObject,
  type Scope,
} from "./support";

const ActivateSchema = Policy.ActivateLegalSalesPolicy;

const PolicySchema = Policy.LegalSalesPolicy;

const HistorySchema = Policy.LegalSalesPolicyHistory;

const AccountingProfileSchema = Ar.ArLegalAccountingProfile;

const ArIssueReviewSchema = Ar.ArLegalIssueReview;

const ArIssueApprovalSchema = Ar.ArLegalIssueApproval;

const ArIssueReceiptSchema = Ar.ArLegalIssueReceipt;

const ArIssueViewSchema = Ar.ArLegalIssueView;

const ArIssueHistorySchema = Ar.ArLegalIssueHistory;

const IssueReceiptSchema = Issuance.InvoiceIssueReceipt;

const CancellationReviewSchema = Cancellations.InvoiceCancellationReview;

const CancellationApprovalSchema = Cancellations.InvoiceCancellationApproval;

const CancellationRevocationSchema = Cancellations.InvoiceCancellationRevocation;

const CancellationReceiptSchema = Cancellations.InvoiceCancellationReceipt;

const CancellationViewSchema = Cancellations.InvoiceCancellationView;

const CancellationStatusSchema = Cancellations.InvoiceCancellationStatus;

const policyHistoryBound = 50;

const arIssueBound = 50;

const cancellationBound = 50;

const legalNumbering = "sequential-per-series-v1";

const vatTreatment = "se-domestic-standard-25-v1";

const roundingMethod = "line-tax-half-up-minor-v1";

const latestEffectiveFrom = "2027-12-31";

const reservedSeries = "SYN";

const staleLegalReview = "Review dependencies changed; prepare a new review.";

const staleDependencies = new Set([
  "StaleDependency",
  "PeriodLocked",
  "UnsupportedProfile",
  "NotFound",
  "InvalidJournal",
  "MissingEvidence",
  "AlreadyPosted",
]);

const activationFields = [
  "acceptReviewedPolicy",
  "acknowledgeIssueBlocked",
  "activationEvidence",
  "candidateDigest",
  "candidateId",
  "reason",
  "reviewDigest",
  "reviewId",
  "ruleVersion",
  "series",
  "sourceEvidence",
] as const;

function requireLegalSellerProfile(book: LegalPolicyDb.PolicyBookRow) {
  if (book.authority !== "native" || book.currency !== "SEK" || book.currencyScale !== 2) {
    return unsupported();
  }

  return Effect.void;
}

function requireSupportedRules(candidate: JsonObject, series: string) {
  const input = objectField(candidate, "input");

  if (
    series.startsWith(reservedSeries) ||
    textField(input, "legalNumbering") !== legalNumbering ||
    textField(input, "vatTreatment") !== vatTreatment ||
    textField(input, "roundingMethod") !== roundingMethod
  ) {
    return unsupported();
  }

  return Effect.void;
}

function requireEffectiveFrom(candidate: JsonObject, today: string) {
  const effectiveFrom = textField(objectField(candidate, "input"), "effectiveFrom");

  if (effectiveFrom === undefined || effectiveFrom < today || effectiveFrom > latestEffectiveFrom) {
    return unsupported();
  }

  return Effect.void;
}

function requireSwedishSeller(candidate: JsonObject) {
  const identity = objectField(objectField(candidate, "input"), "sellerIdentity");
  const vatRegistrationNumber = identity.vatRegistrationNumber;
  const registrationNumber = textField(identity, "registrationNumber");

  if (
    textField(identity, "countryCode") !== "SE" ||
    typeof vatRegistrationNumber !== "string" ||
    !/^SE[0-9]{12}$/u.test(vatRegistrationNumber) ||
    registrationNumber === undefined ||
    !/^[0-9]{6}-?[0-9]{4}$/u.test(registrationNumber)
  ) {
    return unsupported();
  }

  return Effect.void;
}

function requireIndependentActivation(
  candidateActorId: string,
  reviewActorId: string,
  actorId: string,
  candidateDigest: string,
  reviewDigest: string,
) {
  if (candidateActorId === actorId || reviewActorId === actorId) return failure("ApprovalRequired");

  if (candidateDigest.length === 0 || reviewDigest.length === 0) return failure("StaleDependency");

  return Effect.void;
}

function retainedNow(transaction: Transaction) {
  return readInstant(transaction).pipe(
    Effect.flatMap((rows) => {
      const instant = rows[0]?.instant;

      return instant === undefined ? failure("InternalError") : Effect.succeed(instant);
    }),
  );
}

export const activateLegalSalesPolicy = Effect.fn("commerce.legalPolicy.activate")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Policy.ActivateLegalSalesPolicy.Type;
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
        "activate_ar_legal_policy",
        principal.actorId,
        command.input,
        PolicySchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, LegalPolicyDb.legalSalesPolicyTables, false);
      yield* requireInsertAccess(transaction, ["ar_legal_policies"]);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* exactKeys(yield* toJsonObject(command.input), activationFields);
      const input = yield* decode(ActivateSchema, command.input);
      const book = (yield* LegalPolicyDb.readBookProfile(transaction, command.scope.bookId))[0];

      if (!book) return yield* failure("Forbidden");
      yield* requireLegalSellerProfile(book);

      const candidate = (yield* LegalPolicyDb.readCandidate(
        transaction,
        command.scope.bookId,
        input.candidateId,
      ))[0];

      const review = (yield* LegalPolicyDb.readReview(
        transaction,
        command.scope.bookId,
        input.reviewId,
        input.candidateId,
      ))[0];

      if (!candidate || !review) return yield* failure("NotFound");

      if (
        input.candidateDigest !== textField(candidate.body, "digest") ||
        input.reviewDigest !== textField(review.body, "digest") ||
        textField(objectField(review.body, "input"), "candidateDigest") !==
          textField(candidate.body, "digest")
      ) {
        return yield* failure("StaleDependency");
      }

      yield* requireIndependentActivation(
        candidate.actorId,
        review.actorId,
        principal.actorId,
        input.candidateDigest,
        input.reviewDigest,
      );
      yield* requireSupportedRules(candidate.body, input.series);
      yield* requireEffectiveFrom(candidate.body, book.today);
      yield* requireSwedishSeller(candidate.body);
      yield* requireRetainedEvidence(
        transaction,
        command.scope.bookId,
        yield* toJsonObject(input.sourceEvidence),
      );
      yield* requireRetainedEvidence(
        transaction,
        command.scope.bookId,
        yield* toJsonObject(input.activationEvidence),
      );

      if (input.reason.trim().length === 0) return yield* failure("InvalidJournal");
      const count = yield* LegalPolicyDb.readPolicyCount(transaction, command.scope.bookId);

      if ((count[0]?.count ?? 0) >= policyHistoryBound) return yield* unsupported();

      const activated = yield* LegalPolicyDb.readPolicyForCandidate(
        transaction,
        command.scope.bookId,
        input.candidateId,
      );

      if (activated[0]?.present === true) return yield* failure("IdempotencyConflict");

      const series = yield* LegalPolicyDb.readPolicyForSeries(
        transaction,
        command.scope.bookId,
        input.series,
      );

      if (series[0]?.present === true) return yield* failure("IdempotencyConflict");

      const withoutDigest: JsonObject = {
        id: newId("ar_policy"),
        scope: command.scope,
        candidate: candidate.body,
        review: review.body,
        input,
        activatedBy: principal.actorId,
        activatedAt: yield* retainedNow(transaction),
        status: "active",
        legalInvoiceEnabled: false,
        creditEnabled: false,
        deliveryEnabled: false,
      };

      const digest = yield* digestNative(withoutDigest);
      const body: JsonObject = Object.assign({}, withoutDigest, { digest });
      const result = yield* decode(PolicySchema, body);
      yield* LegalPolicyDb.insertPolicy(transaction, {
        bookId: command.scope.bookId,
        id: result.id,
        candidateId: input.candidateId,
        reviewId: input.reviewId,
        series: input.series,
        actorId: principal.actorId,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "activate_ar_legal_policy",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const readLegalSalesPolicyHistory = Effect.fn("commerce.legalPolicy.history")(function* (
  token: string,
  input: { scope: Scope },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, LegalPolicyDb.legalSalesPolicyTables, false);

    const rows = yield* LegalPolicyDb.readPolicyHistory(
      transaction,
      input.scope.bookId,
      policyHistoryBound,
    );

    if (rows.length > policyHistoryBound) return yield* unsupported();

    return yield* decode(HistorySchema, {
      scope: input.scope,
      complete: true,
      items: rows.map((row) => row.body),
    });
  });
});

export const getLegalSalesPolicy = Effect.fn("commerce.legalPolicy.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, LegalPolicyDb.legalSalesPolicyTables, false);
    const rows = yield* LegalPolicyDb.readPolicy(transaction, input.scope.bookId, input.id);
    const policy = rows[0];

    if (!policy) return yield* failure("NotFound");

    return yield* decode(PolicySchema, policy.body);
  });
});

export {
  activateArLegalAccountingProfile,
  prepareArLegalIssue,
  approveArLegalIssue,
  executeArLegalIssue,
} from "./legal-issuance";

export {
  prepareLegalDelivery,
  approveLegalDelivery,
  startLegalDeliveryAttempt,
  reconcileLegalDeliveryAttempt,
  getLegalDelivery,
  readLegalDeliveryHistory,
} from "./legal-delivery";

export const getArLegalAccountingProfile = Effect.fn("commerce.legalProfile.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, ArDb.arLegalAccountingProfileTables, false);

    const profile = (yield* ArDb.readArLegalAccountingProfile(
      transaction,
      input.scope.bookId,
      input.id,
    ))[0];

    if (!profile) return yield* failure("NotFound");

    return yield* decode(AccountingProfileSchema, profile.body);
  });
});

export const getArLegalIssueReview = Effect.fn("commerce.legalIssue.review")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction, principal) {
    yield* requireTableAccess(transaction, ArDb.arLegalIssueTables, false);

    const stored = (yield* ArDb.readArLegalIssueReview(
      transaction,
      input.scope.bookId,
      input.id,
    ))[0];

    if (!stored) return yield* failure("NotFound");
    const review = yield* decode(ArIssueReviewSchema, stored.body);

    const approvalRow = (yield* ArDb.readLatestArLegalIssueApproval(
      transaction,
      input.scope.bookId,
      input.id,
    ))[0];

    const issued = (yield* ArDb.readArLegalIssueForReview(
      transaction,
      input.scope.bookId,
      input.id,
    ))[0];

    const current =
      issued === undefined
        ? yield* checkedLegalIssue(transaction, input.scope, review.id, review.digest).pipe(
            Effect.as(true),
            Effect.catchIf(
              (error) =>
                error instanceof Accounting.AccountingError && staleDependencies.has(error.code),
              () => Effect.succeed(false),
            ),
          )
        : false;

    let approvalUsable = false;

    if (current && approvalRow !== undefined && approvalRow.actorId === principal.actorId) {
      approvalUsable = approvalRow.expiresAt > (yield* retainedNow(transaction));
    }

    return yield* decode(ArIssueViewSchema, {
      review,
      approval:
        approvalRow === undefined ? null : yield* decode(ArIssueApprovalSchema, approvalRow.body),
      issue: issued === undefined ? null : yield* decode(ArIssueReceiptSchema, issued.body),
      blockers: current ? [] : [staleLegalReview],
      approvalUsable,
    });
  });
});

export const getArLegalIssue = Effect.fn("commerce.legalIssue.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, ArDb.arLegalIssueReceiptTables, false);
    const issue = (yield* DocumentDb.readLegalIssue(transaction, input.scope.bookId, input.id))[0];

    if (!issue) return yield* failure("NotFound");

    return yield* decode(ArIssueReceiptSchema, issue.body);
  });
});

export const arLegalIssueHistory = Effect.fn("commerce.legalIssue.history")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, DraftDb.invoiceDraftTables, false);
    yield* requireTableAccess(transaction, ArDb.arLegalIssueTables, false);
    const draft = (yield* DraftDb.readDraft(transaction, input.scope.bookId, input.id, false))[0];

    if (!draft) return yield* failure("NotFound");

    const rows = yield* ArDb.readArLegalIssueHistory(
      transaction,
      input.scope.bookId,
      input.id,
      arIssueBound,
    );

    if (rows.length > arIssueBound) return yield* failure("InvalidJournal");

    return yield* decode(ArIssueHistorySchema, {
      scope: input.scope,
      draftId: input.id,
      complete: true,
      count: rows.length,
      items: rows.map((row) => ({
        id: row.id,
        ordinal: row.ordinal,
        digest: row.digest,
        draftRevision: row.draftRevision,
        createdAt: row.createdAt,
        issueId: row.issueId,
        legalDocumentNumber: row.legalDocumentNumber,
      })),
    });
  });
});

export const getInvoiceCancellation = Effect.fn("commerce.cancellation.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction, principal) {
    yield* requireTableAccess(transaction, CancellationDb.invoiceCancellationTables, false);

    const stored = (yield* CancellationDb.readInvoiceCancellationReview(
      transaction,
      input.scope.bookId,
      input.id,
    ))[0];

    if (!stored) return yield* failure("NotFound");
    const review = yield* decode(CancellationReviewSchema, stored.body);

    const approvalRows = yield* CancellationDb.readInvoiceCancellationApprovals(
      transaction,
      input.scope.bookId,
      input.id,
    );

    if (approvalRows.length > cancellationBound) return yield* failure("InvalidJournal");

    const receipt = (yield* CancellationDb.readInvoiceCancellationReceiptForReview(
      transaction,
      input.scope.bookId,
      input.id,
    ))[0];

    const latest = approvalRows.at(-1);

    const dependenciesCurrent =
      receipt === undefined
        ? yield* Effect.gen(function* () {
            const book = (yield* LegalPolicyDb.readBookProfile(transaction, input.scope.bookId))[0];

            if (!book) return false;

            return yield* checkedCancellation(
              transaction,
              input.scope,
              review.id,
              review.digest,
            ).pipe(Effect.as(true));
          }).pipe(
            Effect.catchIf(
              (error) =>
                error instanceof Accounting.AccountingError && staleDependencies.has(error.code),
              () => Effect.succeed(false),
            ),
          )
        : false;

    let approvalUsable = false;

    if (dependenciesCurrent && latest !== undefined) {
      const approver = yield* readOperatorMembership(
        transaction,
        input.scope.bookId,
        latest.actorId,
      );

      const now = yield* retainedNow(transaction);
      approvalUsable =
        approver.length > 0 &&
        latest.actorId === principal.actorId &&
        latest.revocation === null &&
        latest.expiresAt > now;
    }

    return yield* decode(CancellationViewSchema, {
      review,
      approval:
        latest === undefined ? null : yield* decode(CancellationApprovalSchema, latest.body),
      approvals: yield* Effect.forEach(approvalRows, (row) =>
        Effect.gen(function* () {
          const approval = yield* decode(CancellationApprovalSchema, row.body);

          const revocation =
            row.revocation === null
              ? null
              : yield* decode(CancellationRevocationSchema, row.revocation);

          return { approval, revocation };
        }),
      ),
      cancellation:
        receipt === undefined ? null : yield* decode(CancellationReceiptSchema, receipt.body),
      dependenciesCurrent,
      approvalUsable,
    });
  });
});

export const getInvoiceCancellationStatus = Effect.fn("commerce.cancellation.status")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, CancellationDb.invoiceCancellationTables, false);

    const issue = (yield* DocumentDb.readIssueWithReview(
      transaction,
      input.scope.bookId,
      input.id,
      "share",
    ))[0];

    if (!issue) return yield* failure("NotFound");

    const receipt = (yield* CancellationDb.readInvoiceCancellationReceiptForIssue(
      transaction,
      input.scope.bookId,
      input.id,
    ))[0];

    const reviews = yield* CancellationDb.readInvoiceCancellationReviewSummaries(
      transaction,
      input.scope.bookId,
      input.id,
      cancellationBound,
    );

    return yield* decode(CancellationStatusSchema, {
      scope: input.scope,
      issue: yield* decode(IssueReceiptSchema, issue.issue),
      cancellation:
        receipt === undefined ? null : yield* decode(CancellationReceiptSchema, receipt.body),
      complete: true,
      reviews: reviews.map((row) => ({
        id: row.id,
        digest: row.digest,
        createdAt: row.createdAt,
        reason: row.reason,
      })),
    });
  });
});
