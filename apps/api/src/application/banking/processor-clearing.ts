import * as Contracts from "@open-erp/contracts/processor-clearing";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Effect from "effect/Effect";
import * as Db from "../../db/banking/processor-clearing";
import * as CashDb from "../../db/banking/foreign-cash";
import * as PostingDb from "../../db/posting";
import { readAccountRoles } from "../../db/posting-admission";
import * as FxDb from "../../db/commerce/fx";
import type { Transaction } from "../../db/transaction";
import {
  decode,
  requireTableAccess,
  toJsonObject,
  withBook,
  type Scope,
  type Principal,
} from "../commerce/support";
import { ensureEvent, postOwnedJournal } from "../commerce/fx";
import {
  consumeProcessorReceivableInTransaction,
  consumeProcessorRefundInTransaction,
} from "../commerce/processor-settlements";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";
import { failure } from "../failures";
import { collectPostingPrincipalBasis } from "../posting-authority";
import { compileProcessorReview, type Compilation } from "./processor-effects";
import { readProcessorAccount } from "./processor-fetches";
import { addMatch } from "./matches";

export { fetchProcessorObservations } from "./processor-fetches";

export { registerProcessorNativeCredit } from "./processor-native-credit";

export { reconcileProcessorClearing } from "./processor-reconciliation";

type Review = typeof Contracts.Review.Type;

type Command<A> = { readonly scope: Scope; readonly idempotencyKey: string; readonly input: A };

type ReviewCommand<A> = Command<A> & { readonly reviewId: string };

export const registerProcessorAccount = Effect.fn("processor.registerAccount")(function* (
  token: string,
  command: Command<typeof Contracts.RegisterAccount.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        "processor_register_account",
        principal.actorId,
        yield* toJsonObject(command),
        Contracts.Account,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(tx, Db.tables, true);
      const book = (yield* PostingDb.readBook(tx, command.scope))[0];

      const evidence = (yield* PostingDb.readEvidence(
        tx,
        command.scope.bookId,
        command.input.evidenceId,
      ))[0];

      if (!book || book.authority !== "native" || book.profile !== "synthetic-core-v1" || !evidence)
        return yield* failure("UnsupportedProfile");

      const ids = [
        command.input.processorControlAccountId,
        command.input.payoutTransitAccountId,
        command.input.feeCostAccountId,
        command.input.disputeReceivableAccountId,
        command.input.disputeLossAccountId,
        command.input.bankAccountId,
        command.input.gainAccountId,
        command.input.lossAccountId,
      ];

      if (new Set(ids).size !== ids.length) return yield* failure("InvalidJournal");
      const accounts = yield* PostingDb.readAccounts(tx, command.scope.bookId, ids);

      if (
        accounts.length !== ids.length ||
        accounts.some((row) => !row.active) ||
        (yield* FxDb.readBankAccount(tx, command.scope.bookId, command.input.bankAccountId))
          .length === 0
      )
        return yield* failure("InvalidJournal");

      for (const id of ids) {
        const roles = yield* readAccountRoles(tx, command.scope.bookId, id);

        if (roles.some((row) => id !== command.input.bankAccountId || row.role !== "bank"))
          return yield* failure("InvalidJournal");
      }

      if (
        command.input.currency === book.currency &&
        command.input.currencyScale !== book.currencyScale
      )
        return yield* failure("InvalidJournal");

      for (const id of [
        command.input.processorControlAccountId,
        command.input.payoutTransitAccountId,
      ]) {
        if ((yield* Db.readAccountForControl(tx, command.scope.bookId, id)).length > 0)
          return yield* failure("IdempotencyConflict");
      }

      if (command.input.currency === book.currency) {
        const opening = (yield* CashDb.readLedger(
          tx,
          command.scope.bookId,
          command.input.processorControlAccountId,
          "9999-12-31",
        ))[0];

        if (opening?.carryingMinor !== "0") return yield* failure("UnsupportedProfile");
      }

      const body = {
        ...command.input,
        id: newId("processor_account"),
        scope: command.scope,
        createdAt: yield* isoNow(tx),
      };

      const account = yield* decode(Contracts.Account, { ...body, digest: yield* digest(body) });
      yield* Db.insertAccount(tx, {
        bookId: command.scope.bookId,
        ...account,
        body: yield* toJsonObject(account),
      });
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "processor_register_account",
        principal.actorId,
        yield* toJsonObject(account),
      );

      return account;
    },
    "update",
  );
});

function readReview(tx: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const row = (yield* Db.readReview(tx, scope.bookId, id))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(Contracts.Review, row.body);
  });
}

