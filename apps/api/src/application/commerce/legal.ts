import { equalJson } from "@open-erp/domain/canonicalization";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Cancellations from "@open-erp/contracts/invoice-cancellations";
import * as Delivery from "@open-erp/contracts/legal-delivery";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Issuance from "@open-erp/contracts/invoice-issuance";
import * as Policy from "@open-erp/contracts/legal-sales-policy";
import * as Effect from "effect/Effect";
import { digestJson, readEvidence, readInstant } from "../../db/commerce/access";
import * as ArDb from "../../db/commerce/ar-legal";
import * as DocumentDb from "../../db/commerce/documents";
import * as CancellationDb from "../../db/commerce/invoice-cancellations";
import * as DraftDb from "../../db/commerce/invoice-lifecycle";
import * as InvoiceDb from "../../db/commerce/invoices";
import * as LegalPolicyDb from "../../db/commerce/legal-policies";
import { lockBookForUpdate, readAccounts, readOperatorMembership } from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { newId, readPeriod, replay, saveCommand, validatePlan } from "../posting";
import { calculateDraft } from "./draft-calculation";
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
const DraftRevisionSchema = Drafts.InvoiceDraftRevision;
const IssueReceiptSchema = Issuance.InvoiceIssueReceipt;
const CancellationReviewSchema = Cancellations.InvoiceCancellationReview;
const CancellationApprovalSchema = Cancellations.InvoiceCancellationApproval;
const CancellationRevocationSchema = Cancellations.InvoiceCancellationRevocation;
const CancellationReceiptSchema = Cancellations.InvoiceCancellationReceipt;
const CancellationViewSchema = Cancellations.InvoiceCancellationView;
const CancellationStatusSchema = Cancellations.InvoiceCancellationStatus;
const DeliveryRequestSchema = Delivery.LegalDeliveryRequest;
const DeliveryApprovalSchema = Delivery.LegalDeliveryApproval;
const DeliveryAttemptSchema = Delivery.LegalDeliveryAttempt;
const DeliveryReconciliationSchema = Delivery.LegalDeliveryReconciliation;
const DeliveryViewSchema = Delivery.LegalDeliveryView;
const DeliveryHistorySchema = Delivery.LegalDeliveryHistory;

const policyHistoryBound = 50;
const arIssueBound = 50;
const cancellationBound = 50;
const deliveryAttemptBound = 20;
const deliveryHistoryBound = 50;
const legalNumbering = "sequential-per-series-v1";
const vatTreatment = "se-domestic-standard-25-v1";
const roundingMethod = "line-tax-half-up-minor-v1";
const legalRuleVersion = "se-domestic-standard-25-2023-200-v1";
const coreProfile = "synthetic-core-v1";
const latestEffectiveFrom = "2027-12-31";
const reservedSeries = "SYN";
const staleLegalReview = "Review dependencies changed; prepare a new review.";
const legalStandingCodes = new Set([
  "issuance_not_implemented",
  "legal_identity_not_verified",
  "tax_profile_not_activated",
]);
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
      const digests = yield* digestJson(transaction, withoutDigest);
      const digest = digests[0]?.digest;
      if (digest === undefined) return yield* failure("InternalError");
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

export const activateArLegalAccountingProfile = Effect.fn("commerce.legalProfile.activate")(
  function* (
    _token: string,
    _command: {
      scope: Scope;
      idempotencyKey: string;
      input: typeof Ar.ActivateArLegalAccountingProfile.Type;
    },
  ) {
    return yield* unsupported();
  },
);

export const prepareArLegalIssue = Effect.fn("commerce.legalIssue.prepare")(function* (
  _token: string,
  _command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Ar.PrepareArLegalIssue.Type;
  },
) {
  return yield* unsupported();
});

export const approveArLegalIssue = Effect.fn("commerce.legalIssue.approve")(function* (
  _token: string,
  _command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Ar.ApproveArLegalIssue.Type;
  },
) {
  return yield* unsupported();
});

export const executeArLegalIssue = Effect.fn("commerce.legalIssue.execute")(function* (
  _token: string,
  _command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Ar.ExecuteArLegalIssue.Type;
  },
) {
  return yield* unsupported();
});

export const prepareLegalDelivery = Effect.fn("commerce.legalDelivery.prepare")(function* (
  _token: string,
  _command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Delivery.PrepareLegalDelivery.Type;
  },
) {
  return yield* unsupported();
});

