import * as Accounting from "@open-erp/contracts/accounting";
import * as Owners from "@open-erp/contracts/owner-register";
import * as Loans from "@open-erp/contracts/treasury-loans";
import * as Effect from "effect/Effect";
import * as Db from "../../db/treasury/loans";
import * as Ledger from "../../db/posting";
import * as OwnerDb from "../../db/subledger/owners";
import * as Bank from "../../db/banking/statements";
import type { Transaction } from "../../db/transaction";
import {
  decode,
  readEvidenceReference,
  requireTableAccess,
  withBook,
  type Scope,
  type Principal,
} from "../commerce/support";
import { readCapacity, sealOwnerAggregateInTransaction } from "../subledger/owners";
import { admitAccountRole, admitBankMatch, admitLineOwner } from "../resource-admission";
import { failure } from "../failures";
import {
  approveChangeInTransaction,
  executeChangeInTransaction,
  createEvidenceInTransaction,
  prepareJournalInTransaction,
} from "../posting";
import { digest } from "../json";
import { isoNow, replay, saveCommand } from "../command-receipts";
import { newId } from "../identifiers";
import { checkedReview, compileLoanReview, loanSnapshot, readLoan } from "./loan-basis";

type Mutation<I> = { readonly scope: Scope; readonly idempotencyKey: string; readonly input: I };

type Identified<I> = Mutation<I> & { readonly id: string };

