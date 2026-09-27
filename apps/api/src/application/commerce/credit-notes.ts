import * as Accounting from "@open-erp/contracts/accounting";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Credits from "@open-erp/contracts/customer-credit-notes";
import * as Policy from "@open-erp/contracts/legal-sales-policy";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as ArDb from "../../db/commerce/ar-legal";
import * as CreditDb from "../../db/commerce/credit-notes";
import * as Policies from "../../db/commerce/legal-policies";
import * as Ledger from "../../db/posting";
import { requireHumanSession } from "../../db/human-actor";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { digest } from "../json";
import {
  approveChangeInTransaction,
  executeChangeInTransaction,
  isoNow,
  newId,
  replay,
  saveCommand,
  sealActionInTransaction,
} from "../posting";
import { decode, toJsonObject, withBook, type Scope } from "./support";
import { liveInvoice } from "./register";
import {
  compileOriginalLineCreditCapacity,
  compileSelectedCredit,
  freezeCreditDocument,
  negativeTaxEffect,
  type LineIds,
} from "./credit-note-basis";

const ReviewSchema = Credits.CustomerCreditReview;

const ApprovalSchema = Credits.CustomerCreditApproval;

const ReceiptSchema = Credits.CustomerCreditReceipt;

const CapacitySchema = Credits.CustomerCreditCapacity;

const ViewSchema = Credits.CustomerCreditView;

const HistorySchema = Credits.CustomerCreditHistory;

const profileLiteral = "se-domestic-b2b-sek-25-accrual-credit-v1" as const;

const historyBound = 50;

const approvalWindow = 3600000;

// The renderer release a credit-note artifact must declare. No credit-note renderer is
// released, so the outbox intent below records this as the required release and nothing
// consumes it yet. The retained semantic revision is what a future renderer reads.
const requiredRendererVersion = Credits.customerCreditRendererVersion;

const receivableFailures: ReadonlyArray<string> = [
  "NotFound",
  "StaleDependency",
  "AlreadyPosted",
  "UnsupportedProfile",
  "InvalidJournal",
  "PeriodLocked",
];

type CapacityRequest = {
  readonly originalLegalIssueId: string;
  readonly originalIssueDigest: string;
  readonly accountingProfileId: string;
  readonly accountingProfileDigest: string;
  readonly accountingPeriodId: string;
  readonly creditDate: string;
};

type Review = typeof Credits.CustomerCreditReview.Type;

function party(identity: Review["originalSnapshot"]["draftSnapshot"]["content"]["seller"]) {
  return {
    legalName: identity.legalName,
    registrationId: identity.registrationId,
    taxId: identity.taxId,
    address: identity.address,
    countryCode: identity.countryCode,
    evidenceId: identity.evidenceId,
  };
}