function compiledFacts(compiled: Compilation) {
  return {
    sourceIdentity: compiled.sourceIdentity,
    snapshot: compiled.snapshot,
    journal: compiled.journal,
    cashEffects: compiled.cashEffects,
    obligation: compiled.obligation,
    fiscalYearId: compiled.fiscalYearId,
    bookCurrency: compiled.bookCurrency,
  };
}

function currentReview(tx: Transaction, scope: Scope, review: Review) {
  return Effect.gen(function* () {
    const compiled = yield* compileProcessorReview(tx, scope, review.input);

    const retained = {
      sourceIdentity: review.sourceIdentity,
      snapshot: review.snapshot,
      journal: review.journal,
      cashEffects: review.cashEffects,
      obligation: review.obligation,
      fiscalYearId: review.fiscalYearId,
      bookCurrency: review.bookCurrency,
    };

    if ((yield* digest(compiledFacts(compiled))) !== (yield* digest(retained)))
      return yield* failure("StaleDependency");

    return compiled;
  });
}

export const prepareProcessorClearing = Effect.fn("processor.prepare")(function* (
  token: string,
  command: Command<typeof Contracts.Prepare.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        "processor_prepare",
        principal.actorId,
        yield* toJsonObject(command),
        Contracts.Review,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(tx, Db.tables, true);
      const compiled = yield* compileProcessorReview(tx, command.scope, command.input);
      const id = newId("processor_review");
      let postingAction: typeof Accounting.VoucherPostingAction.Type | null = null;

      if (compiled.journal.length > 0) {
        const eventId = yield* ensureEvent(
          tx,
          command.scope,
          command.input.evidenceId,
          `processor_${id}`,
        );

        postingAction = yield* decode(
          Accounting.VoucherPostingAction,
          yield* toJsonObject({
            kind: "post_voucher",
            correctsVoucherId: null,
            fiscalYearId: compiled.fiscalYearId,
            accountingPeriodId: command.input.accountingPeriodId,
            series: command.input.series,
            postingDate: command.input.date,
            eventId,
            postingPurpose: "adjustment",
            occurrenceKey: id,
            description: command.input.reason,
            currency: compiled.bookCurrency,
            rationale: command.input.reason,
            taxAssessment: "not_applicable",
            evidenceRefs: [
              {
                evidenceId: compiled.snapshot.evidence.id,
                sha256: compiled.snapshot.evidence.sha256,
                locator: compiled.sourceIdentity,
              },
            ],
            lines: compiled.journal.map((line) => ({
              ...line,
              lineId: newId("line"),
              sourceLineId: null,
            })),
          }),
        );
      }

      const body = {
        id,
        scope: command.scope,
        actorId: principal.actorId,
        version: 1,
        input: command.input,
        ...compiledFacts(compiled),
        postingAction,
        createdAt: yield* isoNow(tx),
      };

      const review = yield* decode(
        Contracts.Review,
        yield* toJsonObject({ ...body, digest: yield* digest(yield* toJsonObject(body)) }),
      );

      yield* Db.insertReview(tx, {
        bookId: command.scope.bookId,
        id,
        actorId: principal.actorId,
        sourceIdentity: compiled.sourceIdentity,
        body: yield* toJsonObject(review),
      });
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "processor_prepare",
        principal.actorId,
        yield* toJsonObject(review),
      );

      return review;
    },
    "update",
  );
});

export const approveProcessorClearing = Effect.fn("processor.approve")(function* (
  token: string,
  command: ReviewCommand<typeof Contracts.Approve.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      if (principal.kind !== "betterAuthSession") return yield* failure("Forbidden");

      if ((yield* Db.readReturn(tx, command.scope.bookId, command.reviewId)).length > 0)
        return yield* failure("StaleDependency");

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        "processor_approve",
        principal.actorId,
        yield* toJsonObject(command),
        Contracts.Approval,
      );

      if (request.previous) return request.previous;
      const review = yield* readReview(tx, command.scope, command.reviewId);

      if (review.digest !== command.input.digest) return yield* failure("StaleDependency");

      if (review.actorId === principal.actorId) return yield* failure("ApprovalRequired");
      yield* currentReview(tx, command.scope, review);

      const approval = yield* decode(Contracts.Approval, {
        id: newId("processor_approval"),
        reviewId: review.id,
        actorId: principal.actorId,
        digest: review.digest,
        expiresAt: new Date(Date.parse(yield* isoNow(tx)) + 3600000).toISOString(),
      });

      yield* Db.insertApproval(tx, {
        bookId: command.scope.bookId,
        ...approval,
        body: {
          ...(yield* toJsonObject(approval)),
          authorityBasis: yield* collectPostingPrincipalBasis(
            tx,
            command.scope,
            principal,
            "approve_change",
            "informational",
          ),
        },
      });
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "processor_approve",
        principal.actorId,
        yield* toJsonObject(approval),
      );

      return approval;
    },
    "update",
  );
});

