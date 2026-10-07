import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assetClients } from "./asset-fixture-clients.mjs";

export const loanAccounts = [
  { id: "loan_principal", code: "2893", name: "Lån från aktieägare" },
  { id: "loan_interest_expense", code: "8410", name: "Räntekostnader för långfristiga skulder" },
  { id: "loan_interest_liability", code: "2960", name: "Upplupna räntekostnader" },
  { id: "loan_fee", code: "6570", name: "Bankkostnader" },
];

export async function seedLoans(config) {
  const { book, author, reviewer, post } = await assetClients(config);

  const period = config.fixture.periods[0].id;

  const declaration = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: randomUUID(),
    sourceBankAccountId: "synthetic_loan_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-09-01",
    endsOn: "2026-09-01",
    openingMinor: "0",
    closingMinor: "10000000",
    completeness: { declaredComplete: true, basis: "Independent synthetic principal source" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: randomUUID(),
        date: "2026-09-01",
        description: "Synthetic loan principal",
        amountMinor: "10000000",
      },
    ],
  };

  const funding = await post(book, "/evidence", {
    title: "Synthetic loan principal source",
    content: JSON.stringify(declaration),
    mediaType: "application/json",
    origin: "O23 independent synthetic source",
  });

  const statement = await post(book, "/bank-statements", {
    ...declaration,
    evidenceId: funding.id,
    existingMatches: [],
  });

  const owner = await post(book, "/owner-register/owners", {
    sourceKey: randomUUID(),
    displayName: "Synthetic lender",
    dataNature: "synthetic_example",
    evidenceId: funding.id,
    reason: "Synthetic original lender",
  });

  const fundingReview = await post(book, "/owner-operations/reviews", {
    mode: "owner_loan",
    ownerId: owner.id,
    controlAccountId: "loan_principal",
    cashAccountId: "account_bank",
    accountingPeriodId: period,
    postingDate: "2026-09-01",
    series: "A",
    reason: "Source-backed synthetic borrowing",
    evidence: {
      fundingEvidenceId: funding.id,
      legalForm: "shareholder_loan",
      reason: "Synthetic agreement",
      statementId: statement.statement.id,
      rowOrdinal: 1,
    },
  });

  const fundingApproval = await post(
    reviewer,
    `/owner-operations/reviews/${fundingReview.id}/approvals`,
    { version: 1, digest: fundingReview.digest },
  );

  const funded = await post(author, `/owner-operations/reviews/${fundingReview.id}/execute`, {
    version: 1,
    digest: fundingReview.digest,
    approvalId: fundingApproval.id,
  });

  const agreement = await post(book, "/evidence", {
    title: "Låneavtal.pdf",
    content:
      "Synthetic loan agreement: 6% simple annual interest, ACT/365F, principal SEK100000. No real company or lender.",
    mediaType: "text/plain",
    origin: "Synthetic O23 agreement text",
  });

  const notice = await post(book, "/evidence", {
    title: "Aviseringsbrev 2 okt.pdf",
    content: "Synthetic notice: 6.5% from 2026-09-16. No real company or lender.",
    mediaType: "text/plain",
    origin: "Synthetic O23 retrospective notice text",
  });

  const root = "/treasury/loans";

  const loan = await post(book, root, {
    principalEffectId: funded.ownerEffectId,
    evidenceId: agreement.id,
    coverageStartOn: "2026-09-01",
    convention: "ACT/365F",
    interestExpenseAccountId: "loan_interest_expense",
    accruedInterestLiabilityAccountId: "loan_interest_liability",
    feeExpenseAccountId: "loan_fee",
    reason: "Adopt previously posted principal without another journal",
  });

  await post(book, `${root}/${loan.id}/rates`, {
    effectiveOn: "2026-09-01",
    rateNumerator: "6",
    rateDenominator: "100",
    evidenceId: agreement.id,
    reason: "Synthetic agreed initial rate",
  });

  const input = {
    kind: "accrual",
    coverageEndExclusiveOn: "2026-10-01",
    evidenceId: notice.id,
    accountingPeriodId: period,
    postingDate: "2026-09-30",
    series: "A",
    reason: "Exact cumulative synthetic interest",
  };

  const original = await post(book, `${root}/${loan.id}/reviews`, {
    ...input,
    evidenceId: agreement.id,
  });

  const approval = await post(author, `${root}/reviews/${original.id}/approvals`, {
    digest: original.digest,
  });

  await post(author, `${root}/reviews/${original.id}/execute`, {
    digest: original.digest,
    approvalId: approval.id,
  });
  await post(book, `${root}/${loan.id}/rates`, {
    effectiveOn: "2026-09-16",
    rateNumerator: "65",
    rateDenominator: "1000",
    evidenceId: notice.id,
    reason: "Synthetic evidenced retrospective rate increase",
  });

  const review = await post(book, `${root}/${loan.id}/reviews`, input);

  if (review.calculation.targetMinor !== "51370" || review.calculation.deltaMinor !== "2055")
    throw new Error("Synthetic loan recalculation drift");

  const result = {
    frame: "O23",
    loanId: loan.id,
    reviewId: review.id,
    originalReviewId: original.id,
    agreementEvidenceId: agreement.id,
    noticeEvidenceId: notice.id,
  };

  await writeFile(
    join(config.artifacts, "loan-recalculation-fixture.json"),
    JSON.stringify(result, null, 2),
  );

  return result;
}