export const adopt = Effect.fn("treasury.adoptLoan")(function* (
  token: string,
  command: Mutation<typeof Loans.AdoptLoan.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      const { scope, input, idempotencyKey } = command;
      const operation = "treasury_adopt_loan";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        input,
        Loans.RetainedLoan,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(tx, Db.loanTables, true);
      const book = (yield* Ledger.readBook(tx, scope))[0];

      if (!book || book.profile !== "synthetic-core-v1" || book.authority !== "native")
        return yield* failure("UnsupportedProfile");

      if ((yield* Db.readAdoption(tx, scope.bookId, input.principalEffectId)).length)
        return yield* failure("AlreadyPosted");
      const capacity = yield* readCapacity(tx, scope, input.principalEffectId);
      const effect = capacity.effect;
      const owner = (yield* OwnerDb.readOwner(tx, scope.bookId, effect.ownerId))[0];
      const record = (yield* OwnerDb.readRecord(tx, scope.bookId, effect.recordId))[0];

      if (
        effect.classification !== "shareholder_loan" ||
        effect.side !== "credit" ||
        effect.currency !== book.currency ||
        effect.currencyScale !== book.currencyScale ||
        owner?.body.dataNature !== "synthetic_example" ||
        record?.body.dataNature !== "synthetic_example" ||
        input.coverageStartOn < effect.postingDate
      )
        return yield* failure("InvalidJournal");

      const roles = [
        { account: input.interestExpenseAccountId, role: "interest_expense" },
        { account: input.accruedInterestLiabilityAccountId, role: "interest_liability" },
        { account: input.feeExpenseAccountId, role: "fee_expense" },
      ];

      const ids = [...roles.map((role) => role.account), effect.accountId];

      if (new Set(ids).size !== ids.length) return yield* failure("InvalidJournal");
      const accounts = yield* Ledger.readAccounts(tx, scope.bookId, ids);

      if (accounts.length !== ids.length || accounts.some((account) => !account.active))
        return yield* failure("InvalidJournal");
      yield* admitAccountRole(tx, scope.bookId, effect.accountId, "owner");

      for (const role of roles) {
        yield* admitAccountRole(tx, scope.bookId, role.account, "treasury");
        const existing = (yield* Db.role(tx, scope.bookId, role.account))[0];

        if (existing && existing.role !== role.role) return yield* failure("InvalidJournal");
        yield* Db.insertRole(tx, scope.bookId, role.account, role.role);
      }

      const evidence = yield* readEvidenceReference(tx, scope.bookId, input.evidenceId);

      const body = {
        id: newId("loan"),
        scope,
        input,
        principal: effect,
        evidence,
        principalEffectiveConvention: "end_of_day",
        roundingPolicy: "cumulative_half_up",
        allocationRule: "explicit_split",
        ledgerDeltaMinor: "0",
        legalPolicyApproved: false,
        createdAt: yield* isoNow(tx),
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Loans.RetainedLoan, { ...body, digest: yield* digest(body) });
      yield* Db.insertLoan(tx, scope.bookId, result);
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

export const recordRate = Effect.fn("treasury.recordLoanRate")(function* (
  token: string,
  command: Identified<typeof Loans.RecordLoanRate.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      const { scope, input, id, idempotencyKey } = command;
      const operation = "treasury_record_loan_rate";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Loans.LoanRate,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(tx, Db.loanTables, true);
      const loan = yield* readLoan(tx, scope, id);
      const snapshot = yield* loanSnapshot(tx, scope, loan);

      if (snapshot.rates.some((rate) => rate.input.effectiveOn === input.effectiveOn))
        return yield* failure("IdempotencyConflict");

      if (snapshot.rates.length >= 1000) return yield* failure("UnsupportedProfile");
      const evidence = yield* readEvidenceReference(tx, scope.bookId, input.evidenceId);

      const body = {
        id: newId("loan_rate"),
        scope,
        loanId: id,
        input,
        evidence,
        createdAt: yield* isoNow(tx),
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Loans.LoanRate, { ...body, digest: yield* digest(body) });
      yield* Db.insertRate(tx, scope.bookId, result);
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

export const prepare = Effect.fn("treasury.prepareLoanReview")(function* (
  token: string,
  command: Identified<typeof Loans.PrepareLoanReview.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      const { scope, input, id, idempotencyKey } = command;
      const operation = "treasury_prepare_loan_review";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Loans.LoanReview,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(tx, Db.loanTables, true);
      const loan = yield* readLoan(tx, scope, id);
      const compiled = yield* compileLoanReview(tx, scope, loan, input);
      const sourceEvidence = yield* readEvidenceReference(tx, scope.bookId, input.evidenceId);
      const reviewId = newId("loan_review");

      const evidence = yield* createEvidenceInTransaction(tx, principal, {
        scope,
        idempotencyKey: `${reviewId}_evidence`,
        input: {
          title: "Retained loan decision",
          mediaType: "application/json",
          content: JSON.stringify({ loan, input, compiled, sourceEvidence }),
          origin: "Synthetic loan agreement, calculation and explicit payment allocation",
        },
      });

      const plan =
        compiled.lines.length === 0
          ? null
          : yield* prepareJournalInTransaction(tx, principal, {
              scope,
              idempotencyKey: `${reviewId}_plan`,
              input: {
                kind: "manual_journal",
                evidenceId: evidence.id,
                eventKey: reviewId,
                accountingPeriodId: input.accountingPeriodId,
                postingDate: input.postingDate,
                series: input.series,
                description: input.kind === "accrual" ? "Loan interest accrual" : "Loan repayment",
                rationale: input.reason,
                taxAssessment: "not_applicable",
                lines: compiled.lines.map((line) => ({
                  accountId: line.accountId,
                  debitMinor: line.debitMinor,
                  creditMinor: line.creditMinor,
                  description: line.description,
                })),
              },
            });

      const body = {
        id: reviewId,
        scope,
        loanId: id,
        input,
        basis: compiled.basis,
        calculation: compiled.calculation,
        evidence: { evidenceId: evidence.id, sha256: evidence.sha256 },
        postingPlan: plan,
        createdAt: yield* isoNow(tx),
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Loans.LoanReview, { ...body, digest: yield* digest(body) });
      yield* Db.insertReview(tx, scope.bookId, result);
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

export const approve = Effect.fn("treasury.approveLoanReview")(function* (
  token: string,
  command: Identified<typeof Loans.ApproveLoanReview.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, input, id, idempotencyKey } = command;
      const operation = "treasury_approve_loan_review";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Loans.LoanApproval,
      );

      if (request.previous) return request.previous;
      const { review } = yield* checkedReview(tx, scope, id, input.digest);

      if ((yield* Db.approvals(tx, scope.bookId, id)).length >= 1000)
        return yield* failure("UnsupportedProfile");
      const now = yield* isoNow(tx);
      const approvalId = newId("loan_approval");

      const kernelApproval = review.postingPlan
        ? yield* approveChangeInTransaction(tx, principal, {
            scope,
            changeSetId: review.postingPlan.id,
            idempotencyKey: `${approvalId}_kernel`,
            owner: { kind: "treasury_loan", id },
            input: { version: 1, planDigest: review.postingPlan.planDigest },
          })
        : null;

      const body = {
        id: approvalId,
        scope,
        reviewId: id,
        reviewDigest: review.digest,
        actorId: principal.actorId,
        kernelApprovalId: kernelApproval?.id ?? null,
        expiresAt: kernelApproval?.expiresAt ?? new Date(Date.parse(now) + 3600000).toISOString(),
        createdAt: now,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Loans.LoanApproval, { ...body, digest: yield* digest(body) });
      yield* Db.insertApproval(tx, scope.bookId, result);
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

const commitPrincipal = Effect.fn("treasury.commitLoanPrincipal")(function* (
  tx: Transaction,
  principal: Principal,
  loan: typeof Loans.RetainedLoan.Type,
  review: typeof Loans.LoanReview.Type,
  posted: typeof Accounting.ExecutionReceipt.Type,
  key: string,
) {
  const input = review.input;

  if (input.kind !== "repayment" || BigInt(input.principalPartMinor) === 0n) return null;
  const scope = review.scope;
  const action = review.postingPlan?.groups[0]?.actions[0];
  const line = action?.lines.find((candidate) => candidate.accountId === loan.principal.accountId);

  if (!action || !line) return yield* failure("InternalError");
  const recordId = newId("owner_record");
  const ownerReviewId = newId("owner_review");
  const operation = "treasury_execute_loan_review";

  const aggregate = yield* sealOwnerAggregateInTransaction(tx, {
    scope,
    actorId: principal.actorId,
    operation,
    idempotencyKey: key,
    ownerId: loan.principal.ownerId,
    recordId,
    reviewId: ownerReviewId,
    sourceKey: review.id,
    locator: review.id,
    evidenceId: review.evidence.evidenceId,
    occurredOn: input.postingDate,
    currency: loan.principal.currency,
    currencyScale: loan.principal.currencyScale,
    amountMinor: input.principalPartMinor,
    sourceKind: "settlement",
    dataNature: "synthetic_example",
    classification: "loan_repayment",
    description: "Loan principal repayment",
    reason: input.reason,
    controlAccountId: loan.principal.accountId,
    counterparty: null,
  });

  yield* admitLineOwner(tx, scope.bookId, posted.voucherId, line.lineId, "owner");

  const effectBody = {
    id: newId("owner_effect"),
    scope,
    reviewId: ownerReviewId,
    voucherId: posted.voucherId,
    lineId: line.lineId,
    createdAt: posted.committedAt,
    receipt: { key, operation, actorId: principal.actorId },
    recordId,
    ownerId: loan.principal.ownerId,
    revisionDigest: aggregate.revisionDigest,
    accountId: loan.principal.accountId,
    postingDate: input.postingDate,
    occurredOn: input.postingDate,
    locator: review.id,
    eventId: action.eventId,
    changeSetId: review.postingPlan?.id ?? "",
    classification: "loan_repayment",
    origin: "current",
    side: "debit",
    amountMinor: input.principalPartMinor,
    currency: loan.principal.currency,
    currencyScale: loan.principal.currencyScale,
    evidence: review.evidence,
  };

  const effect = yield* decode(Owners.PostedEffect, effectBody);
  yield* OwnerDb.insertEffect(tx, {
    bookId: scope.bookId,
    id: effect.id,
    recordId,
    ownerId: effect.ownerId,
    reviewId: ownerReviewId,
    voucherId: posted.voucherId,
    lineId: line.lineId,
    accountId: line.accountId,
    postingDate: input.postingDate,
    side: "debit",
    classification: "loan_repayment",
    origin: "current",
    amountMinor: input.principalPartMinor,
    body: { ...effectBody, digest: yield* digest(effectBody) },
  });

  return effect.id;
});

export const execute = Effect.fn("treasury.executeLoanReview")(function* (
  token: string,
  command: Identified<typeof Loans.ExecuteLoanReview.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      const { scope, input, id, idempotencyKey } = command;
      const operation = "treasury_execute_loan_review";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Loans.LoanEvent,
      );

      if (request.previous) return request.previous;
      const { review, loan } = yield* checkedReview(tx, scope, id, input.digest);

      const approvalRow = (yield* Db.approvals(tx, scope.bookId, id)).find(
        (row) => row.body.id === input.approvalId,
      );

      if (!approvalRow) return yield* failure("ApprovalRequired");
      const approval = yield* decode(Loans.LoanApproval, approvalRow.body);
      const now = yield* isoNow(tx);

      if (
        approval.reviewDigest !== review.digest ||
        Date.parse(approval.expiresAt) <= Date.parse(now)
      )
        return yield* failure("ApprovalRequired");

      if (
        (yield* Ledger.readOperatorMembership(tx, scope.bookId, approval.actorId)).length !== 1 ||
        (yield* Ledger.readActorAdmission(tx, approval.actorId))[0]?.enabled === false
      )
        return yield* failure("ApprovalRequired");
      let posted: typeof Accounting.ExecutionReceipt.Type | null = null;
      const owner = { kind: "treasury_loan" as const, id };

      if (review.postingPlan) {
        if (approval.kernelApprovalId === null) return yield* failure("ApprovalRequired");

        posted = yield* executeChangeInTransaction(tx, principal, {
          scope,
          changeSetId: review.postingPlan.id,
          idempotencyKey: `${id}_post`,
          owner,
          input: {
            version: 1,
            planDigest: review.postingPlan.planDigest,
            approvalId: approval.kernelApprovalId,
          },
        });
      } else if (approval.kernelApprovalId !== null) return yield* failure("ApprovalRequired");

      let ownerEffectId: string | null = null;

      if (review.input.kind === "repayment") {
        const repayment = review.input;
        const action = review.postingPlan?.groups[0]?.actions[0];

        const bankLine = action?.lines.find((line) => line.accountId === repayment.bankAccountId);

        if (!posted || !bankLine) return yield* failure("InternalError");

        const leg = {
          statementId: review.input.statementId,
          rowOrdinal: review.input.rowOrdinal,
          voucherId: posted.voucherId,
          lineId: bankLine.lineId,
        };

        yield* admitBankMatch(tx, scope.bookId, leg);
        yield* Bank.insertMatch(tx, {
          bookId: scope.bookId,
          ...leg,
          origin: "explicit",
          actorId: principal.actorId,
        });
        ownerEffectId = yield* commitPrincipal(tx, principal, loan, review, posted, idempotencyKey);
      }

      const body = {
        id: newId("loan_event"),
        scope,
        loanId: loan.id,
        reviewId: id,
        approvalId: approval.id,
        kind: review.input.kind,
        postingDate: review.input.postingDate,
        principalMinor: review.input.kind === "repayment" ? review.input.principalPartMinor : "0",
        interestMinor:
          review.input.kind === "repayment"
            ? review.input.interestPartMinor
            : (review.calculation?.deltaMinor ?? "0"),
        feeMinor: review.input.kind === "repayment" ? review.input.feePartMinor : "0",
        coverageEndExclusiveOn:
          review.input.kind === "accrual" ? review.input.coverageEndExclusiveOn : null,
        ownerEffectId,
        postingReceipt: posted,
        noJournal: posted === null,
        createdAt: now,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Loans.LoanEvent, { ...body, digest: yield* digest(body) });
      yield* Db.insertEvent(tx, scope.bookId, result);

      if (ownerEffectId !== null)
        yield* Db.insertAllocation(tx, scope.bookId, result, loan.principal.id, ownerEffectId);
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

export const get = Effect.fn("treasury.getLoan")(function* (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    const loan = yield* readLoan(tx, command.scope, command.id);
    const { rates, events, basis } = yield* loanSnapshot(tx, command.scope, loan);

    return yield* decode(Loans.LoanView, {
      loan,
      rates,
      events,
      balance: {
        principalRemainingMinor: basis.principalRemainingMinor,
        accruedInterestMinor: basis.accruedInterestMinor,
        paidInterestMinor: basis.paidInterestMinor,
        interestRemainingMinor: basis.interestRemainingMinor,
        coverageEndExclusiveOn: basis.coverageEndExclusiveOn,
      },
      principalAllocations: basis.allocations,
      sourceCoverage: "unknown",
      lenderStatementDifferenceMinor: null,
    });
  });
});

export const getReview = Effect.fn("treasury.getLoanReview")(function* (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    const row = (yield* Db.readReview(tx, command.scope.bookId, command.id))[0];

    if (!row) return yield* failure("NotFound");
    const review = yield* decode(Loans.LoanReview, row.body);

    return yield* decode(Loans.LoanReviewView, {
      review,
      approvals: (yield* Db.approvals(tx, command.scope.bookId, command.id)).map(
        (approval) => approval.body,
      ),
      event:
        (yield* Db.events(tx, command.scope.bookId, review.loanId)).find(
          (event) => event.body.reviewId === command.id,
        )?.body ?? null,
    });
  });
});

export const list = Effect.fn("treasury.listLoans")(function* (
  token: string,
  command: { readonly scope: Scope; readonly after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    if (command.after && !(yield* Db.readLoan(tx, command.scope.bookId, command.after))[0])
      return yield* failure("NotFound");

    const rows = yield* Db.loanPage(tx, command.scope.bookId, command.after ?? null);

    const items = yield* Effect.forEach(rows.slice(0, 20), (row) =>
      decode(Loans.RetainedLoan, row.body),
    );

    return yield* decode(Loans.LoanPage, {
      scope: command.scope,
      items,
      next: rows.length > 20 ? (items.at(-1)?.id ?? null) : null,
    });
  });
});

export const listReviews = Effect.fn("treasury.listLoanReviews")(function* (
  token: string,
  command: { readonly scope: Scope; readonly id: string; readonly after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    yield* readLoan(tx, command.scope, command.id);

    if (command.after) {
      const anchor = (yield* Db.readReview(tx, command.scope.bookId, command.after))[0];

      if (!anchor || anchor.body.loanId !== command.id) return yield* failure("NotFound");
    }

    const rows = yield* Db.reviewPage(tx, command.scope.bookId, command.id, command.after ?? null);

    const items = yield* Effect.forEach(rows.slice(0, 20), (row) =>
      decode(Loans.LoanReview, row.body),
    );

    return yield* decode(Loans.LoanReviewPage, {
      scope: command.scope,
      loanId: command.id,
      items,
      next: rows.length > 20 ? (items.at(-1)?.id ?? null) : null,
    });
  });
});