function consumeObligation(
  tx: Transaction,
  principal: Principal,
  scope: Scope,
  review: Review,
  approval: typeof Contracts.Approval.Type,
  voucherId: string,
) {
  return Effect.gen(function* () {
    const obligation = review.obligation;

    if (!obligation) return;

    if (obligation.kind === "foreign_receivable") {
      yield* Db.insertObligationEffect(tx, {
        bookId: scope.bookId,
        reviewId: review.id,
        itemId: obligation.sourceId,
        nativeMinor: obligation.nativeMinor,
        carryingMinor: obligation.carryingMinor,
        body: yield* toJsonObject(obligation),
      });

      return;
    }

    if (!review.postingAction) return yield* failure("InternalError");
    const action = yield* decode(Accounting.VoucherPostingAction, review.postingAction);
    const line = action.lines.find((candidate) => candidate.accountId === obligation.accountId);

    if (!line) return yield* failure("InternalError");

    const input = {
      ownerId: review.id,
      ownerApprovalId: approval.id,
      capacityVersion: obligation.capacityVersion,
      sourceIdentity: review.sourceIdentity,
      voucherId,
      lineId: line.lineId,
      principalMinor: obligation.nativeMinor,
    };

    if (obligation.kind === "receivable")
      yield* consumeProcessorReceivableInTransaction(tx, principal, scope, {
        ...input,
        invoiceId: obligation.sourceId,
      });
    else
      yield* consumeProcessorRefundInTransaction(tx, principal, scope, {
        ...input,
        originId: obligation.sourceId,
        bookPrincipalMinor: obligation.carryingMinor,
      });
  });
}

function persistEffects(
  tx: Transaction,
  principal: Principal,
  scope: Scope,
  review: Review,
  compiled: Compilation,
  voucherId: string,
) {
  return Effect.gen(function* () {
    for (const effect of review.cashEffects)
      yield* Db.insertCashEffect(tx, {
        bookId: scope.bookId,
        id: newId("processor_cash_effect"),
        reviewId: review.id,
        ...effect,
        sourceIdentity: review.sourceIdentity,
        actualOn: review.input.date,
        voucherId,
        body: yield* toJsonObject(effect),
      });

    if (compiled.payoutEffect)
      yield* Db.insertPayoutEffect(tx, {
        bookId: scope.bookId,
        reviewId: review.id,
        ...compiled.payoutEffect,
        body: yield* toJsonObject(compiled.payoutEffect),
      });

    if (compiled.disputeEffect)
      yield* Db.insertDisputeEffect(tx, {
        bookId: scope.bookId,
        reviewId: review.id,
        accountId: compiled.account.id,
        ...compiled.disputeEffect,
        body: yield* toJsonObject(compiled.disputeEffect),
      });

    if (!compiled.bankClaim) return;
    let lineId = compiled.bankClaim.adoptedLineId;

    if (!lineId && review.postingAction) {
      const action = yield* decode(Accounting.VoucherPostingAction, review.postingAction);
      lineId =
        action.lines.find((line) => line.accountId === compiled.bankClaim?.accountId)?.lineId ??
        null;
    }

    if (!lineId) return yield* failure("InternalError");
    yield* Db.insertBankClaim(tx, {
      bookId: scope.bookId,
      reviewId: review.id,
      ...compiled.bankClaim,
      voucherId,
      lineId,
      body: yield* toJsonObject(compiled.bankClaim),
    });

    if (compiled.account.currency === compiled.bookCurrency)
      yield* addMatch(
        tx,
        scope.bookId,
        principal.actorId,
        {
          statementId: compiled.bankClaim.statementId,
          rowOrdinal: compiled.bankClaim.rowOrdinal,
          voucherId,
          lineId,
        },
        "explicit",
        review.id,
      );
  });
}