// The released legal issue owner is the only authority for the original issue, the
// reviewed seller policy and the separately activated accounting profile. A credit
// reuses all three. It never re-prices the original, never reads today's catalog price
// and never reopens a converted order quantity.
const readOriginalBasis = Effect.fn("commerce.customerCredit.original")(function* (
  tx: Transaction,
  scope: Scope,
  request: CapacityRequest,
) {
  const rows = yield* ArDb.readArLegalIssueById(tx, scope.bookId, request.originalLegalIssueId);
  const row = rows[0];

  if (!row) return yield* failure("NotFound");

  const original = yield* decode(Ar.ArLegalIssueReceipt, row.body);
  const body = { ...(yield* toJsonObject(original)) };

  delete body.digest;

  if (original.digest !== request.originalIssueDigest || (yield* digest(body)) !== original.digest)
    return yield* failure("StaleDependency");

  if (row.legalNumber !== original.legalDocumentNumber) return yield* failure("StaleDependency");

  if (row.registerInvoiceId !== original.registerInvoiceId)
    return yield* failure("StaleDependency");

  const policyRow = (yield* Policies.readPolicy(tx, scope.bookId, original.policyId))[0];

  if (!policyRow) return yield* failure("UnsupportedProfile");

  const policy = yield* decode(Policy.LegalSalesPolicy, policyRow.body);

  if (policy.id !== original.policyId || policy.digest !== original.policyDigest)
    return yield* failure("StaleDependency");

  if (
    policy.status !== "active" ||
    policy.input.ruleVersion !== "se-domestic-standard-25-2023-200-v1" ||
    policy.candidate.input.vatTreatment !== "se-domestic-standard-25-v1" ||
    policy.candidate.input.roundingMethod !== "line-tax-half-up-minor-v1"
  )
    return yield* failure("UnsupportedProfile");

  const profileRow = (yield* ArDb.readArLegalAccountingProfile(
    tx,
    scope.bookId,
    request.accountingProfileId,
  ))[0];

  if (!profileRow) return yield* failure("UnsupportedProfile");

  const profile = yield* decode(Ar.ArLegalAccountingProfile, profileRow.body);

  if (
    profile.digest !== request.accountingProfileDigest ||
    profile.status !== "active" ||
    profile.policyId !== original.policyId ||
    profile.digest !== original.accountingProfileDigest
  )
    return yield* failure("StaleDependency");

  if (profile.input.effectiveFrom > request.creditDate) return yield* failure("UnsupportedProfile");

  const accounts = profile.input;
  const originalAccounts = original.accountingProfileSnapshot.input;

  if (
    accounts.controlAccountId !== originalAccounts.controlAccountId ||
    accounts.revenueAccountId !== originalAccounts.revenueAccountId ||
    accounts.outputVatAccountId !== originalAccounts.outputVatAccountId
  )
    return yield* failure("StaleDependency");

  const invoice = yield* liveInvoice(tx, scope.bookId, original.registerInvoiceId);
  const outstandingMinor = invoice.outstandingMinor;

  if (invoice.direction !== "customer") return yield* failure("UnsupportedProfile");

  if (outstandingMinor === null) return yield* failure("StaleDependency");

  if (invoice.documentNumber !== original.legalDocumentNumber)
    return yield* failure("StaleDependency");

  if (invoice.kind !== "legal_customer_invoice_v1") return yield* failure("UnsupportedProfile");

  if (invoice.recognition.voucherId !== original.postingReceipt.voucherId)
    return yield* failure("StaleDependency");

  return { original, policy, profile, invoice, outstandingMinor };
});

