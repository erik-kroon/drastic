import * as Accounting from "@open-erp/contracts/accounting";
import * as Loans from "@open-erp/contracts/treasury-loans";
import * as Loan from "@open-erp/domain/loan-lifecycle";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Db from "../../db/treasury/loans";
import * as Ledger from "../../db/posting";
import * as Bank from "../../db/banking/statements";
import * as Operations from "../../db/subledger/owner-operations";
import type { Transaction } from "../../db/transaction";
import { decode, readEvidenceReference, requireTableAccess, type Scope } from "../commerce/support";
import { readCapacity } from "../subledger/owners";
import { admitAccountRole } from "../resource-admission";
import { failure } from "../failures";
import { validatePlan } from "../posting";

export function nextDay(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

export const readLoan = Effect.fn("treasury.readLoan")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const row = (yield* Db.readLoan(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");

  return yield* decode(Loans.RetainedLoan, row.body);
});

export const loanSnapshot = Effect.fn("treasury.loanSnapshot")(function* (
  tx: Transaction,
  scope: Scope,
  loan: typeof Loans.RetainedLoan.Type,
) {
  yield* requireTableAccess(tx, Db.loanTables, false);
  const book = (yield* Ledger.readBook(tx, scope))[0];

  if (!book || book.profile !== "synthetic-core-v1" || book.authority !== "native")
    return yield* failure("UnsupportedProfile");

  if (
    loan.principal.currency !== book.currency ||
    loan.principal.currencyScale !== book.currencyScale
  )
    return yield* failure("StaleDependency");
  const capacity = yield* readCapacity(tx, scope, loan.principal.id);

  if (!equalJson(capacity.effect, loan.principal)) return yield* failure("StaleDependency");
  const rateRows = yield* Db.rates(tx, scope.bookId, loan.id);
  const eventRows = yield* Db.events(tx, scope.bookId, loan.id);
  const allocations = yield* Db.principalAllocations(tx, scope.bookId, loan.principal.id);

  if (Math.max(rateRows.length, eventRows.length, allocations.length) > 1000)
    return yield* failure("UnsupportedProfile");
  const rates = [];
  const events = [];

  for (const row of rateRows) rates.push(yield* decode(Loans.LoanRate, row.body));

  for (const row of eventRows) events.push(yield* decode(Loans.LoanEvent, row.body));
  const allocated = allocations.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);

  if (allocated.toString() !== capacity.allocatedMinor) return yield* failure("StaleDependency");

  const accrued = events
    .filter((event) => event.kind === "accrual")
    .reduce((sum, event) => sum + BigInt(event.interestMinor), 0n);

  const paid = events
    .filter((event) => event.kind === "repayment")
    .reduce((sum, event) => sum + BigInt(event.interestMinor), 0n);

  if (paid > accrued) return yield* failure("StaleDependency");

  const coverageEnd =
    events
      .map((event) => event.coverageEndExclusiveOn)
      .filter((date) => date !== null)
      .sort()
      .at(-1) ?? null;

  const roleEntries = [
    { account: loan.input.interestExpenseAccountId, role: "interest_expense" },
    { account: loan.input.accruedInterestLiabilityAccountId, role: "interest_liability" },
    { account: loan.input.feeExpenseAccountId, role: "fee_expense" },
  ];

  for (const entry of roleEntries) {
    yield* admitAccountRole(tx, scope.bookId, entry.account, "treasury");

    if ((yield* Db.role(tx, scope.bookId, entry.account))[0]?.role !== entry.role)
      return yield* failure("StaleDependency");
  }

  yield* admitAccountRole(tx, scope.bookId, loan.principal.accountId, "owner");

  const accounts = yield* Ledger.readAccounts(tx, scope.bookId, [
    ...roleEntries.map((entry) => entry.account),
    loan.principal.accountId,
  ]);

  if (accounts.length !== 4 || accounts.some((account) => !account.active))
    return yield* failure("StaleDependency");

  const basis = yield* decode(Loans.LoanBasis, {
    loanDigest: loan.digest,
    principalRemainingMinor: capacity.remainingMinor,
    accruedInterestMinor: accrued.toString(),
    paidInterestMinor: paid.toString(),
    interestRemainingMinor: (accrued - paid).toString(),
    coverageEndExclusiveOn: coverageEnd,
    rateDigests: rates.map((rate) => rate.digest),
    eventDigests: events.map((event) => event.digest),
    principalEvents: allocations.map((allocation) => ({
      effectiveOn: nextDay(allocation.effectiveOn),
      deltaMinor: (-BigInt(allocation.amountMinor)).toString(),
    })),
    allocations,
    versions: {
      profileVersion: book.profileVersion.toString(),
      writerEpoch: book.writerEpoch.toString(),
      accounts: accounts.map((account) => ({
        id: account.id,
        version: account.version.toString(),
      })),
    },
    cashSource: null,
  });

  return { loan, rates, events, basis };
});

