import * as Contracts from "@open-erp/contracts/processor-clearing";
import * as Effect from "effect/Effect";
import * as Db from "../../db/banking/processor-clearing";
import * as CashDb from "../../db/banking/foreign-cash";
import * as PostingDb from "../../db/posting";
import * as BankDb from "../../db/banking/statements";
import type { Transaction } from "../../db/transaction";
import { decode, withBook, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { readProcessorAccount } from "./processor-fetches";

type Review = typeof Contracts.Review.Type;

type Observation = typeof Contracts.Observation.Type;

function readReview(tx: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const row = (yield* Db.readReview(tx, scope.bookId, id))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(Contracts.Review, row.body);
  });
}

function readPayout(tx: Transaction, scope: Scope, review: Review) {
  return Effect.gen(function* () {
    if (review.input.kind !== "bank_receipt") return yield* failure("UnsupportedProfile");
    const row = (yield* Db.readObservation(tx, scope.bookId, review.input.payoutObservationId))[0];

    if (!row) return yield* failure("NotFound");
    const payout = yield* decode(Contracts.Observation, row.body);

    if (
      payout.accountId !== review.input.accountId ||
      payout.type !== "payout" ||
      payout.payoutMethod !== "automatic" ||
      !payout.providerPayoutId ||
      !payout.destinationBankAccountId
    )
      return yield* failure("UnsupportedProfile");

    return payout;
  });
}

function postedObservation(tx: Transaction, scope: Scope, observation: Observation) {
  return Effect.gen(function* () {
    const row = (yield* Db.readObservationEffect(tx, scope.bookId, observation.id))[0];

    if (!row) return yield* failure("MissingEvidence");
    const execution = yield* decode(Contracts.Execution, row.body);
    const review = yield* readReview(tx, scope, row.reviewId);

    if (
      review.input.kind !== "observation" ||
      review.input.observationId !== observation.id ||
      review.input.accountId !== observation.accountId ||
      execution.reviewId !== review.id ||
      execution.digest !== review.digest
    )
      return yield* failure("StaleDependency");

    return { review, execution };
  });
}

function availableBankRow(
  tx: Transaction,
  scope: Scope,
  reference: typeof Contracts.BankObservation.Type,
) {
  return Effect.gen(function* () {
    const bank = (yield* BankDb.readObservation(
      tx,
      scope.bookId,
      reference.statementId,
      reference.rowOrdinal,
    ))[0];

    if (!bank) return yield* failure("NotFound");

    const revisions = yield* CashDb.readNativeSourceRevisions(
      tx,
      scope.bookId,
      reference.statementId,
      reference.rowOrdinal,
    );

    const capacity = (yield* CashDb.readNativeSourceCapacity(
      tx,
      scope.bookId,
      reference.statementId,
      reference.rowOrdinal,
    ))[0];

    const claims = yield* Db.readBankClaim(
      tx,
      scope.bookId,
      reference.statementId,
      reference.rowOrdinal,
    );

    return {
      row: yield* decode(Contracts.ReceiptBankRow, bank),
      available:
        capacity?.consumed === false &&
        claims.length === 0 &&
        !revisions.some(
          (revision) =>
            revision.changeKind === "removed" || revision.amountMinor !== bank.amountMinor,
        ),
    };
  });
}

export const listProcessorAccounts = Effect.fn("processor.listAccounts")(function* (
  token: string,
  scope: Scope,
  query: typeof Contracts.DirectoryQuery.Type,
) {
  return yield* withBook(token, scope, false, function* (tx) {
    if (query.after) yield* readProcessorAccount(tx, scope, query.after);
    const rows = yield* Db.accountPage(tx, scope.bookId, query.after ?? null);

    const items = yield* Effect.forEach(rows.slice(0, 20), (row) =>
      decode(Contracts.Account, row.body),
    );

    return { scope, items, next: rows.length > 20 ? (items.at(-1)?.id ?? null) : null };
  });
});

