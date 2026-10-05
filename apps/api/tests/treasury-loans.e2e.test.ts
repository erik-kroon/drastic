import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Owners from "@open-erp/contracts/owner-register";
import * as Operations from "@open-erp/contracts/owner-operations";
import * as Loans from "@open-erp/contracts/treasury-loans";
import { expect, test } from "vitest";
import {
  database,
  decoded,
  environment,
  evidence,
  failure,
  fixture,
  key,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";

const loanRoot = "/treasury/loans";

async function bankSource(
  book: BookFixture,
  amountMinor: string,
  date: string,
  secondAmountMinor?: string,
) {
  const openingMinor = BigInt(amountMinor) < 0n ? "20000000" : "0";

  const amounts =
    secondAmountMinor === undefined ? [amountMinor] : [amountMinor, secondAmountMinor];

  const declaration = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "synthetic_loan_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: date,
    endsOn: date,
    openingMinor,
    closingMinor: amounts
      .reduce((total, amount) => total + BigInt(amount), BigInt(openingMinor))
      .toString(),
    completeness: { declaredComplete: true, basis: "Independent synthetic loan source" },
    rows: amounts.map((amount, index) => ({
      rowOrdinal: index + 1,
      providerId: key(),
      date,
      description: "Synthetic loan cash",
      amountMinor: amount,
    })),
  };

  const source = await post(
    book,
    "/evidence",
    {
      title: "Synthetic loan cash original",
      content: JSON.stringify(declaration),
      mediaType: "application/json",
      origin: "Independent loan fixture",
    },
    Accounting.Evidence,
  );

  const statement = await post(
    book,
    "/bank-statements",
    { ...declaration, evidenceId: source.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );

  return { source, statement };
}

async function fundedLoan() {
  const book = await fixture([
    { id: "loan_principal", code: "2893", name: "Owner loan principal" },
    { id: "loan_interest_expense", code: "8410", name: "Loan interest expense" },
    { id: "loan_interest_liability", code: "2960", name: "Accrued loan interest" },
    { id: "loan_fee", code: "6570", name: "Loan fees" },
  ]);

  const independent = await fixture();
  const reviewer = { ...book, actorId: independent.actorId, token: independent.token };
  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role)values($1,$2,'operator')",
      [book.bookId, reviewer.actorId],
    );
  } finally {
    await admin.end();
  }

  const funding = await bankSource(book, "10000000", "2026-09-01");

  const owner = await post(
    book,
    "/owner-register/owners",
    {
      sourceKey: key(),
      displayName: "Synthetic lender",
      dataNature: "synthetic_example",
      evidenceId: funding.source.id,
      reason: "Retain original owner identity",
    },
    Owners.Owner,
  );

  const review = await post(
    book,
    "/owner-operations/reviews",
    {
      mode: "owner_loan",
      ownerId: owner.id,
      controlAccountId: "loan_principal",
      cashAccountId: "account_bank",
      accountingPeriodId: "period_2026",
      postingDate: "2026-09-01",
      series: "A",
      reason: "Original source-backed principal",
      evidence: {
        fundingEvidenceId: funding.source.id,
        legalForm: "shareholder_loan",
        reason: "Synthetic fixed principal agreement",
        statementId: funding.statement.statement.id,
        rowOrdinal: 1,
      },
    },
    Operations.OwnerOperationReview,
  );

  const approval = await post(
    reviewer,
    `/owner-operations/reviews/${review.id}/approvals`,
    { version: 1, digest: review.digest },
    Operations.OwnerOperationApproval,
  );

  const funded = await post(
    book,
    `/owner-operations/reviews/${review.id}/execute`,
    { version: 1, digest: review.digest, approvalId: approval.id },
    Operations.OwnerOperationReceipt,
  );

  const agreement = await evidence(book);

  const adoptInput = {
    principalEffectId: funded.ownerEffectId,
    evidenceId: agreement.id,
    coverageStartOn: "2026-09-01",
    convention: "ACT/365F" as const,
    interestExpenseAccountId: "loan_interest_expense",
    accruedInterestLiabilityAccountId: "loan_interest_liability",
    feeExpenseAccountId: "loan_fee",
    reason: "Adopt the retained principal without posting again",
  };

  return { book, reviewer, owner, funded, agreement, adoptInput };
}