export const compileLoanReview = Effect.fn("treasury.compileLoanReview")(function* (
  tx: Transaction,
  scope: Scope,
  loan: typeof Loans.RetainedLoan.Type,
  input: typeof Loans.PrepareLoanReview.Type,
) {
  const snapshot = yield* loanSnapshot(tx, scope, loan);
  const { basis } = snapshot;

  if (snapshot.events.length >= 1000) return yield* failure("UnsupportedProfile");
  const period = (yield* Ledger.readPeriod(tx, scope.bookId, input.accountingPeriodId))[0];

  if (!period || input.postingDate < period.startsOn || input.postingDate > period.endsOn)
    return yield* failure("InvalidJournal");

  if (period.locked) return yield* failure("PeriodLocked");

  const versions = {
    ...basis.versions,
    periodId: period.id,
    periodVersion: period.version.toString(),
  };

  if (input.kind === "accrual") {
    if (
      nextDay(input.postingDate) !== input.coverageEndExclusiveOn ||
      input.coverageEndExclusiveOn <= loan.input.coverageStartOn ||
      (basis.coverageEndExclusiveOn !== null &&
        input.coverageEndExclusiveOn < basis.coverageEndExclusiveOn)
    )
      return yield* failure("InvalidJournal");

    const calculation = Loan.calculateInterest({
      loanId: loan.id,
      coverageStartOn: loan.input.coverageStartOn,
      coverageEndExclusiveOn: input.coverageEndExclusiveOn,
      openingPrincipalMinor: loan.principal.amountMinor,
      principalEvents: basis.principalEvents,
      rateSegments: snapshot.rates.map((rate) => rate.input),
      convention: loan.input.convention,
      priorEffectiveMinor: basis.accruedInterestMinor,
    });

    if (Result.isFailure(calculation)) return yield* failure("InvalidJournal");

    if (BigInt(calculation.success.deltaMinor) < 0n) return yield* failure("UnsupportedProfile");
    const compiled = Loan.compileAccrualJournal(calculation.success.deltaMinor, loan.input, false);

    if (Result.isFailure(compiled)) return yield* failure("InvalidJournal");

    return {
      basis: { ...basis, versions },
      calculation: calculation.success,
      lines: compiled.success,
    };
  }

  const latestMovementOn = [
    ...basis.allocations.map((allocation) => allocation.postingDate),
    ...snapshot.events.map((event) => event.postingDate),
  ].reduce((latest, date) => (date > latest ? date : latest), loan.input.coverageStartOn);

  if (input.postingDate < latestMovementOn) return yield* failure("UnsupportedProfile");

  if (BigInt(input.feePartMinor) > 0n) {
    if (input.feeEvidenceId === null) return yield* failure("MissingEvidence");
    yield* readEvidenceReference(tx, scope.bookId, input.feeEvidenceId);
  }

  yield* admitAccountRole(tx, scope.bookId, input.bankAccountId, "bank");
  const bank = (yield* Ledger.readAccounts(tx, scope.bookId, [input.bankAccountId]))[0];

  if (!bank?.active) return yield* failure("StaleDependency");

  const source = (yield* Bank.readObservation(
    tx,
    scope.bookId,
    input.statementId,
    input.rowOrdinal,
  ))[0];

  const statement = (yield* Bank.readStatement(tx, scope.bookId, input.statementId))[0];

  if (!source || !statement) return yield* failure("NotFound");

  if (
    source.accountId !== input.bankAccountId ||
    source.evidenceId !== input.evidenceId ||
    source.observedOn !== input.postingDate ||
    statement.source.currency !== loan.principal.currency ||
    BigInt(source.amountMinor) >= 0n
  )
    return yield* failure("StaleDependency");

  if (
    (yield* Operations.readFundingSourceUsage(
      tx,
      scope.bookId,
      input.statementId,
      input.rowOrdinal,
      source.evidenceId,
    ))[0]?.used
  )
    return yield* failure("AlreadyPosted");

  const compiled = Loan.compileRepayment({
    principalRemainingMinor: basis.principalRemainingMinor,
    interestRemainingMinor: basis.interestRemainingMinor,
    principalPartMinor: input.principalPartMinor,
    interestPartMinor: input.interestPartMinor,
    feePartMinor: input.feePartMinor,
    cashMinor: (-BigInt(source.amountMinor)).toString(),
    principalLiabilityAccountId: loan.principal.accountId,
    interestLiabilityAccountId: loan.input.accruedInterestLiabilityAccountId,
    feeExpenseAccountId: loan.input.feeExpenseAccountId,
    bankAccountId: input.bankAccountId,
  });

  if (Result.isFailure(compiled)) return yield* failure("InvalidJournal");

  return {
    basis: {
      ...basis,
      versions: { ...versions, bankAccountVersion: bank.version.toString() },
      cashSource: {
        statementId: source.statementId,
        rowOrdinal: source.rowOrdinal,
        accountId: source.accountId,
        evidenceId: source.evidenceId,
        evidenceSha256: source.evidenceSha256,
        observedOn: source.observedOn,
        amountMinor: source.amountMinor,
      },
    },
    calculation: null,
    lines: compiled.success,
  };
});