export const listProcessorReviews = Effect.fn("processor.listReviews")(function* (
  token: string,
  scope: Scope,
  accountId: string,
  query: typeof Contracts.DirectoryQuery.Type,
) {
  return yield* withBook(token, scope, false, function* (tx) {
    yield* readProcessorAccount(tx, scope, accountId);

    if (query.after && (yield* readReview(tx, scope, query.after)).input.accountId !== accountId)
      return yield* failure("NotFound");
    const rows = yield* Db.reviewPage(tx, scope.bookId, accountId, query.after ?? null);

    const items = yield* Effect.forEach(rows.slice(0, 20), (row) =>
      decode(Contracts.Review, row.body),
    );

    return { scope, accountId, items, next: rows.length > 20 ? (items.at(-1)?.id ?? null) : null };
  });
});

export const getProcessorPayoutReview = Effect.fn("processor.payoutReview")(function* (
  token: string,
  scope: Scope,
  reviewId: string,
) {
  return yield* withBook(token, scope, false, function* (tx) {
    const review = yield* readReview(tx, scope, reviewId);

    if (review.input.kind !== "bank_receipt") return yield* failure("UnsupportedProfile");
    const account = yield* readProcessorAccount(tx, scope, review.input.accountId);

    const book = (yield* PostingDb.readBook(tx, scope))[0];

    if (!book) return yield* failure("NotFound");

    const payout = yield* readPayout(tx, scope, review);
    const postedPayout = yield* postedObservation(tx, scope, payout);

    const rows = yield* Db.readPayoutMembershipFetches(
      tx,
      scope.bookId,
      account.id,
      payout.providerPayoutId ?? "",
    );

    if (rows.length === 0 || rows.length > 20) return yield* failure("MissingEvidence");
    const retainedFetches = yield* Effect.forEach(rows, (row) => decode(Contracts.Fetch, row.body));

    const fetches = retainedFetches.filter((fetch) => fetch.membershipComplete === true);
    const first = fetches[0];

    if (
      !first ||
      fetches.some(
        (fetch) => fetch.membershipComplete !== true || fetch.profileDigest !== account.digest,
      )
    )
      return yield* failure("MissingEvidence");

    const population = (observations: readonly Observation[]) =>
      observations
        .map((observation) => `${observation.id}:${observation.semanticDigest}`)
        .toSorted()
        .join("|");

    if (fetches.some((fetch) => population(fetch.observations) !== population(first.observations)))
      return yield* failure("StaleDependency");

    if (
      first.observations.filter(
        (observation) =>
          observation.id === payout.id && observation.semanticDigest === payout.semanticDigest,
      ).length !== 1
    )
      return yield* failure("MissingEvidence");

    const members = yield* Effect.forEach(
      first.observations.filter((observation) => observation.id !== payout.id),
      (observation) =>
        Effect.gen(function* () {
          if (
            observation.accountId !== account.id ||
            observation.classification !== "supported" ||
            observation.type === "payout"
          )
            return yield* failure("UnsupportedProfile");
          const posted = yield* postedObservation(tx, scope, observation);

          const invoiceId =
            posted.review.input.kind === "observation" ? posted.review.input.invoiceId : undefined;

          const label = invoiceId
            ? (yield* Db.readInvoiceLabel(tx, scope.bookId, invoiceId))[0]
            : null;

          return { observation, ...posted, invoiceDocumentNumber: label?.documentNumber ?? null };
        }),
    );

    if (
      members.reduce((sum, member) => sum + BigInt(member.observation.netMinor), 0n) !==
      -BigInt(payout.netMinor)
    )
      return yield* failure("StaleDependency");
    const bank = yield* availableBankRow(tx, scope, review.input.bankObservation);
    const approvalRows = yield* Db.readApprovals(tx, scope.bookId, review.id);

    if (approvalRows.length > 20) return yield* failure("UnsupportedProfile");

    const approvals = yield* Effect.forEach(approvalRows, (row) =>
      decode(Contracts.Approval, row.body),
    );

    const returned = (yield* Db.readReturn(tx, scope.bookId, review.id))[0];
    const execution = (yield* Db.readExecution(tx, scope.bookId, review.id))[0];
    const effects = yield* Db.readPayoutEffects(tx, scope.bookId, payout.id);

    const processor = (yield* CashDb.readLedger(
      tx,
      scope.bookId,
      account.processorControlAccountId,
      "9999-12-31",
    ))[0];

    const transit = (yield* CashDb.readLedger(
      tx,
      scope.bookId,
      account.payoutTransitAccountId,
      "9999-12-31",
    ))[0];

    if (!processor || !transit) return yield* failure("MissingEvidence");

    return yield* decode(Contracts.PayoutReviewView, {
      book: { currency: book.currency, scale: book.currencyScale },
      review,
      account,
      payout,
      postedPayout,
      members,
      bank: bank.row,
      bankAvailable: bank.available,
      preparerName: (yield* Db.readPreparerName(tx, scope.bookId, review.actorId))[0]?.name ?? null,
      approvals,
      returned: returned ? yield* decode(Contracts.ReviewReturn, returned.body) : null,
      execution: execution ? yield* decode(Contracts.Execution, execution.body) : null,
      processorLedgerMinor: processor.carryingMinor,
      transitLedgerMinor: transit.carryingMinor,
      payoutNativeMinor: effects
        .reduce((sum, effect) => sum + BigInt(effect.nativeDeltaMinor), 0n)
        .toString(),
      payoutCarryingMinor: effects
        .reduce((sum, effect) => sum + BigInt(effect.carryingDeltaMinor), 0n)
        .toString(),
    });
  });
});