const readCreditCapacity = Effect.fn("commerce.customerCredit.readCapacity")(function* (
  tx: Transaction,
  scope: Scope,
  request: CapacityRequest,
) {
  const basis = yield* readOriginalBasis(tx, scope, request);
  const original = basis.original;

  const creditPeriod = (yield* CreditDb.readTaxPeriod(
    tx,
    scope.bookId,
    request.accountingPeriodId,
  ))[0];

  const recognition = (yield* CreditDb.readRecognition(
    tx,
    scope.bookId,
    original.postingReceipt.voucherId,
    basis.invoice.recognition.lineId,
  ))[0];

  if (!recognition) return yield* failure("StaleDependency");

  if (!creditPeriod) return yield* failure("NotFound");

  if (recognition.controlAccountId !== basis.profile.input.controlAccountId)
    return yield* failure("StaleDependency");

  if (!recognition.recognitionPosted || recognition.recognitionCorrected)
    return yield* failure("StaleDependency");

  if (recognition.debitMinor !== original.totals.grossMinor)
    return yield* failure("StaleDependency");

  const originalPeriod = (yield* CreditDb.readTaxPeriod(tx, scope.bookId, recognition.periodId))[0];

  if (!originalPeriod) return yield* failure("NotFound");

  if (creditPeriod.locked) return yield* failure("PeriodLocked");

  if (request.creditDate < basis.profile.input.effectiveFrom)
    return yield* failure("UnsupportedProfile");

  if (request.creditDate < original.issuedOn) return yield* failure("UnsupportedProfile");

  if (request.creditDate !== recognition.postingDate) {
    if (
      request.creditDate < creditPeriod.startsOn ||
      request.creditDate > creditPeriod.endsOn ||
      request.creditDate < originalPeriod.startsOn ||
      request.creditDate > originalPeriod.endsOn
    )
      return yield* failure("InvalidJournal");
  }

  if (basis.invoice.currency !== "SEK" || basis.invoice.currencyScale !== 2)
    return yield* failure("UnsupportedProfile");

  const prior = yield* CreditDb.readLineCreditTotals(
    tx,
    scope.bookId,
    request.originalLegalIssueId,
  );

  const taxWitness: typeof Credits.CustomerCreditTaxWitness.Type = {
    treatment: "se-domestic-standard-25-v1",
    roundingMethod: "line-tax-half-up-minor-v1",
    ratePercent: 25,
    originalVoucherId: original.postingReceipt.voucherId,
    originalControlLineId: basis.invoice.recognition.lineId,
    originalPostingDate: original.issuedOn,
    originalTaxPeriod: {
      accountingPeriodId: originalPeriod.id,
      fiscalYearId: originalPeriod.fiscalYearId,
      startsOn: originalPeriod.startsOn,
      endsOn: originalPeriod.endsOn,
      qualifiedOn: original.issuedOn,
    },
    vatReturnOwner: "not_released",
    vatReturnConsequence: "unobserved_pending_next_04",
  };

  const compiled = yield* compileOriginalLineCreditCapacity({
    originalLines: original.lines,
    priorCredits: prior,
    unpaidCapacity: {
      registerInvoiceId: original.registerInvoiceId,
      currency: basis.invoice.currency,
      currencyScale: basis.invoice.currencyScale,
      amountMinor: basis.invoice.amountMinor,
      recordedAllocatedMinor: basis.invoice.recordedAllocatedMinor,
      outstandingMinor: basis.outstandingMinor,
      blocked: basis.invoice.status === "blocked",
      status: basis.invoice.status,
    },
    taxPeriod: {
      accountingPeriodId: creditPeriod.id,
      fiscalYearId: creditPeriod.fiscalYearId,
      startsOn: creditPeriod.startsOn,
      endsOn: creditPeriod.endsOn,
      qualifiedOn: request.creditDate,
    },
    recognition: {
      voucherId: recognition.voucherId,
      controlLineId: recognition.controlLineId,
      eventId: recognition.eventId,
      postingDate: recognition.postingDate,
      controlAccountId: recognition.controlAccountId,
      revenueAccountId: basis.profile.input.revenueAccountId,
      outputVatAccountId: basis.profile.input.outputVatAccountId,
      posted: recognition.recognitionPosted,
    },
    taxWitness,
  });

  if (compiled.unpaidCapacity.blocked) return yield* failure("StaleDependency");

  const withoutDigest = {
    scope,
    originalLegalIssueId: original.id,
    originalIssueDigest: original.digest,
    originalDocumentNumber: original.legalDocumentNumber,
    originalIssuedOn: original.issuedOn,
    originalDocumentHash: original.digest,
    originalPolicyId: original.policyId,
    originalPolicyDigest: original.policyDigest,
    accountingProfileId: basis.profile.id,
    accountingProfileDigest: basis.profile.digest,
    profile: profileLiteral,
    lines: compiled.lines,
    totals: compiled.totals,
    unpaidCapacity: compiled.unpaidCapacity,
    taxPeriod: compiled.taxPeriod,
    recognition: compiled.recognition,
    taxWitness: compiled.taxWitness,
    creditCount: compiled.creditCount,
    completelyExhausted: compiled.completelyExhausted,
  };

  return {
    basis,
    creditPeriod,
    capacity: yield* decode(CapacitySchema, {
      ...withoutDigest,
      digest: yield* digest(yield* toJsonObject(withoutDigest)),
    }),
  };
});

/**
 * The original-line credit capacity of one issued legal customer invoice.
 *
 * The accounting period and the credit date are required caller inputs rather than a
 * default, because the credit's qualified tax period is a qualified input. Nothing here
 * is a proposal, so nothing here has an approval or a financial effect.
 */