export const checkedReview = Effect.fn("treasury.checkedLoanReview")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expectedDigest: string,
) {
  const row = (yield* Db.readReview(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");
  const review = yield* decode(Loans.LoanReview, row.body);

  if (review.digest !== expectedDigest) return yield* failure("StaleDependency");
  const loan = yield* readLoan(tx, scope, review.loanId);

  if ((yield* Db.events(tx, scope.bookId, loan.id)).some((event) => event.body.reviewId === id))
    return yield* failure("AlreadyPosted");

  const compiled = yield* compileLoanReview(tx, scope, loan, review.input).pipe(
    Effect.mapError((error) =>
      error instanceof Accounting.AccountingError &&
      (error.code === "InvalidJournal" ||
        error.code === "AlreadyPosted" ||
        error.code === "UnsupportedProfile")
        ? failure("StaleDependency")
        : error,
    ),
  );

  if (
    !equalJson(compiled.basis, review.basis) ||
    !equalJson(compiled.calculation, review.calculation)
  )
    return yield* failure("StaleDependency");

  if (review.postingPlan) {
    yield* validatePlan(tx, scope, review.postingPlan);

    const actual = review.postingPlan.groups[0]?.actions[0]?.lines.map((line) => ({
      accountId: line.accountId,
      debitMinor: line.debitMinor,
      creditMinor: line.creditMinor,
      description: line.description,
    }));

    const expected = compiled.lines.map((line) => ({
      accountId: line.accountId,
      debitMinor: line.debitMinor,
      creditMinor: line.creditMinor,
      description: line.description,
    }));

    if (!equalJson(actual, expected)) return yield* failure("StaleDependency");
  } else if (compiled.lines.length !== 0) return yield* failure("StaleDependency");

  return { review, loan };
});