async function adoptedLoan() {
  const basis = await fundedLoan();
  const loan = await post(basis.book, loanRoot, basis.adoptInput, Loans.RetainedLoan);

  return { ...basis, loan };
}

function accrualInput(evidenceId: string, coverageEndExclusiveOn = "2026-10-01") {
  return {
    kind: "accrual" as const,
    coverageEndExclusiveOn,
    evidenceId,
    accountingPeriodId: "period_2026",
    postingDate: "2026-09-30",
    series: "A",
    reason: "Exact cumulative simple-interest target",
  };
}

async function rate(
  book: BookFixture,
  loan: typeof Loans.RetainedLoan.Type,
  evidenceId: string,
  effectiveOn = "2026-09-01",
  rateNumerator = "6",
) {
  return post(
    book,
    `${loanRoot}/${loan.id}/rates`,
    {
      evidenceId,
      effectiveOn,
      rateNumerator,
      rateDenominator: "100",
      reason: "Evidenced synthetic annual interest",
    },
    Loans.LoanRate,
  );
}

async function loanApproval(book: BookFixture, review: typeof Loans.LoanReview.Type) {
  return post(
    book,
    `${loanRoot}/reviews/${review.id}/approvals`,
    { digest: review.digest },
    Loans.LoanApproval,
  );
}

async function executeReview(
  book: BookFixture,
  review: typeof Loans.LoanReview.Type,
  approval: typeof Loans.LoanApproval.Type,
) {
  return post(
    book,
    `${loanRoot}/reviews/${review.id}/execute`,
    { digest: review.digest, approvalId: approval.id },
    Loans.LoanEvent,
  );
}

async function loanView(book: BookFixture, loan: typeof Loans.RetainedLoan.Type) {
  return decoded(await request(book, `${loanRoot}/${loan.id}`), Loans.LoanView);
}

async function ledgerState(book: BookFixture) {
  const admin = await database();

  try {
    return (
      await admin.query(
        `select
      (select count(*)::int from openerp.vouchers where book_id=$1) as vouchers,
      (select count(*)::int from openerp.owner_effects where book_id=$1) as owner_effects,
      (select count(*)::int from openerp.bank_matches where book_id=$1) as bank_matches,
      (select count(*)::int from openerp.treasury_loan_events where book_id=$1) as loan_events,
      (select count(*)::int from openerp.treasury_loan_allocations where book_id=$1) as allocations`,
        [book.bookId],
      )
    ).rows;
  } finally {
    await admin.end();
  }
}