export const getCustomerCreditCapacity = Effect.fn("commerce.customerCredit.capacityRead")(
  function* (
    token: string,
    command: {
      scope: Scope;
      id: string;
      accountingProfileId: string;
      accountingPeriodId: string;
      creditDate: string;
    },
  ) {
    return yield* withBook(
      token,
      command.scope,
      false,
      function* (tx) {
        const row = (yield* ArDb.readArLegalIssueById(tx, command.scope.bookId, command.id))[0];

        if (!row) return yield* failure("NotFound");

        const original = yield* decode(Ar.ArLegalIssueReceipt, row.body);

        const { capacity } = yield* readCreditCapacity(tx, command.scope, {
          originalLegalIssueId: original.id,
          originalIssueDigest: original.digest,
          accountingProfileId: command.accountingProfileId,
          accountingProfileDigest: original.accountingProfileDigest,
          accountingPeriodId: command.accountingPeriodId,
          creditDate: command.creditDate,
        });

        return capacity;
      },
      "share",
    );
  },
);

export const prepareCustomerCredit = Effect.fn("commerce.customerCredit.prepare")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Credits.PrepareCustomerCredit.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, input, idempotencyKey } = command,
        operation = "prepare_customer_credit";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        input,
        ReviewSchema,
      );

      if (request.previous) return request.previous;

      const { basis, creditPeriod, capacity } = yield* readCreditCapacity(tx, scope, input);

      if (capacity.completelyExhausted) return yield* failure("StaleDependency");

      const counted = yield* CreditDb.countReviews(tx, scope.bookId, input.originalLegalIssueId);
      const ordinal = (counted[0]?.total ?? 0) + 1;

      if (ordinal > historyBound) return yield* failure("UnsupportedProfile");

      const evidence = (yield* Ledger.readEvidence(tx, scope.bookId, input.creditEvidenceId))[0];

      if (!evidence) return yield* failure("MissingEvidence");

      const { original, profile } = basis;
      const id = newId("customer_credit_review");

      const ordered = [...input.selectedLines].sort((a, b) =>
        a.originalLineId < b.originalLineId ? -1 : a.originalLineId > b.originalLineId ? 1 : 0,
      );

      const lineIds = new Map<string, LineIds>(
        ordered.map((line) => [
          line.originalLineId,
          { revenueLineId: newId("line"), outputVatLineId: newId("line") },
        ]),
      );

      const selected = yield* compileSelectedCredit(capacity, input.selectedLines, lineIds);
      const controlLineId = newId("line");

      const controlLine = {
        lineId: controlLineId,
        accountId: profile.input.controlAccountId,
        debitMinor: "0",
        creditMinor: selected.grossMinor,
        description: `Reduce customer receivable ${original.legalDocumentNumber}`,
      };

      const actionLines = [
        controlLine,
        ...selected.lines.flatMap((line) => {
          const lines = [
            {
              lineId: line.revenueLineId,
              accountId: profile.input.revenueAccountId,
              debitMinor: line.creditedNetMinor,
              creditMinor: "0",
              description: `Return domestic sales ${original.legalDocumentNumber}`,
            },
          ];

          if (line.outputVatLineId !== null) {
            lines.push({
              lineId: line.outputVatLineId,
              accountId: profile.input.outputVatAccountId,
              debitMinor: line.creditedTaxMinor,
              creditMinor: "0",
              description: `Return domestic output VAT ${original.legalDocumentNumber}`,
            });
          }

          return lines;
        }),
      ];

      for (const line of actionLines)
        if (BigInt(line.debitMinor) === 0n && BigInt(line.creditMinor) === 0n)
          return yield* failure("InvalidJournal");

      const eventKey = `legal_credit_review_${id.slice("customer_credit_review_".length)}`;

      const event =
        (yield* Ledger.readEvent(tx, scope.bookId, input.creditEvidenceId, eventKey))[0] ??
        (yield* Ledger.insertEvent(
          tx,
          scope.bookId,
          newId("event"),
          input.creditEvidenceId,
          eventKey,
        ))[0];

      if (!event) return yield* failure("InternalError");

      const action = yield* decode(Accounting.VoucherPostingAction, {
        kind: "post_voucher",
        correctsVoucherId: null,
        eventId: event.id,
        postingPurpose: "legal_customer_credit_v1",
        occurrenceKey: eventKey,
        fiscalYearId: creditPeriod.fiscalYearId,
        accountingPeriodId: creditPeriod.id,
        postingDate: input.creditDate,
        series: input.voucherSeries,
        currency: "SEK",
        description: `Legal customer credit note for invoice ${original.legalDocumentNumber}`,
        rationale: input.reason,
        taxAssessment: "se-domestic-standard-25-v1",
        lines: actionLines,
        evidenceRefs: [
          { evidenceId: input.creditEvidenceId, sha256: evidence.sha256, locator: eventKey },
          {
            evidenceId: original.sourceEvidence.evidenceId,
            sha256: original.sourceEvidence.sha256,
            locator: `original_legal_issue_${original.id}`,
          },
        ],
        legalCredit: {
          profile: profileLiteral,
          policyId: original.policyId,
          reviewId: id,
          originalIssueId: original.id,
          originalDocumentNumber: original.legalDocumentNumber,
          creditedLineCount: selected.lines.length,
          netMinor: selected.netMinor,
          taxMinor: selected.taxMinor,
        },
      });

      const plan = yield* sealActionInTransaction(tx, principal, scope, action, true);

      const body = {
        id,
        scope,
        version: 1 as const,
        profile: input.profile,
        ordinal,
        input,
        originalSnapshot: original,
        capacity,
        controlLineId,
        lines: selected.lines,
        totals: {
          netMinor: selected.netMinor,
          taxMinor: selected.taxMinor,
          grossMinor: selected.grossMinor,
        },
        creditSeries: original.policySnapshot.input.series,
        creditEvidence: {
          basis: "retained_credit_evidence_v1" as const,
          evidenceId: input.creditEvidenceId,
          sha256: evidence.sha256,
        },
        unpaidBeforeMinor: selected.unpaidBeforeMinor,
        unpaidAfterMinor: selected.unpaidAfterMinor,
        taxCorrections: selected.lines.map((line, index) =>
          negativeTaxEffect(line, {
            id: newId("customer_credit_tax"),
            ordinal: index + 1,
            originalVoucherId: original.postingReceipt.voucherId,
            originalControlLineId: basis.invoice.recognition.lineId,
            originalPostingDate: original.issuedOn,
            originalEvidenceId: original.sourceEvidence.evidenceId,
            taxPeriod: capacity.taxPeriod,
            creditVoucherId: null,
            controlLineId: null,
          }),
        ),
        taxConsequenceObserved: false as const,
        postingPlan: plan,
        createdAt: yield* isoNow(tx),
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(ReviewSchema, { ...body, digest: yield* digest(body) });

      if (new TextEncoder().encode(JSON.stringify(result)).length > 524288)
        return yield* failure("InvalidJournal");

      yield* CreditDb.insertReview(tx, scope.bookId, result, {
        changeSetId: plan.id,
        eventId: event.id,
        evidenceId: input.creditEvidenceId,
      });
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

// The re-derived basis must equal the sealed one exactly. A payment, an earlier credit,
// a corrected recognition voucher, a changed account or a moved tax period is a refusal
// rather than a silently recalculated credit, and the day rollover that would post the
// credit into a different accounting day is refused before any number is allocated.
const checkedCustomerCredit = Effect.fn("commerce.customerCredit.checked")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expected: string,
  today: string,
) {
  const row = (yield* CreditDb.readReview(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");

  const review = yield* decode(ReviewSchema, row.body);
  const body = { ...(yield* toJsonObject(review)) };

  delete body.digest;

  if (review.digest !== expected || (yield* digest(body)) !== review.digest)
    return yield* failure("StaleDependency");

  const { capacity } = yield* readCreditCapacity(tx, scope, review.input);

  if (!equalJson(capacity, review.capacity)) return yield* failure("StaleDependency");

  if (review.input.creditDate !== today) return yield* failure("StaleDependency");

  return review;
});

export const approveCustomerCredit = Effect.fn("commerce.customerCredit.approve")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Credits.ApproveCustomerCredit.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireHumanSession(principal);

      const { scope, id, input, idempotencyKey } = command,
        operation = "approve_customer_credit";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        ApprovalSchema,
      );

      if (request.previous) return request.previous;

      const review = yield* checkedCustomerCredit(
        tx,
        scope,
        id,
        input.digest,
        (yield* isoNow(tx)).slice(0, 10),
      );

      if (review.receipt.actorId === principal.actorId) return yield* failure("ApprovalRequired");

      const approvals = yield* CreditDb.readApprovals(tx, scope.bookId, id);
      const ordinal = approvals.length + 1;

      if (ordinal > historyBound) return yield* failure("UnsupportedProfile");

      const now = yield* isoNow(tx);

      const result = yield* decode(ApprovalSchema, {
        id: newId("customer_credit_approval"),
        scope,
        reviewId: id,
        digest: review.digest,
        version: 1,
        actorId: principal.actorId,
        ordinal,
        expiresAt: new Date(Date.parse(now) + approvalWindow).toISOString(),
        createdAt: now,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      });

      yield* CreditDb.insertApproval(tx, scope.bookId, result);
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

