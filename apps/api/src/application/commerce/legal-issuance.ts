import * as Accounting from "@open-erp/contracts/accounting";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Policy from "@open-erp/contracts/legal-sales-policy";
import * as Effect from "effect/Effect";
import * as Db from "../../db/commerce/ar-legal";
import * as Policies from "../../db/commerce/legal-policies";
import * as DraftDb from "../../db/commerce/invoice-lifecycle";
import * as Ledger from "../../db/posting";
import { requireHumanSession } from "../../db/human-actor";
import { failure } from "../failures";
import {
  digest,
  isoNow,
  newId,
  readBook,
  replay,
  saveCommand,
  createEvidenceInTransaction,
  sealActionInTransaction,
  executeChangeInTransaction,
} from "../posting";
import { decode, withBook, requireRetainedEvidence, toJsonObject, type Scope } from "./support";
import { calculateLegalIssue, checkedLegalIssue, legalAccounts } from "./legal-issue-basis";

export const activateArLegalAccountingProfile = Effect.fn("commerce.legalProfile.activate")(
  function* (
    token: string,
    command: {
      scope: Scope;
      idempotencyKey: string;
      input: typeof Ar.ActivateArLegalAccountingProfile.Type;
    },
  ) {
    return yield* withBook(
      token,
      command.scope,
      true,
      function* (tx, principal) {
        yield* requireHumanSession(principal);

        const { scope, input, idempotencyKey } = command,
          operation = "activate_ar_legal_accounting_profile";

        const request = yield* replay(
          tx,
          scope,
          idempotencyKey,
          operation,
          principal.actorId,
          input,
          Ar.ArLegalAccountingProfile,
        );

        if (request.previous) return request.previous;
        const book = yield* readBook(tx, scope);
        const row = (yield* Policies.readPolicy(tx, scope.bookId, input.policyId))[0];

        if (!row) return yield* failure("NotFound");
        const policy = yield* decode(Policy.LegalSalesPolicy, row.body);

        if (
          policy.digest !== input.policyDigest ||
          policy.status !== "active" ||
          policy.activatedBy === principal.actorId ||
          book.profile !== "synthetic-core-v1" ||
          book.authority !== "native" ||
          book.currency !== "SEK" ||
          book.currencyScale !== 2 ||
          input.effectiveFrom !== policy.candidate.input.effectiveFrom
        )
          return yield* failure("UnsupportedProfile");
        yield* legalAccounts(tx, scope, input);
        yield* requireRetainedEvidence(tx, scope.bookId, input.accountRoleEvidence);

        if ((yield* Db.readProfileForPolicy(tx, scope.bookId, policy.id)).length)
          return yield* failure("IdempotencyConflict");

        const body = {
          id: newId("ar_accounting_profile"),
          scope,
          policyId: policy.id,
          policyDigest: policy.digest,
          input,
          status: "active",
          activatedBy: principal.actorId,
          activatedAt: yield* isoNow(tx),
        };

        const result = yield* decode(Ar.ArLegalAccountingProfile, {
          ...body,
          digest: yield* digest(body),
        });

        yield* Db.insertAccountingProfile(tx, scope.bookId, result);
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

export const prepareArLegalIssue = Effect.fn("commerce.legalIssue.prepare")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Ar.PrepareArLegalIssue.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, input, idempotencyKey } = command,
        operation = "prepare_ar_legal_issue";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        input,
        Ar.ArLegalIssueReview,
      );

      if (request.previous) return request.previous;
      const calculation = yield* calculateLegalIssue(tx, scope, input);

      const ordinal =
        (yield* Db.readArLegalIssueHistory(tx, scope.bookId, input.draftId, 50)).length + 1;

      if (ordinal > 50) return yield* failure("UnsupportedProfile");

      const evidence = yield* createEvidenceInTransaction(tx, principal, {
        scope,
        idempotencyKey: newId("legal_source"),
        input: {
          title: `Legal invoice source: ${calculation.draftSnapshot.content.title}`,
          mediaType: "application/json",
          content: JSON.stringify(calculation.draftSnapshot),
          origin: "Exact retained commercial draft revision for legal invoice review",
        },
      });

      if ((yield* DraftDb.readPostedEvidenceHistory(tx, scope.bookId, evidence.id))[0]?.present)
        return yield* failure("AlreadyPosted");

      const body = {
        id: newId("ar_review"),
        scope,
        version: 1,
        profile: input.profile,
        ordinal,
        input,
        ...calculation,
        sourceEvidence: { evidenceId: evidence.id, sha256: evidence.sha256 },
        createdAt: yield* isoNow(tx),
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Ar.ArLegalIssueReview, { ...body, digest: yield* digest(body) });

      if (new TextEncoder().encode(JSON.stringify(result)).length > 262144)
        return yield* failure("InvalidJournal");
      yield* Db.insertIssueReview(tx, scope.bookId, principal.actorId, result);
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

export const approveArLegalIssue = Effect.fn("commerce.legalIssue.approve")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Ar.ApproveArLegalIssue.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireHumanSession(principal);

      const { scope, id, input, idempotencyKey } = command,
        operation = "approve_ar_legal_issue";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Ar.ArLegalIssueApproval,
      );

      if (request.previous) return request.previous;
      const review = yield* checkedLegalIssue(tx, scope, id, input.digest);

      if (review.receipt.actorId === principal.actorId) return yield* failure("ApprovalRequired");
      const ordinal = (yield* Db.readIssueApprovals(tx, scope.bookId, id)).length + 1;

      if (ordinal > 50) return yield* failure("UnsupportedProfile");
      const now = yield* isoNow(tx);

      const result = yield* decode(Ar.ArLegalIssueApproval, {
        id: newId("ar_approval"),
        scope,
        reviewId: id,
        digest: review.digest,
        version: 1,
        actorId: principal.actorId,
        ordinal,
        expiresAt: new Date(Date.parse(now) + 3600000).toISOString(),
        createdAt: now,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      });

      yield* Db.insertIssueApproval(tx, scope.bookId, result);
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

export const executeArLegalIssue = Effect.fn("commerce.legalIssue.execute")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Ar.ExecuteArLegalIssue.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, id, input, idempotencyKey } = command,
        operation = "execute_ar_legal_issue";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Ar.ArLegalIssueReceipt,
      );

      if (request.previous) return request.previous;
      const review = yield* checkedLegalIssue(tx, scope, id, input.digest);

      const row = (yield* Db.readIssueApprovals(tx, scope.bookId, id)).find(
        (row) => row.body.id === input.approvalId,
      );

      if (!row) return yield* failure("ApprovalRequired");
      const approval = yield* decode(Ar.ArLegalIssueApproval, row.body);

      const issuedAt = yield* isoNow(tx),
        issuedOn = issuedAt.slice(0, 10);

      if (
        approval.digest !== review.digest ||
        Date.parse(approval.expiresAt) <= Date.parse(issuedAt) ||
        !(yield* Ledger.readOperatorMembership(tx, scope.bookId, approval.actorId)).length ||
        (yield* Ledger.readActorAdmission(tx, approval.actorId))[0]?.enabled === false
      )
        return yield* failure("ApprovalRequired");

      const draft = review.draftSnapshot,
        source = review.sourceEvidence;

      if (draft.content.plannedIssueDate !== issuedOn) return yield* failure("StaleDependency");

      const number = (yield* Db.allocateLegalNumber(tx, scope.bookId, review.input.policyId))[0]
        ?.number;

      if (!number) return yield* failure("UnsupportedProfile");

      const document = `${review.policySnapshot.input.series}-${number}`,
        issueId = newId("ar_issue"),
        invoiceId = newId("invoice");

      const eventKey = `legal_ar_${draft.id}`;

      const event =
        (yield* Ledger.readEvent(tx, scope.bookId, source.evidenceId, eventKey))[0] ??
        (yield* Ledger.insertEvent(
          tx,
          scope.bookId,
          newId("event"),
          source.evidenceId,
          eventKey,
        ))[0];

      if (!event) return yield* failure("InternalError");

      const controlLine = {
        lineId: newId("line"),
        accountId: review.input.controlAccountId,
        debitMinor: review.totals.grossMinor,
        creditMinor: "0",
        description: `Customer receivable ${document}`,
      };

      const action = yield* decode(Accounting.VoucherPostingAction, {
        kind: "post_voucher",
        correctsVoucherId: null,
        eventId: event.id,
        postingPurpose: "legal_ar_recognition",
        occurrenceKey: eventKey,
        fiscalYearId: review.fiscalYearId,
        accountingPeriodId: review.input.accountingPeriodId,
        postingDate: issuedOn,
        series: review.input.voucherSeries,
        currency: "SEK",
        description: `Legal customer invoice ${document}`,
        rationale: review.input.reason,
        taxAssessment: "se-domestic-standard-25-v1",
        lines: [
          controlLine,
          {
            lineId: newId("line"),
            accountId: review.input.revenueAccountId,
            debitMinor: "0",
            creditMinor: review.totals.netMinor,
            description: `Domestic sales ${document}`,
          },
          {
            lineId: newId("line"),
            accountId: review.input.outputVatAccountId,
            debitMinor: "0",
            creditMinor: review.totals.taxMinor,
            description: `Domestic output VAT ${document}`,
          },
        ],
        evidenceRefs: [{ ...source, locator: eventKey }],
        legalIssue: {
          profile: review.profile,
          number: document,
          policyId: review.input.policyId,
          reviewId: id,
          reviewDigest: review.digest,
          netMinor: review.totals.netMinor,
          taxMinor: review.totals.taxMinor,
        },
      });

      const plan = yield* sealActionInTransaction(tx, principal, scope, action, true);
      yield* Ledger.insertApproval(tx, {
        bookId: scope.bookId,
        id: approval.id,
        changeSetId: plan.id,
        digest: plan.planDigest,
        actorId: approval.actorId,
        expiresAt: approval.expiresAt,
      });

      const postingReceipt = yield* executeChangeInTransaction(tx, principal, {
        scope,
        changeSetId: plan.id,
        idempotencyKey: newId("legal_post"),
        input: { version: 1, planDigest: plan.planDigest, approvalId: approval.id },
        owner: { kind: "legal_issue", id },
      });

      yield* DraftDb.claimControlAccount(
        tx,
        scope.bookId,
        review.input.controlAccountId,
        "customer",
      );

      if (
        !(yield* DraftDb.readControlAccount(
          tx,
          scope.bookId,
          review.input.controlAccountId,
          "customer",
        ))[0]?.present
      )
        return yield* failure("InvalidJournal");

      const invoice = {
        id: invoiceId,
        scope,
        kind: "legal_customer_invoice_v1",
        direction: "customer",
        counterpartyId: draft.content.counterpartyId,
        counterpartyRevision: draft.content.counterpartyRevision,
        counterpartyName: draft.content.customer.legalName,
        documentNumber: document,
        issuedOn,
        currency: "SEK",
        currencyScale: 2,
        amountMinor: review.totals.grossMinor,
        controlAccountId: review.input.controlAccountId,
        evidence: source,
        legalIssueId: issueId,
        policyId: review.input.policyId,
        recognition: {
          voucherId: postingReceipt.voucherId,
          lineId: controlLine.lineId,
          eventId: event.id,
          postingDate: issuedOn,
        },
      };

      yield* DraftDb.insertRegisteredInvoice(tx, {
        bookId: scope.bookId,
        id: invoiceId,
        direction: "customer",
        counterpartyId: draft.content.counterpartyId,
        counterpartyRevision: draft.content.counterpartyRevision,
        documentNumber: document,
        issuedOn,
        amountMinor: review.totals.grossMinor,
        controlAccountId: review.input.controlAccountId,
        recognitionVoucherId: postingReceipt.voucherId,
        recognitionLineId: controlLine.lineId,
        evidenceId: source.evidenceId,
        body: yield* toJsonObject(invoice),
      });
      yield* DraftDb.insertInvoiceRevision(tx, {
        bookId: scope.bookId,
        invoiceId,
        revision: "1",
        evidenceId: source.evidenceId,
        body: {
          id: invoiceId,
          scope,
          revision: "1",
          dueOn: draft.content.dueDate,
          description: draft.content.title,
          evidence: source,
          reason: "Original legal customer issue",
          createdAt: issuedAt,
          receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
        },
      });

      const body = {
        id: issueId,
        scope,
        profile: review.profile,
        reviewId: id,
        reviewDigest: review.digest,
        approvalId: approval.id,
        draftId: draft.id,
        draftRevision: draft.revision,
        draftDigest: draft.digest,
        draftSnapshot: draft,
        policyId: review.input.policyId,
        policyDigest: review.policySnapshot.digest,
        policySnapshot: review.policySnapshot,
        accountingProfileId: review.input.accountingProfileId,
        accountingProfileDigest: review.accountingProfileSnapshot.digest,
        accountingProfileSnapshot: review.accountingProfileSnapshot,
        legalDocumentNumber: document,
        issuedOn,
        issuedAt,
        issued: true,
        legalInvoice: true,
        recognized: true,
        delivered: false,
        totals: review.totals,
        lines: review.lines,
        postingReceipt,
        registerInvoiceId: invoiceId,
        sourceEvidence: source,
        createdAt: issuedAt,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Ar.ArLegalIssueReceipt, {
        ...body,
        digest: yield* digest(body),
      });

      if (new TextEncoder().encode(JSON.stringify(result)).length > 262144)
        return yield* failure("InvalidJournal");
      yield* Db.insertIssue(tx, scope.bookId, result);
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