export const approveLegalDelivery = Effect.fn("commerce.legalDelivery.approve")(function* (
  _token: string,
  _command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Delivery.ApproveLegalDelivery.Type;
  },
) {
  return yield* unsupported();
});

export const startLegalDeliveryAttempt = Effect.fn("commerce.legalDelivery.start")(function* (
  _token: string,
  _command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Delivery.StartLegalDeliveryAttempt.Type;
  },
) {
  return yield* unsupported();
});

export const reconcileLegalDeliveryAttempt = Effect.fn("commerce.legalDelivery.reconcile")(
  function* (
    _token: string,
    _command: {
      scope: Scope;
      id: string;
      idempotencyKey: string;
      input: typeof Delivery.ReconcileLegalDeliveryAttempt.Type;
    },
  ) {
    return yield* unsupported();
  },
);

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

function legalDeliveryView(
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
        ? yield* Effect.gen(function* () {
            const book = (yield* LegalPolicyDb.readBookProfile(transaction, input.scope.bookId))[0];
            const profile = (yield* DraftDb.readBookProfile(transaction, input.scope.bookId))[0];
            if (!book || !profile) return false;
            if (profile.profile !== coreProfile) return false;
            if (
              book.authority !== "native" ||
              book.currency !== "SEK" ||
              book.currencyScale !== 2
            ) {
              return false;
            }
            return yield* arLegalIssueReviewCurrent(transaction, input.scope, book, review);
          }).pipe(
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

function arLegalIssueReviewCurrent(
  transaction: Transaction,
  scope: Scope,
  book: LegalPolicyDb.PolicyBookRow,
  review: typeof ArIssueReviewSchema.Type,
) {
  return Effect.gen(function* () {
    if (!(yield* arLegalPolicyCurrent(transaction, scope, review))) return false;
    if (!(yield* arLegalAccountingProfileCurrent(transaction, scope, review))) return false;
    const draft = yield* arLegalDraftCurrent(transaction, scope, book, review);
    if (draft === undefined) return false;
    if (!(yield* arLegalTimingCurrent(transaction, scope, book, review, draft))) return false;
    if (!(yield* arLegalAccountsCurrent(transaction, scope, review))) return false;
    return yield* arLegalSourceCurrent(transaction, scope, review);
  });
}

function arLegalPolicyCurrent(
  transaction: Transaction,
  scope: Scope,
  review: typeof ArIssueReviewSchema.Type,
) {
  return Effect.gen(function* () {
    const input = review.input;
    const policy = (yield* LegalPolicyDb.readPolicy(transaction, scope.bookId, input.policyId))[0];
    if (!policy) return false;
    if (input.policyDigest !== textField(policy.body, "digest")) return false;
    const policyInput = objectField(objectField(policy.body, "candidate"), "input");
    if (
      textField(policyInput, "ruleVersion") !== legalRuleVersion ||
      textField(policyInput, "vatTreatment") !== vatTreatment ||
      textField(policyInput, "roundingMethod") !== roundingMethod
    ) {
      return false;
    }
    const snapshot = yield* decode(PolicySchema, policy.body);
    return equalJson(snapshot, review.policySnapshot);
  });
}

function arLegalAccountingProfileCurrent(
  transaction: Transaction,
  scope: Scope,
  review: typeof ArIssueReviewSchema.Type,
) {
  return Effect.gen(function* () {
    const input = review.input;
    const activation = (yield* ArDb.readArLegalAccountingProfile(
      transaction,
      scope.bookId,
      input.accountingProfileId,
    ))[0];
    if (!activation) return false;
    if (textField(activation.body, "policyId") !== input.policyId) return false;
    if (input.accountingProfileDigest !== textField(activation.body, "digest")) return false;
    if (textField(activation.body, "status") !== "active") return false;
    const activationInput = objectField(activation.body, "input");
    if (
      textField(activationInput, "controlAccountId") !== input.controlAccountId ||
      textField(activationInput, "revenueAccountId") !== input.revenueAccountId ||
      textField(activationInput, "outputVatAccountId") !== input.outputVatAccountId
    ) {
      return false;
    }
    const snapshot = yield* decode(AccountingProfileSchema, activation.body);
    return equalJson(snapshot, review.accountingProfileSnapshot);
  });
}

function arLegalDraftCurrent(
  transaction: Transaction,
  scope: Scope,
  book: LegalPolicyDb.PolicyBookRow,
  review: typeof ArIssueReviewSchema.Type,
) {
  return Effect.gen(function* () {
    const input = review.input;
    const head = (yield* DraftDb.readDraftHead(transaction, scope.bookId, input.draftId))[0];
    if (!head) return undefined;
    const draft = yield* decode(DraftRevisionSchema, head.body);
    if (draft.revision !== input.expectedRevision || draft.digest !== input.expectedDigest) {
      return undefined;
    }
    if (!equalJson(draft, review.draftSnapshot)) return undefined;
    if (draft.totals.sourceTotalMatches !== true) return undefined;
    if (draft.blockers.some((blocker) => !legalStandingCodes.has(blocker.code))) return undefined;
    const calculation = yield* calculateDraft(transaction, scope, book, draft.content);
    const current: JsonObject = {
      counterparty: calculation.counterparty,
      sellerEvidence: calculation.sellerEvidence,
      customerEvidence: calculation.customerEvidence,
      totals: calculation.totals,
      calculatedLines: calculation.calculatedLines,
      blockers: calculation.blockers,
    };
    const stored: JsonObject = {
      counterparty: head.body.counterparty ?? null,
      sellerEvidence: head.body.sellerEvidence ?? null,
      customerEvidence: head.body.customerEvidence ?? null,
      totals: head.body.totals ?? null,
      calculatedLines: head.body.calculatedLines ?? null,
      blockers: head.body.blockers ?? null,
    };
    if (!equalJson(current, stored)) return undefined;
    const synthetic = yield* DraftDb.readIssueForDraft(transaction, scope.bookId, input.draftId);
    if (synthetic[0]?.present === true) return undefined;
    const legal = yield* ArDb.readArLegalIssueForDraft(transaction, scope.bookId, input.draftId);
    return legal[0]?.present === true ? undefined : draft;
  });
}

function arLegalTimingCurrent(
  transaction: Transaction,
  scope: Scope,
  book: LegalPolicyDb.PolicyBookRow,
  review: typeof ArIssueReviewSchema.Type,
  draft: typeof DraftRevisionSchema.Type,
) {
  return Effect.gen(function* () {
    const policy = (yield* LegalPolicyDb.readPolicy(
      transaction,
      scope.bookId,
      review.input.policyId,
    ))[0];
    if (!policy) return false;
    const effectiveFrom = textField(
      objectField(objectField(policy.body, "candidate"), "input"),
      "effectiveFrom",
    );
    const issueDate = draft.content.plannedIssueDate;
    const supplyDate = draft.content.supplyDate;
    if (
      effectiveFrom === undefined ||
      issueDate === null ||
      supplyDate === null ||
      draft.content.currency !== "SEK" ||
      draft.content.currencyScale !== 2
    ) {
      return false;
    }
    if (issueDate !== book.today || issueDate < effectiveFrom || supplyDate > issueDate) {
      return false;
    }
    if (supplyDate < effectiveFrom) return false;
    const period = yield* readPeriod(transaction, scope, review.input.accountingPeriodId);
    if (period.locked || period.fiscalYearId !== review.fiscalYearId) return false;
    if (issueDate < period.startsOn || issueDate > period.endsOn) return false;
    return issueDate >= period.fiscalYear.startsOn && issueDate <= period.fiscalYear.endsOn;
  });
}

function arLegalAccountsCurrent(
  transaction: Transaction,
  scope: Scope,
  review: typeof ArIssueReviewSchema.Type,
) {
  return Effect.gen(function* () {
    const input = review.input;
    if (
      input.controlAccountId === input.revenueAccountId ||
      input.controlAccountId === input.outputVatAccountId ||
      input.revenueAccountId === input.outputVatAccountId
    ) {
      return false;
    }
    const accounts = yield* readAccounts(transaction, scope.bookId, [
      input.controlAccountId,
      input.revenueAccountId,
      input.outputVatAccountId,
    ]);
    if (accounts.length !== 3 || accounts.some((account) => !account.active)) return false;
    const control = yield* DraftDb.readControlAccountConflict(
      transaction,
      scope.bookId,
      input.controlAccountId,
      input.revenueAccountId,
    );
    if (control[0]?.conflict === true) return false;
    const vat = yield* DraftDb.readControlAccountConflict(
      transaction,
      scope.bookId,
      input.outputVatAccountId,
      input.outputVatAccountId,
    );
    return vat[0]?.conflict !== true;
  });
}

function arLegalSourceCurrent(
  transaction: Transaction,
  scope: Scope,
  review: typeof ArIssueReviewSchema.Type,
) {
  return Effect.gen(function* () {
    const retained = yield* readEvidence(
      transaction,
      scope.bookId,
      review.sourceEvidence.evidenceId,
    );
    if (retained[0]?.sha256 !== review.sourceEvidence.sha256) return false;
    const posted = yield* DraftDb.readPostedEvidenceHistory(
      transaction,
      scope.bookId,
      review.sourceEvidence.evidenceId,
    );
    return posted[0]?.present !== true;
  });
}

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
            return yield* cancellationReviewCurrent(
              transaction,
              input.scope,
              book,
              review,
              stored.body,
            );
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

function cancellationReviewCurrent(
  transaction: Transaction,
  scope: Scope,
  book: LegalPolicyDb.PolicyBookRow,
  review: typeof CancellationReviewSchema.Type,
  body: JsonObject,
) {
  return Effect.gen(function* () {
    if (book.authority !== "native" || book.currency !== "SEK" || book.currencyScale !== 2) {
      return false;
    }
    const profile = (yield* DraftDb.readBookProfile(transaction, scope.bookId))[0];
    if (!profile || profile.profile !== coreProfile) return false;
    const withoutDigest: JsonObject = Object.fromEntries(
      Object.entries(body).filter(([key]) => key !== "digest"),
    );
    const digests = yield* digestJson(transaction, withoutDigest);
    if (digests[0]?.digest !== review.digest) return false;
    const invoice = review.snapshot.invoice;
    if (review.snapshot.issue.id !== review.input.issueId) return false;
    if (review.snapshot.issue.postingReceipt.voucherId !== invoice.recognition.voucherId) {
      return false;
    }
    if (!(yield* cancellationInvoiceCurrent(transaction, scope, invoice))) return false;
    if (!(yield* cancellationOwnershipCurrent(transaction, scope, invoice))) return false;
    if (!(yield* cancellationResourcesCurrent(transaction, scope, review))) return false;
    yield* validatePlan(transaction, scope, review.postingPlan);
    return true;
  });
}

function cancellationInvoiceCurrent(
  transaction: Transaction,
  scope: Scope,
  invoice: (typeof CancellationReviewSchema.Type)["snapshot"]["invoice"],
) {
  return Effect.gen(function* () {
    const live = (yield* InvoiceDb.readLiveInvoice(transaction, scope.bookId, invoice.id))[0];
    if (!live) return false;
    if (live.body.direction !== "customer" || live.status === "blocked") return false;
    if (live.body.amountMinor !== invoice.amountMinor) return false;
    if (live.body.cancellation !== null && live.body.cancellation !== undefined) return false;
    const current = (yield* DraftDb.readVoucherCurrent(
      transaction,
      scope.bookId,
      invoice.recognition.voucherId,
    ))[0];
    return current?.current === true;
  });
}

function cancellationOwnershipCurrent(
  transaction: Transaction,
  scope: Scope,
  invoice: (typeof CancellationReviewSchema.Type)["snapshot"]["invoice"],
) {
  return Effect.gen(function* () {
    const recognition = (yield* DraftDb.readRecognitionLine(
      transaction,
      scope.bookId,
      invoice.recognition.voucherId,
      invoice.recognition.lineId,
    ))[0];
    if (!recognition || recognition.periodLocked) return false;
    const allocated = yield* CancellationDb.readActiveAllocationLegs(
      transaction,
      scope.bookId,
      invoice.id,
    );
    if (allocated[0]?.present === true) return false;
    const bank = yield* CancellationDb.readBankSourceAccount(
      transaction,
      scope.bookId,
      recognition.accountId,
    );
    if (bank[0]?.present === true) return false;
    const schedule = yield* CancellationDb.readSubledgerBasisForVoucher(
      transaction,
      scope.bookId,
      invoice.recognition.voucherId,
    );
    return schedule[0]?.present !== true;
  });
}

function cancellationResourcesCurrent(
  transaction: Transaction,
  scope: Scope,
  review: typeof CancellationReviewSchema.Type,
) {
  return Effect.gen(function* () {
    const snapshot = review.snapshot;
    const period = (yield* CancellationDb.readRecognitionSourcePeriod(
      transaction,
      scope.bookId,
      snapshot.invoice.recognition.voucherId,
    ))[0];
    if (!period || period.locked) return false;
    if (
      period.id !== snapshot.sourcePeriod.id ||
      period.version !== snapshot.sourcePeriod.version
    ) {
      return false;
    }
    return !snapshot.resources.some(
      (resource) =>
        resource.blocks && !(resource.kind === "invoice" && resource.id === snapshot.invoice.id),
    );
  });
}