export const executeCustomerCredit = Effect.fn("commerce.customerCredit.execute")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Credits.ExecuteCustomerCredit.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, id, input, idempotencyKey } = command,
        operation = "execute_customer_credit";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        ReceiptSchema,
      );

      if (request.previous) return request.previous;

      const issuedAt = yield* isoNow(tx);

      const review = yield* checkedCustomerCredit(
        tx,
        scope,
        id,
        input.digest,
        issuedAt.slice(0, 10),
      );

      const found = (yield* CreditDb.readApprovals(tx, scope.bookId, id)).find(
        (row) => row.id === input.approvalId,
      );

      if (!found) return yield* failure("ApprovalRequired");

      const approval = yield* decode(ApprovalSchema, found.body);

      // The approver is the executor, so the executor's own credential, session,
      // membership and book authority are the ones already re-resolved inside this
      // transaction. A revoked or expired approver therefore cannot execute, and an
      // approval is never a reusable permission held by someone else.
      if (
        approval.actorId !== principal.actorId ||
        approval.digest !== review.digest ||
        Date.parse(approval.expiresAt) <= Date.parse(issuedAt)
      )
        return yield* failure("ApprovalRequired");

      // One retained credit decision yields at most one issued legal credit, so a new
      // request key over the same reviewed decision is the same credit and not a second
      // one. The unique index on the issued credit is the structural backstop.
      if (
        (yield* CreditDb.readCreditByEvidence(tx, scope.bookId, review.creditEvidence.evidenceId))
          .length
      )
        return yield* failure("AlreadyPosted");

      const original = review.originalSnapshot;

      // Numbering continues the reviewed issue policy's own series through its existing
      // rollback-safe counter. It is allocated inside the issuing transaction, after the
      // day boundary has been re-checked and before any row of the group is written.
      const number = (yield* ArDb.allocateLegalNumber(tx, scope.bookId, original.policyId))[0]
        ?.number;

      if (!number) return yield* failure("UnsupportedProfile");

      const plan = review.postingPlan;

      const kernel = yield* approveChangeInTransaction(tx, principal, {
        scope,
        changeSetId: plan.id,
        idempotencyKey: newId("customer_credit_approve"),
        input: { version: 1, planDigest: plan.planDigest },
        owner: { kind: "legal_credit", id: review.id },
      });

      const postingReceipt = yield* executeChangeInTransaction(tx, principal, {
        scope,
        changeSetId: plan.id,
        idempotencyKey: newId("customer_credit_post"),
        input: { version: 1, planDigest: plan.planDigest, approvalId: kernel.id },
        owner: { kind: "legal_credit", id: review.id },
      });

      const creditId = newId("customer_credit");
      const documentId = newId("customer_credit_document");
      const creditSeries = review.creditSeries;

      const corrections = review.taxCorrections.map((correction) => ({
        ...correction,
        creditVoucherId: postingReceipt.voucherId,
        controlLineId: review.controlLineId,
      }));

      const document = yield* freezeCreditDocument({
        scope,
        documentId,
        creditId,
        creditSeries,
        creditNumber: number,
        creditDate: review.input.creditDate,
        originalLegalIssueId: original.id,
        originalDocumentNumber: original.legalDocumentNumber,
        originalDocumentHash: original.digest,
        originalIssuedOn: original.issuedOn,
        originalCreditNoteReference: null,
        counterpartyId: original.draftSnapshot.content.counterpartyId,
        counterpartyRevision: original.draftSnapshot.content.counterpartyRevision,
        counterpartyName: original.draftSnapshot.content.customer.legalName,
        currency: review.capacity.unpaidCapacity.currency,
        currencyScale: review.capacity.unpaidCapacity.currencyScale,
        reason: review.input.reason,
        evidence: review.creditEvidence,
        seller: party(original.draftSnapshot.content.seller),
        customer: party(original.draftSnapshot.content.customer),
        lines: review.lines,
        netMinor: review.totals.netMinor,
        taxMinor: review.totals.taxMinor,
        grossMinor: review.totals.grossMinor,
        taxWitness: review.capacity.taxWitness,
        createdAt: issuedAt,
      });

      const body = {
        id: creditId,
        scope,
        profile: review.profile,
        reviewId: review.id,
        reviewDigest: review.digest,
        approvalId: approval.id,
        creditSeries,
        legalDocumentNumber: `${creditSeries}-${number}`,
        issuedOn: review.input.creditDate,
        issuedAt,
        issued: true as const,
        legalCredit: true as const,
        recognized: true as const,
        originalLegalIssueId: original.id,
        originalIssueDigest: original.digest,
        originalDocumentNumber: original.legalDocumentNumber,
        originalDocumentHash: original.digest,
        originalIssuedOn: original.issuedOn,
        registerInvoiceId: original.registerInvoiceId,
        lines: review.lines,
        totals: review.totals,
        creditEvidence: review.creditEvidence,
        unpaidBeforeMinor: review.unpaidBeforeMinor,
        unpaidAfterMinor: review.unpaidAfterMinor,
        taxCorrections: corrections,
        taxConsequenceObserved: false as const,
        semanticDocument: document,
        postingReceipt,
        artifactState: "issued_artifact_pending" as const,
        refundState: "not_refunded" as const,
        createdAt: issuedAt,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(ReceiptSchema, { ...body, digest: yield* digest(body) });

      if (new TextEncoder().encode(JSON.stringify(result)).length > 524288)
        return yield* failure("InvalidJournal");

      yield* CreditDb.insertCredit(tx, scope.bookId, result, {
        creditNumber: number,
        periodId: review.input.accountingPeriodId,
        voucherId: postingReceipt.voucherId,
        controlLineId: review.controlLineId,
      });

      for (const [index, line] of review.lines.entries())
        yield* CreditDb.insertLineCredit(
          tx,
          scope.bookId,
          creditId,
          index + 1,
          line.originalLineId,
          line.creditedNetMinor,
          line.creditedTaxMinor,
          line.creditedGrossMinor,
          yield* toJsonObject({
            creditId,
            reviewId: review.id,
            ordinal: index + 1,
            credit: {
              originalLineId: line.originalLineId,
              creditedNetMinor: line.creditedNetMinor,
              creditedTaxMinor: line.creditedTaxMinor,
              creditedGrossMinor: line.creditedGrossMinor,
              finalLineCredit: line.finalLineCredit,
            },
            consumedAt: issuedAt,
          }),
        );

      yield* CreditDb.insertDocument(
        tx,
        scope.bookId,
        documentId,
        creditId,
        document.revision,
        document.digest,
        yield* toJsonObject(document),
      );

      for (const correction of corrections) {
        if (!review.lines[correction.ordinal - 1]) return yield* failure("InternalError");
        yield* CreditDb.insertTaxCorrection(tx, scope.bookId, correction, {
          creditId,
          creditVoucherId: postingReceipt.voucherId,
          originalVoucherId: correction.originalVoucherId,
          originalControlLineId: correction.originalControlLineId,
          originalPostingDate: correction.originalPostingDate,
          originalEvidenceId: correction.originalEvidenceId,
          controlLineId: review.controlLineId,
        });
      }

      // The credit is reflected in the live receivable, so ageing, statements,
      // collection eligibility and the reminder recheck all read the reduced balance
      // rather than the original statement's historical outstanding amount.
      const live = yield* liveInvoice(tx, scope.bookId, original.registerInvoiceId);

      if (live.outstandingMinor !== result.unpaidAfterMinor)
        return yield* failure("InvalidJournal");

      // The render intent commits with the credit it names. A renderer reads the
      // retained semantic revision, and a failed rendering leaves this credit and its
      // journal in place: nothing here ever issues a second number or re-derives a
      // total from newer customer details.
      yield* Ledger.insertOutbox(tx, {
        bookId: scope.bookId,
        id: newId("outbox"),
        receiptId: postingReceipt.id,
        kind: Credits.customerCreditRenderEvent,
        payload: {
          creditId,
          documentId,
          documentRevision: document.revision,
          documentDigest: document.digest,
          requiredRendererVersion,
          legalDocumentNumber: result.legalDocumentNumber,
          artifactState: result.artifactState,
        },
      });

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

export const getCustomerCreditReview = Effect.fn("commerce.customerCredit.review")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx) {
      const row = (yield* CreditDb.readReview(tx, command.scope.bookId, command.id))[0];

      if (!row) return yield* failure("NotFound");

      const review = yield* decode(ReviewSchema, row.body);

      const approvalRow = (yield* CreditDb.readApprovals(tx, command.scope.bookId, review.id)).at(
        -1,
      );

      const creditRow = (yield* CreditDb.readCreditByReview(
        tx,
        command.scope.bookId,
        review.id,
      ))[0];

      const current = yield* readCreditCapacity(tx, command.scope, review.input).pipe(
        Effect.as(true),
        Effect.catch((error) =>
          error instanceof Accounting.AccountingError && receivableFailures.includes(error.code)
            ? Effect.succeed(false)
            : Effect.fail(error),
        ),
      );

      return yield* decode(ViewSchema, {
        review,
        approval: approvalRow ? yield* decode(ApprovalSchema, approvalRow.body) : null,
        credit: creditRow ? yield* decode(ReceiptSchema, creditRow.body) : null,
        dependenciesCurrent: current,
      });
    },
    "share",
  );
});