export const listProcessorBankCandidates = Effect.fn("processor.bankCandidates")(function* (
  token: string,
  scope: Scope,
  reviewId: string,
  query: typeof Contracts.BankCandidateQuery.Type,
) {
  return yield* withBook(token, scope, false, function* (tx) {
    const review = yield* readReview(tx, scope, reviewId);
    const payout = yield* readPayout(tx, scope, review);
    const account = yield* readProcessorAccount(tx, scope, review.input.accountId);

    if ((query.afterStatementId === undefined) !== (query.afterRowOrdinal === undefined))
      return yield* failure("InvalidJournal");

    if (query.afterStatementId && query.afterRowOrdinal) {
      const anchor = (yield* availableBankRow(tx, scope, {
        statementId: query.afterStatementId,
        rowOrdinal: query.afterRowOrdinal,
      })).row;

      const statement = (yield* BankDb.readStatement(tx, scope.bookId, anchor.statementId))[0];

      if (
        anchor.accountId !== account.bankAccountId ||
        anchor.providerId !== payout.providerPayoutId ||
        anchor.sourceBankAccountId !== payout.destinationBankAccountId ||
        BigInt(anchor.amountMinor) !== -BigInt(payout.netMinor) ||
        statement?.importInput.currency !== account.currency
      )
        return yield* failure("NotFound");
    }

    const rows = yield* Db.bankCandidatePage(tx, {
      bookId: scope.bookId,
      accountId: account.bankAccountId,
      providerId: payout.providerPayoutId ?? "",
      sourceBankAccountId: payout.destinationBankAccountId ?? "",
      amountMinor: (-BigInt(payout.netMinor)).toString(),
      currency: account.currency,
      afterStatementId: query.afterStatementId ?? null,
      afterRowOrdinal: query.afterRowOrdinal ?? 0,
    });

    const items = yield* Effect.forEach(rows.slice(0, 20), (row) =>
      availableBankRow(tx, scope, row),
    );

    const last = items.at(-1)?.row;

    return {
      scope,
      reviewId,
      items,
      next:
        rows.length > 20 && last
          ? { statementId: last.statementId, rowOrdinal: last.rowOrdinal }
          : null,
    };
  });
});