export const executeProcessorClearing = Effect.fn("processor.execute")(function* (
  token: string,
  command: ReviewCommand<typeof Contracts.Execute.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      if ((yield* Db.readReturn(tx, command.scope.bookId, command.reviewId)).length > 0)
        return yield* failure("StaleDependency");

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        "processor_execute",
        principal.actorId,
        yield* toJsonObject(command),
        Contracts.Execution,
      );

      if (request.previous) return request.previous;
      const review = yield* readReview(tx, command.scope, command.reviewId);

      if (review.digest !== command.input.digest) return yield* failure("StaleDependency");
      const prior = (yield* Db.readExecution(tx, command.scope.bookId, review.id))[0];

      if (prior) {
        const execution = yield* decode(Contracts.Execution, prior.body);
        yield* saveCommand(
          tx,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "processor_execute",
          principal.actorId,
          yield* toJsonObject(execution),
        );

        return execution;
      }

      const row = (yield* Db.readApproval(
        tx,
        command.scope.bookId,
        review.id,
        command.input.approvalId,
      ))[0];

      if (!row) return yield* failure("ApprovalRequired");
      const approval = yield* decode(Contracts.Approval, row.body);

      if (
        approval.digest !== review.digest ||
        Date.parse(approval.expiresAt) <= Date.parse(yield* isoNow(tx)) ||
        (yield* PostingDb.readOperatorMembership(tx, command.scope.bookId, approval.actorId))
          .length === 0 ||
        (yield* PostingDb.readActorAdmission(tx, approval.actorId))[0]?.enabled === false
      )
        return yield* failure("ApprovalRequired");
      const compiled = yield* currentReview(tx, command.scope, review);
      let voucherId: string | null = compiled.bankClaim?.adoptedVoucherId ?? null;

      if (review.postingAction) {
        const posted = yield* postOwnedJournal(
          tx,
          command.scope,
          principal,
          { ...approval, bookId: command.scope.bookId, body: row.body },
          review.postingAction,
          { kind: "processor", id: review.id },
        );

        voucherId = posted.voucherId;
      }

      if (!voucherId) return yield* failure("InvalidJournal");

      const execution = yield* decode(Contracts.Execution, {
        reviewId: review.id,
        digest: review.digest,
        sourceIdentity: review.sourceIdentity,
        voucherId,
        obligation: review.obligation,
        cashEffects: review.cashEffects,
      });

      const observationId = compiled.snapshot.observation?.id ?? null;
      yield* Db.insertExecution(tx, {
        bookId: command.scope.bookId,
        reviewId: review.id,
        sourceIdentity: review.sourceIdentity,
        voucherId,
        observationId: review.input.kind === "bank_receipt" ? null : observationId,
        body: yield* toJsonObject(execution),
      });
      yield* consumeObligation(tx, principal, command.scope, review, approval, voucherId);
      yield* persistEffects(tx, principal, command.scope, review, compiled, voucherId);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "processor_execute",
        principal.actorId,
        yield* toJsonObject(execution),
      );

      return execution;
    },
    "update",
  );
});

export const getProcessorAccount = Effect.fn("processor.getAccount")(function* (
  token: string,
  scope: Scope,
  id: string,
) {
  return yield* withBook(token, scope, false, function* (tx) {
    return yield* readProcessorAccount(tx, scope, id);
  });
});

export const getProcessorReview = Effect.fn("processor.getReview")(function* (
  token: string,
  scope: Scope,
  id: string,
) {
  return yield* withBook(token, scope, false, function* (tx) {
    return yield* readReview(tx, scope, id);
  });
});

export const getProcessorFetch = Effect.fn("processor.getFetch")(function* (
  token: string,
  scope: Scope,
  id: string,
) {
  return yield* withBook(token, scope, false, function* (tx) {
    const row = (yield* Db.readFetch(tx, scope.bookId, id))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(Contracts.Fetch, row.body);
  });
});

export const returnProcessorReview = Effect.fn("processor.returnReview")(function* (
  token: string,
  command: ReviewCommand<typeof Contracts.ReturnReview.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      if (principal.kind !== "betterAuthSession") return yield* failure("Forbidden");
      const review = yield* readReview(tx, command.scope, command.reviewId);

      if (review.digest !== command.input.digest) return yield* failure("StaleDependency");

      if (review.input.kind !== "bank_receipt") return yield* failure("UnsupportedProfile");

      if (review.actorId === principal.actorId) return yield* failure("ApprovalRequired");

      if ((yield* Db.readExecution(tx, command.scope.bookId, review.id)).length > 0)
        return yield* failure("AlreadyPosted");

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        "processor_return",
        principal.actorId,
        yield* toJsonObject(command),
        Contracts.ReviewReturn,
      );

      if (request.previous) return request.previous;
      const prior = (yield* Db.readReturn(tx, command.scope.bookId, review.id))[0];

      const returned = prior
        ? yield* decode(Contracts.ReviewReturn, prior.body)
        : yield* decode(Contracts.ReviewReturn, {
            id: newId("processor_return"),
            reviewId: review.id,
            digest: review.digest,
            actorId: principal.actorId,
            createdAt: yield* isoNow(tx),
          });

      if (!prior)
        yield* Db.insertReturn(tx, command.scope.bookId, {
          ...returned,
          body: yield* toJsonObject(returned),
        });
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "processor_return",
        principal.actorId,
        yield* toJsonObject(returned),
      );

      return returned;
    },
    "update",
  );
});

export {
  listProcessorAccounts,
  listProcessorReviews,
  getProcessorPayoutReview,
  listProcessorBankCandidates,
} from "./processor-review-reads";