export const getCustomerCredit = Effect.fn("commerce.customerCredit.get")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx) {
      const row = (yield* CreditDb.readCredit(tx, command.scope.bookId, command.id))[0];

      if (!row) return yield* failure("NotFound");

      return yield* decode(ReceiptSchema, row.body);
    },
    "share",
  );
});

export const customerCreditHistory = Effect.fn("commerce.customerCredit.history")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx) {
      const row = (yield* ArDb.readArLegalIssueById(tx, command.scope.bookId, command.id))[0];

      if (!row) return yield* failure("NotFound");

      const original = yield* decode(Ar.ArLegalIssueReceipt, row.body);

      const issued = yield* CreditDb.readCreditByOriginalIssue(
        tx,
        command.scope.bookId,
        original.id,
        historyBound,
      );

      if (issued.length > historyBound) return yield* failure("UnsupportedProfile");

      const items: Array<typeof Credits.CustomerCreditHistoryItem.Type> = [];

      for (const credit of issued) {
        const body = yield* decode(ReceiptSchema, credit.body);

        items.push({
          id: body.id,
          reviewId: body.reviewId,
          legalDocumentNumber: body.legalDocumentNumber,
          creditDate: body.issuedOn,
          totals: body.totals,
          postedAt: body.issuedAt,
          voucherId: body.postingReceipt.voucherId,
          semanticDocumentDigest: body.semanticDocument.digest,
          artifactState: body.artifactState,
          taxConsequenceObserved: body.taxConsequenceObserved,
        });
      }

      return yield* decode(HistorySchema, {
        scope: command.scope,
        originalLegalIssueId: original.id,
        originalDocumentNumber: original.legalDocumentNumber,
        complete: true,
        count: issued.length,
        items,
      });
    },
    "share",
  );
});

export type { CapacityRequest, Review };