test("loan adoption, cumulative accrual and repayment retain exact principal ownership with rollback and replay", async () => {
  const { book, owner, funded, agreement, adoptInput } = await fundedLoan();
  const adoptionKey = key();

  const adoptionCommand = {
    method: "POST",
    headers: { "idempotency-key": adoptionKey },
    body: JSON.stringify(adoptInput),
  };

  const loan = await decoded(await request(book, loanRoot, adoptionCommand), Loans.RetainedLoan);
  expect(loan.ledgerDeltaMinor).toBe("0");
  expect(loan.principal.id).toBe(funded.ownerEffectId);
  expect(await decoded(await request(book, loanRoot, adoptionCommand), Loans.RetainedLoan)).toEqual(
    loan,
  );
  await failure(
    await request(book, loanRoot, { method: "POST", body: JSON.stringify(adoptInput) }),
    409,
    "AlreadyPosted",
  );
  expect(await ledgerState(book)).toEqual([
    { vouchers: 1, owner_effects: 1, bank_matches: 1, loan_events: 0, allocations: 0 },
  ]);
  const observedRate = await rate(book, loan, agreement.id);

  const accrual = await post(
    book,
    `${loanRoot}/${loan.id}/reviews`,
    accrualInput(agreement.id),
    Loans.LoanReview,
  );

  expect(accrual.calculation?.targetMinor).toBe("49315");
  expect(accrual.calculation?.segments).toEqual([
    {
      fromOn: "2026-09-01",
      toExclusiveOn: "2026-10-01",
      principalMinor: "10000000",
      rateNumerator: "6",
      rateDenominator: "100",
      days: 30,
    },
  ]);

  if (!accrual.postingPlan) throw new Error("Expected retained accrual posting plan");
  await failure(
    await request(book, `/change-sets/${accrual.postingPlan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: accrual.postingPlan.planDigest }),
    }),
    403,
    "ApprovalRequired",
  );
  const action = accrual.postingPlan.groups[0]?.actions[0];

  if (!action) throw new Error("Expected exact retained accrual action");

  const alternate = await post(
    book,
    "/change-sets",
    {
      kind: "manual_journal",
      evidenceId: accrual.evidence.evidenceId,
      eventKey: accrual.id,
      accountingPeriodId: "period_2026",
      postingDate: action.postingDate,
      series: "A",
      description: action.description,
      rationale: "Attempt another plan for the retained event",
      taxAssessment: "not_applicable",
      lines: action.lines.map((line) => ({
        accountId: line.accountId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        description: line.description,
      })),
    },
    Accounting.ChangeSet,
  );

  await failure(
    await request(book, `/change-sets/${alternate.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: alternate.planDigest }),
    }),
    403,
    "ApprovalRequired",
  );
  const approved = await loanApproval(book, accrual);
  const executeKey = key();

  const executeCommand = {
    method: "POST",
    headers: { "idempotency-key": executeKey },
    body: JSON.stringify({ digest: accrual.digest, approvalId: approved.id }),
  };

  const accrued = await decoded(
    await request(book, `${loanRoot}/reviews/${accrual.id}/execute`, executeCommand),
    Loans.LoanEvent,
  );

  expect(accrued.interestMinor).toBe("49315");
  expect(
    await decoded(
      await request(book, `${loanRoot}/reviews/${accrual.id}/execute`, executeCommand),
      Loans.LoanEvent,
    ),
  ).toEqual(accrued);

  const sameCoverage = await post(
    book,
    `${loanRoot}/${loan.id}/reviews`,
    accrualInput(agreement.id),
    Loans.LoanReview,
  );

  expect(sameCoverage.calculation?.deltaMinor).toBe("0");
  expect(sameCoverage.postingPlan).toBeNull();
  const unchanged = await executeReview(book, sameCoverage, await loanApproval(book, sameCoverage));
  expect(unchanged.noJournal).toBe(true);
  expect(unchanged.interestMinor).toBe("0");
  expect(await ledgerState(book)).toEqual([
    { vouchers: 2, owner_effects: 1, bank_matches: 1, loan_events: 2, allocations: 0 },
  ]);
  const repaymentCash = await bankSource(book, "-1049315", "2026-10-01");

  const repaymentInput = {
    kind: "repayment" as const,
    evidenceId: repaymentCash.source.id,
    statementId: repaymentCash.statement.statement.id,
    rowOrdinal: 1,
    bankAccountId: "account_bank",
    principalPartMinor: "1000000",
    interestPartMinor: "49315",
    feePartMinor: "0",
    feeEvidenceId: null,
    accountingPeriodId: "period_2026",
    postingDate: "2026-10-01",
    series: "A",
    reason: "Explicit retained principal and interest allocation",
  };

  const repayment = await post(
    book,
    `${loanRoot}/${loan.id}/reviews`,
    repaymentInput,
    Loans.LoanReview,
  );

  const repaymentApproval = await loanApproval(book, repayment);
  const repaymentKey = key();

  const repaymentCommand = {
    method: "POST",
    headers: { "idempotency-key": repaymentKey },
    body: JSON.stringify({ digest: repayment.digest, approvalId: repaymentApproval.id }),
  };

  const before = await loanView(book, loan);
  const fault = await database();

  try {
    await fault.query(
      `create function openerp.synthetic_loan_allocation_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic late loan allocation failure'; end$$`,
    );
    await fault.query(
      "create trigger synthetic_loan_allocation_failure before insert on openerp.treasury_loan_allocations for each row execute function openerp.synthetic_loan_allocation_failure()",
    );
    await failure(
      await request(book, `${loanRoot}/reviews/${repayment.id}/execute`, repaymentCommand),
      500,
      "InternalError",
    );
    expect(await loanView(book, loan)).toEqual(before);
    expect(await ledgerState(book)).toEqual([
      { vouchers: 2, owner_effects: 1, bank_matches: 1, loan_events: 2, allocations: 0 },
    ]);
    expect(
      (
        await fault.query(
          "select count(*)::int as count from openerp.command_receipts where book_id=$1 and key=$2",
          [book.bookId, repaymentKey],
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
  } finally {
    await fault.query(
      "drop trigger if exists synthetic_loan_allocation_failure on openerp.treasury_loan_allocations",
    );
    await fault.query("drop function if exists openerp.synthetic_loan_allocation_failure()");
    await fault.end();
  }

  const repaid = await decoded(
    await request(book, `${loanRoot}/reviews/${repayment.id}/execute`, repaymentCommand),
    Loans.LoanEvent,
  );

  expect(repaid.principalMinor).toBe("1000000");
  expect(repaid.interestMinor).toBe("49315");
  expect(
    await decoded(
      await request(book, `${loanRoot}/reviews/${repayment.id}/execute`, repaymentCommand),
      Loans.LoanEvent,
    ),
  ).toEqual(repaid);
  const view = await loanView(book, loan);
  expect(view.balance).toEqual({
    principalRemainingMinor: "9000000",
    accruedInterestMinor: "49315",
    paidInterestMinor: "49315",
    interestRemainingMinor: "0",
    coverageEndExclusiveOn: "2026-10-01",
  });
  expect(await ledgerState(book)).toEqual([
    { vouchers: 3, owner_effects: 2, bank_matches: 2, loan_events: 3, allocations: 1 },
  ]);

  const control = await post(
    book,
    "/owner-register/controls",
    { ownerId: owner.id, startsOn: "2026-01-01", endsOn: "2026-12-31" },
    Owners.Control,
  );

  expect(control.ownerBalances).toEqual([
    {
      accountId: "loan_principal",
      recordedNetCreditMinor: "9000000",
      openExpenseMinor: "0",
      openLoanMinor: "9000000",
      unappliedReimbursementMinor: "0",
      unappliedLoanRepaymentMinor: "0",
      conditionalContributionMinor: "0",
      unconditionalContributionMinor: "0",
    },
  ]);
  expect(control.accountControls[0]?.unexplainedMinor).toBe("0");
  const inspect = await database();

  try {
    expect(
      (
        await inspect.query(
          "select account_id,(sum(debit_minor)-sum(credit_minor))::text as balance from openerp.journal_lines where book_id=$1 group by account_id order by account_id",
          [book.bookId],
        )
      ).rows,
    ).toEqual([
      { account_id: "account_bank", balance: "8950685" },
      { account_id: "loan_interest_expense", balance: "49315" },
      { account_id: "loan_interest_liability", balance: "0" },
      { account_id: "loan_principal", balance: "-9000000" },
    ]);
  } finally {
    await inspect.end();
  }

  await writeFile(
    join(environment().artifacts, "treasury-loan-lifecycle.json"),
    JSON.stringify(
      {
        expected: {
          adoptedLedgerDeltaMinor: "0",
          cumulativeInterestMinor: "49315",
          repaymentCashMinor: "1049315",
          remainingPrincipalMinor: "9000000",
        },
        loan,
        observedRate,
        accrual,
        accrued,
        sameCoverage,
        unchanged,
        repayment,
        repaid,
        view,
        control,
      },
      null,
      2,
    ),
  );
});

test("loan rate coverage, split segments, duplicate dates and stale approvals refuse unsupported history", async () => {
  const { book, loan, agreement } = await adoptedLoan();
  const input = accrualInput(agreement.id);
  await failure(
    await request(book, `${loanRoot}/${loan.id}/reviews`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
    422,
    "InvalidJournal",
  );
  await rate(book, loan, agreement.id, "2026-09-02");
  await failure(
    await request(book, `${loanRoot}/${loan.id}/reviews`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
    422,
    "InvalidJournal",
  );
  await rate(book, loan, agreement.id);
  await failure(
    await request(book, `${loanRoot}/${loan.id}/rates`, {
      method: "POST",
      body: JSON.stringify({
        effectiveOn: "2026-09-01",
        rateNumerator: "7",
        rateDenominator: "100",
        evidenceId: agreement.id,
        reason: "Conflicting rate at same effective date",
      }),
    }),
    409,
    "IdempotencyConflict",
  );
  const obsolete = await post(book, `${loanRoot}/${loan.id}/reviews`, input, Loans.LoanReview);
  const oldApproval = await loanApproval(book, obsolete);
  await rate(book, loan, agreement.id, "2026-09-16", "12");
  await failure(
    await request(book, `${loanRoot}/reviews/${obsolete.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ digest: obsolete.digest, approvalId: oldApproval.id }),
    }),
    409,
    "StaleDependency",
  );
  const split = await post(book, `${loanRoot}/${loan.id}/reviews`, input, Loans.LoanReview);
  expect(split.calculation?.targetMinor).toBe("73973");
  expect(split.calculation?.segments).toEqual([
    {
      fromOn: "2026-09-01",
      toExclusiveOn: "2026-09-02",
      principalMinor: "10000000",
      rateNumerator: "6",
      rateDenominator: "100",
      days: 1,
    },
    {
      fromOn: "2026-09-02",
      toExclusiveOn: "2026-09-16",
      principalMinor: "10000000",
      rateNumerator: "6",
      rateDenominator: "100",
      days: 14,
    },
    {
      fromOn: "2026-09-16",
      toExclusiveOn: "2026-10-01",
      principalMinor: "10000000",
      rateNumerator: "12",
      rateDenominator: "100",
      days: 15,
    },
  ]);
  const event = await executeReview(book, split, await loanApproval(book, split));
  await rate(book, loan, agreement.id, "2026-09-17", "9");
  expect((await loanView(book, loan)).balance.accruedInterestMinor).toBe("73973");
  await writeFile(
    join(environment().artifacts, "treasury-loan-rates.json"),
    JSON.stringify({ split, event, expectedInterestMinor: "73973" }, null, 2),
  );
});

test("loan principal timeline includes repayments made by the existing owner before adoption", async () => {
  const { book, reviewer, owner, funded, agreement, adoptInput } = await fundedLoan();
  const cash = await bankSource(book, "-1000000", "2026-09-10");

  const repayment = await post(
    book,
    "/owner-operations/reviews",
    {
      mode: "repay_owner_loan",
      ownerId: owner.id,
      controlAccountId: "loan_principal",
      cashAccountId: "account_bank",
      accountingPeriodId: "period_2026",
      postingDate: "2026-09-10",
      series: "A",
      reason: "Existing owner repayment before agreement adoption",
      evidence: {
        cashEvidenceId: cash.source.id,
        statementId: cash.statement.statement.id,
        rowOrdinal: 1,
        loanEffectId: funded.ownerEffectId,
        reason: "Existing owner consumes original principal",
      },
    },
    Operations.OwnerOperationReview,
  );

  const approval = await post(
    reviewer,
    `/owner-operations/reviews/${repayment.id}/approvals`,
    { version: 1, digest: repayment.digest },
    Operations.OwnerOperationApproval,
  );

  await post(
    book,
    `/owner-operations/reviews/${repayment.id}/execute`,
    { version: 1, digest: repayment.digest, approvalId: approval.id },
    Operations.OwnerOperationReceipt,
  );
  const loan = await post(book, loanRoot, adoptInput, Loans.RetainedLoan);
  await rate(book, loan, agreement.id);

  const accrual = await post(
    book,
    `${loanRoot}/${loan.id}/reviews`,
    accrualInput(agreement.id),
    Loans.LoanReview,
  );

  expect(accrual.basis.principalRemainingMinor).toBe("9000000");
  expect(accrual.calculation?.targetMinor).toBe("46027");
  expect(accrual.calculation?.segments).toEqual([
    {
      fromOn: "2026-09-01",
      toExclusiveOn: "2026-09-11",
      principalMinor: "10000000",
      rateNumerator: "6",
      rateDenominator: "100",
      days: 10,
    },
    {
      fromOn: "2026-09-11",
      toExclusiveOn: "2026-10-01",
      principalMinor: "9000000",
      rateNumerator: "6",
      rateDenominator: "100",
      days: 20,
    },
  ]);
  const result = await executeReview(book, accrual, await loanApproval(book, accrual));
  await writeFile(
    join(environment().artifacts, "treasury-loan-existing-owner-timeline.json"),
    JSON.stringify({ loan, accrual, result, expectedInterestMinor: "46027" }, null, 2),
  );
});

test("loan repayments enforce exact source amounts and race principal capacity atomically", async () => {
  const { book, loan } = await adoptedLoan();
  const cash = await bankSource(book, "-6000000", "2026-10-01", "-6000000");

  const input = {
    kind: "repayment" as const,
    statementId: cash.statement.statement.id,
    rowOrdinal: 1,
    bankAccountId: "account_bank",
    principalPartMinor: "6000000",
    interestPartMinor: "0",
    feePartMinor: "0",
    feeEvidenceId: null,
    evidenceId: cash.source.id,
    accountingPeriodId: "period_2026",
    postingDate: "2026-10-01",
    series: "A",
    reason: "Retained exact principal repayment",
  };

  await failure(
    await request(book, `${loanRoot}/${loan.id}/reviews`, {
      method: "POST",
      body: JSON.stringify({ ...input, principalPartMinor: "11000000" }),
    }),
    422,
    "InvalidJournal",
  );
  await failure(
    await request(book, `${loanRoot}/${loan.id}/reviews`, {
      method: "POST",
      body: JSON.stringify({ ...input, principalPartMinor: "5999999" }),
    }),
    422,
    "InvalidJournal",
  );
  await failure(
    await request(book, `${loanRoot}/${loan.id}/reviews`, {
      method: "POST",
      body: JSON.stringify({ ...input, principalPartMinor: "5999900", interestPartMinor: "100" }),
    }),
    422,
    "InvalidJournal",
  );
  const first = await post(book, `${loanRoot}/${loan.id}/reviews`, input, Loans.LoanReview);

  const second = await post(
    book,
    `${loanRoot}/${loan.id}/reviews`,
    { ...input, rowOrdinal: 2 },
    Loans.LoanReview,
  );

  const firstApproval = await loanApproval(book, first);
  const secondApproval = await loanApproval(book, second);

  const sameSource = await post(
    book,
    `${loanRoot}/${loan.id}/reviews`,
    { ...input, reason: "A second sealed consumer of the first bank row" },
    Loans.LoanReview,
  );

  const sameSourceApproval = await loanApproval(book, sameSource);

  const responses = await Promise.all([
    request(book, `${loanRoot}/reviews/${first.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ digest: first.digest, approvalId: firstApproval.id }),
    }),
    request(book, `${loanRoot}/reviews/${second.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ digest: second.digest, approvalId: secondApproval.id }),
    }),
    request(book, `${loanRoot}/reviews/${sameSource.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ digest: sameSource.digest, approvalId: sameSourceApproval.id }),
    }),
  ]);

  expect(responses.map((response) => response.status).sort((left, right) => left - right)).toEqual([
    200, 409, 409,
  ]);
  const successful = responses.find((response) => response.status === 200);
  const refused = responses.filter((response) => response.status === 409);

  if (!successful || refused.length !== 2)
    throw new Error("Expected one committed principal consumer and one refusal");
  const event = await decoded(successful, Loans.LoanEvent);

  for (const response of refused) await failure(response, 409, "StaleDependency");
  const view = await loanView(book, loan);
  expect(view.balance.principalRemainingMinor).toBe("4000000");
  expect(await ledgerState(book)).toEqual([
    { vouchers: 2, owner_effects: 2, bank_matches: 2, loan_events: 1, allocations: 1 },
  ]);
  await writeFile(
    join(environment().artifacts, "treasury-loan-capacity-race.json"),
    JSON.stringify(
      { first, second, sameSource, event, view, expectedRemainingMinor: "4000000" },
      null,
      2,
    ),
  );
});

test("loan approval expiry and agent approval refusal preserve an operator-to-agent execution handoff", async () => {
  const { book, loan, agreement } = await adoptedLoan();
  await rate(book, loan, agreement.id);

  const review = await post(
    book,
    `${loanRoot}/${loan.id}/reviews`,
    accrualInput(agreement.id),
    Loans.LoanReview,
  );

  const agent = { ...book, token: book.agentToken, actorId: book.agentId };
  await failure(
    await request(agent, `${loanRoot}/reviews/${review.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ digest: review.digest }),
    }),
    403,
    "Forbidden",
  );
  const wrong = `sha256:${"0".repeat(64)}`;
  await failure(
    await request(book, `${loanRoot}/reviews/${review.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ digest: wrong }),
    }),
    409,
    "StaleDependency",
  );
  const approval = await loanApproval(book, review);
  const admin = await database();

  try {
    await admin.query(
      "alter table openerp.treasury_loan_approvals disable trigger immutable_treasury_loan_approval",
    );
    await admin.query(
      `update openerp.treasury_loan_approvals set expires_at='2020-01-01T00:00:00.000Z'::timestamptz,
      body=(body||jsonb_build_object('expiresAt','2020-01-01T00:00:00.000Z'))||jsonb_build_object('digest',
      openerp.digest((body||jsonb_build_object('expiresAt','2020-01-01T00:00:00.000Z'))-'digest'))
      where book_id=$1 and id=$2`,
      [book.bookId, approval.id],
    );
  } finally {
    await admin.query(
      "alter table openerp.treasury_loan_approvals enable trigger immutable_treasury_loan_approval",
    );
    await admin.end();
  }

  await failure(
    await request(book, `${loanRoot}/reviews/${review.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ digest: review.digest, approvalId: approval.id }),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await ledgerState(book)).toEqual([
    { vouchers: 1, owner_effects: 1, bank_matches: 1, loan_events: 0, allocations: 0 },
  ]);
  const refreshed = await loanApproval(book, review);
  expect(refreshed.actorId).toBe(book.actorId);
  const executeKey = key();
  const executionInput = { digest: review.digest, approvalId: refreshed.id };

  const result = await decoded(
    await request(agent, `${loanRoot}/reviews/${review.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": executeKey },
      body: JSON.stringify(executionInput),
    }),
    Loans.LoanEvent,
  );

  expect(result.interestMinor).toBe("49315");
  expect(result.receipt.actorId).toBe(book.agentId);

  const replayed = await decoded(
    await request(agent, `${loanRoot}/reviews/${review.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": executeKey },
      body: JSON.stringify(executionInput),
    }),
    Loans.LoanEvent,
  );

  expect(replayed).toEqual(result);
  const approvalState = await database();
  let consumed;

  try {
    consumed = (
      await approvalState.query(
        "select a.actor_id,a.expires_at::text,a.consumed_at is not null as consumed,e.approval_id from openerp.approvals a join openerp.execution_receipts e on e.book_id=a.book_id and e.approval_id=a.id where a.book_id=$1 and a.id=$2 and e.id=$3",
        [book.bookId, refreshed.kernelApprovalId, result.postingReceipt?.id],
      )
    ).rows;
    expect(
      consumed.map((row) => ({
        actor: row.actor_id,
        consumed: row.consumed,
        approval: row.approval_id,
      })),
    ).toEqual([{ actor: book.actorId, consumed: true, approval: refreshed.kernelApprovalId }]);
  } finally {
    await approvalState.end();
  }

  expect(await ledgerState(book)).toEqual([
    { vouchers: 2, owner_effects: 1, bank_matches: 1, loan_events: 1, allocations: 0 },
  ]);
  await writeFile(
    join(environment().artifacts, "treasury-loan-expiry.json"),
    JSON.stringify(
      {
        review,
        expiredApprovalId: approval.id,
        refreshed,
        result,
        replayed,
        consumed,
        expectedInterestMinor: "49315",
      },
      null,
      2,
    ),
  );
});

test("loan repayment fees require separate retained evidence and post the exact cash split", async () => {
  const { book, loan } = await adoptedLoan();
  const cash = await bankSource(book, "-1000025", "2026-10-01");

  const input = {
    kind: "repayment" as const,
    statementId: cash.statement.statement.id,
    rowOrdinal: 1,
    bankAccountId: "account_bank",
    principalPartMinor: "1000000",
    interestPartMinor: "0",
    feePartMinor: "25",
    feeEvidenceId: null,
    evidenceId: cash.source.id,
    accountingPeriodId: "period_2026",
    postingDate: "2026-10-01",
    series: "A",
    reason: "Explicit principal allocation and independently evidenced fee",
  };

  await failure(
    await request(book, `${loanRoot}/${loan.id}/reviews`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
    422,
    "MissingEvidence",
  );

  const feeEvidence = await evidence(book);

  const review = await post(
    book,
    `${loanRoot}/${loan.id}/reviews`,
    { ...input, feeEvidenceId: feeEvidence.id },
    Loans.LoanReview,
  );

  const result = await executeReview(book, review, await loanApproval(book, review));
  const view = await loanView(book, loan);

  expect(result.feeMinor).toBe("25");
  expect(view.balance.principalRemainingMinor).toBe("9000000");
  const admin = await database();

  try {
    expect(
      (
        await admin.query(
          "select account_id,(sum(debit_minor)-sum(credit_minor))::text as balance from openerp.journal_lines where book_id=$1 group by account_id order by account_id",
          [book.bookId],
        )
      ).rows,
    ).toEqual([
      { account_id: "account_bank", balance: "8999975" },
      { account_id: "loan_fee", balance: "25" },
      { account_id: "loan_principal", balance: "-9000000" },
    ]);
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "treasury-loan-fee.json"),
    JSON.stringify(
      {
        review,
        result,
        view,
        expectedCashMinor: "1000025",
        expectedFeeMinor: "25",
        expectedPrincipalMinor: "9000000",
      },
      null,
      2,
    ),
  );
});

test("backdated evidenced rates post only the cumulative interest difference", async () => {
  const { book, loan, agreement } = await adoptedLoan();
  const input = accrualInput(agreement.id);

  await rate(book, loan, agreement.id);
  const original = await post(book, `${loanRoot}/${loan.id}/reviews`, input, Loans.LoanReview);

  await executeReview(book, original, await loanApproval(book, original));
  expect(original.calculation?.targetMinor).toBe("49315");

  const obsolete = await post(book, `${loanRoot}/${loan.id}/reviews`, input, Loans.LoanReview);

  const obsoleteApproval = await loanApproval(book, obsolete);

  await post(
    book,
    `${loanRoot}/${loan.id}/rates`,
    {
      effectiveOn: "2026-09-16",
      rateNumerator: "65",
      rateDenominator: "1000",
      evidenceId: agreement.id,
      reason: "Backdated evidenced rate increase",
    },
    Loans.LoanRate,
  );
  await failure(
    await request(book, `${loanRoot}/reviews/${obsolete.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ digest: obsolete.digest, approvalId: obsoleteApproval.id }),
    }),
    409,
    "StaleDependency",
  );
  const review = await post(book, `${loanRoot}/${loan.id}/reviews`, input, Loans.LoanReview);

  expect(review.calculation?.targetMinor).toBe("51370");
  expect(review.calculation?.deltaMinor).toBe("2055");
  expect(review.calculation?.priorEffectiveMinor).toBe("49315");

  const directory = await decoded(await request(book, loanRoot), Loans.LoanPage);

  expect(directory.items.some((item) => item.id === loan.id)).toBe(true);

  const reviews = await decoded(
    await request(book, `${loanRoot}/${loan.id}/reviews`),
    Loans.LoanReviewPage,
  );

  expect(reviews.items.some((item) => item.id === review.id)).toBe(true);

  const other = await fixture();

  await failure(await request(other, `${loanRoot}/${loan.id}/reviews`), 404, "NotFound");
  await failure(await request(other, `${loanRoot}?after=${loan.id}`), 404, "NotFound");
  await failure(
    await request(book, `${loanRoot}/${loan.id}/reviews?after=missing_review`),
    404,
    "NotFound",
  );

  const event = await executeReview(book, review, await loanApproval(book, review));

  expect(event.interestMinor).toBe("2055");
  expect((await loanView(book, loan)).balance.accruedInterestMinor).toBe("51370");
  await post(
    book,
    `${loanRoot}/${loan.id}/rates`,
    {
      effectiveOn: "2026-09-17",
      rateNumerator: "5",
      rateDenominator: "100",
      evidenceId: agreement.id,
      reason: "Backdated evidenced rate decrease",
    },
    Loans.LoanRate,
  );
  await failure(
    await request(book, `${loanRoot}/${loan.id}/reviews`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
    422,
    "InvalidJournal",
  );

  const corrected = await post(
    book,
    `${loanRoot}/${loan.id}/reviews`,
    { ...input, correctionReason: "Independent correction of overstated interest" },
    Loans.LoanReview,
  );

  expect(BigInt(corrected.calculation?.deltaMinor ?? "0") < 0n).toBe(true);
  const correctedEvent = await executeReview(book, corrected, await loanApproval(book, corrected));

  expect(correctedEvent.interestMinor).toBe(corrected.calculation?.deltaMinor);
  await writeFile(
    join(environment().artifacts, "treasury-backdated-recalculation.json"),
    JSON.stringify({ original, review, event, corrected, correctedEvent }, null, 2),
  );
});
