import * as Commerce from "@open-erp/contracts/commerce";
import * as CommerceFx from "@open-erp/contracts/commerce-fx";
import * as Rates from "@open-erp/contracts/exchange-rates";
import { expect, test } from "vitest";
import {
  createSession,
  database,
  decoded,
  evidence,
  fixture,
  key,
  post,
  request,
} from "./support/fixtures";

// NEXT-18. Incremental open-item FX remeasurement.
//
// The reporting rate comes from the real exchange-rate owner. The FX item is
// staged as fixture data, but its body is validated against the real
// MonetaryItem schema before it is inserted, so the owner reads exactly what
// the recognition flow would have retained. Expected valuation figures are
// derived by hand from the retained remaining and the retained rate revision,
// never from the remeasurement compiler.
//
// Fixture: one USD receivable, 10000 foreign minor ($100.00) recognised at
// 10.00, so the retained book carrying is 100000 SEK minor. The reporting
// rate is 10.85, so the target is 108500 and the expected delta is +8500.

async function setup() {
  const second = await fixture();

  const book = await fixture([
    { id: "account_control", code: "1510", name: "Foreign receivables" },
    { id: "account_revenue", code: "3050", name: "Synthetic revenue" },
    { id: "account_gain", code: "3960", name: "Unrealized FX gains" },
    { id: "account_loss", code: "3961", name: "Unrealized FX losses" },
  ]);

  // The four-eyes rule needs a second operator who did not prepare the plan.
  // Both fixtures provision their own books, so the second actor is admitted
  // to the first book here rather than operating on its own.
  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.memberships(book_id, actor_id, role) VALUES ($1, $2, 'operator')",
      [book.bookId, second.actorId],
    );
  } finally {
    await admin.end();
  }

  const reviewer = {
    ...book,
    actorId: second.actorId,
    token: (await createSession(second)).token,
  };

  // The fixture provisions fy_2026/period_2026 (2026-01-01 to 2026-12-31), so
  // the cutoff below falls inside a real open period.
  const source = await evidence(book);

  return { book, reviewer, source };
}

async function reportingRate(
  book: Awaited<ReturnType<typeof fixture>>,
  evidenceId: string,
  reviewEvidenceId: string,
  numerator = "1085",
  denominator = "100",
) {
  const created = await post(
    book,
    "/exchange-rates",
    {
      sourceKey: `synthetic-usd-sek-${key()}`,
      terms: {
        fromCurrency: "USD",
        toCurrency: "SEK",
        effectiveOn: "2026-01-15",
        retrievedOn: "2026-01-16",
        rateNumerator: numerator,
        rateDenominator: denominator,
        evidenceId,
        sourceLocator: "synthetic-test-fixture",
        reviewEvidenceId,
        rationale: "Synthetic reporting rate for NEXT-18",
      },
    },
    Rates.ExchangeRateRevision,
  );

  return created;
}

// A retained FX item exactly as the recognition flow would have left it: an
// open USD receivable with 10000 foreign minor remaining and 100000 book minor
// carried. The body is decoded against the real MonetaryItem schema before it
// is inserted, so an invalid fixture fails here rather than inside the owner.
// A real open item, created through the existing recognition owner. Its parents
// (review, approval, receipt) are therefore genuine retained rows, not staged
// copies, and the remeasurement below composes the actual FX state.
// A bank source registration is retained setup: the cash account of a
// recognition must be a registered bank source, not merely a ledger account.
async function registerBankSource(bookId: string, accountId: string) {
  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.bank_sources(book_id, account_id, source_bank_account_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [bookId, accountId, `synthetic_bank_${accountId}`],
    );
  } finally {
    await admin.end();
  }
}

async function stageItem(
  book: Awaited<ReturnType<typeof fixture>>,
  reviewer: Awaited<ReturnType<typeof fixture>>,
  source: { readonly id: string; readonly sha256: string },
  itemTag: string,
) {
  const evidenceId = source.id;

  await registerBankSource(book.bookId, "account_bank");

  // The item is recognised at 10.00, so its retained carrying is 100000. The
  // reporting rate passed in is 10.85, so remeasurement must find +8500.
  const recognitionRateRevision = await reportingRate(book, evidenceId, evidenceId, "1000", "100");

  const counterparty = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: `synthetic_customer_${itemTag}`,
      role: "customer",
      displayName: "Synthetic Customer",
      evidenceId,
      reason: "Synthetic counterparty for NEXT-18",
    },
    Commerce.CounterpartyRevision,
  );

  const recognition = await post(
    book,
    "/commerce/fx/recognition-reviews",
    {
      profile: "synthetic_customer_foreign_receivable_v1",
      sourceKey: `synthetic_source_${itemTag}`,
      sourceRevision: "1",
      counterpartyId: counterparty.id,
      counterpartyRevision: counterparty.revision,
      documentNumber: `INV-${itemTag}`,
      recognitionDate: "2026-01-15",
      originalCurrency: "USD",
      originalScale: 2,
      originalMinor: "10000",
      rateObservationId: recognitionRateRevision.observationId,
      rateDigest: recognitionRateRevision.digest,
      accountingPeriodId: "period_2026",
      series: "VER",
      controlAccountId: "account_control",
      cashAccountId: "account_bank",
      realizedGainAccountId: "account_gain",
      realizedLossAccountId: "account_loss",
      accountRoleEvidence: { evidenceId, sha256: source.sha256 },
      evidenceId,
      eventKey: `synthetic_recognition_${itemTag}`,
      reason: "Synthetic recognition for NEXT-18",
      revenueAccountId: "account_revenue",
      syntheticNoTaxConfirmed: true,
      acknowledgeLimitedProfile: true,
    },
    CommerceFx.RecognitionReview,
  );

  const recognitionApproval = await post(
    reviewer,
    `/commerce/fx/recognition-reviews/${recognition.id}/approvals`,
    { version: 1, digest: recognition.digest },
    CommerceFx.FxApproval,
  );

  // Execution returns the retained item itself, so its identity comes from
  // the owner rather than from a follow-up read.
  const item = await post(
    book,
    `/commerce/fx/recognition-reviews/${recognition.id}/execute`,
    { version: 1, digest: recognition.digest, approvalId: recognitionApproval.id },
    CommerceFx.MonetaryItem,
  );

  return item.id;
}

const input = {
  accountingCutoff: "2026-01-31",
  bookScale: 2,
  unrealizedGainAccountId: "account_gain",
  unrealizedLossAccountId: "account_loss",
  rounding: "exact" as const,
  economicDecisionId: "decision_synthetic",
  fiscalYearId: "fy_2026",
  accountingPeriodId: "period_2026",
  series: "VER",
  reason: "Synthetic month-end remeasurement",
};

test("NEXT-18 remeasures an open item against a retained rate and posts the delta", async () => {
  const { book, reviewer, source } = await setup();
  const review = await evidence(book);
  const rate = await reportingRate(book, source.id, review.id);

  const itemOne = await stageItem(book, reviewer, source, "one");

  const prepared = await post(
    book,
    "/commerce/fx/remeasurement-reviews",
    {
      itemIds: [itemOne],
      rateObservationId: rate.observationId,
      rateDigest: rate.digest,
      ...input,
    },
    CommerceFx.RemeasurementReview,
  );

  // Independent expectation: 10000 foreign minor at 10.85 is 108500 book
  // minor, less 100000 carried is a +8500 gain.
  expect(prepared.plan.effects).toHaveLength(1);
  expect(prepared.plan.effects[0]?.targetCarryingMinor).toBe("108500");
  expect(prepared.plan.effects[0]?.deltaMinor).toBe("8500");
  expect(prepared.plan.consumesVoucher).toBe(true);

  const debits = prepared.plan.journal.reduce((carry, line) => carry + BigInt(line.debitMinor), 0n);

  const credits = prepared.plan.journal.reduce(
    (carry, line) => carry + BigInt(line.creditMinor),
    0n,
  );

  expect(prepared.plan.journal.length).toBeGreaterThan(0);
  expect(debits).toBe(credits);
  expect(
    prepared.plan.journal.some(
      (line) => line.accountId === "account_gain" && line.creditMinor === "8500",
    ),
  ).toBe(true);

  const approval = await post(
    reviewer,
    `/commerce/fx/remeasurement-reviews/${prepared.id}/approvals`,
    { version: 1, digest: prepared.digest },
    CommerceFx.RemeasurementApproval,
  );

  const executed = await post(
    book,
    `/commerce/fx/remeasurement-reviews/${prepared.id}/execute`,
    { version: 1, digest: prepared.digest, approvalId: approval.id },
    CommerceFx.RemeasurementExecuted,
  );

  expect(executed.effectCount).toBe(1);
  expect(executed.voucherId).not.toBeNull();

  // The retained voucher carries the exact delta the plan sealed.
  const admin = await database();

  try {
    const lines = await admin.query(
      "select account_id, debit_minor, credit_minor from openerp.journal_lines where book_id=$1 and voucher_id=$2 order by ordinal",
      [book.bookId, executed.voucherId],
    );

    const gain = lines.rows.find((row) => row.account_id === "account_gain");

    expect(gain?.credit_minor).toBe("8500");

    const control = lines.rows.find((row) => row.account_id === "account_control");

    expect(control?.debit_minor).toBe("8500");
  } finally {
    await admin.end();
  }

  const reread = await decoded(
    await request(book, `/commerce/fx/remeasurement-reviews/${prepared.id}`),
    CommerceFx.RemeasurementReview,
  );

  expect(reread.digest).toBe(prepared.digest);
});

test("NEXT-18 refuses a population that is not the complete eligible set", async () => {
  const { book, reviewer, source } = await setup();
  const review = await evidence(book);
  const rate = await reportingRate(book, source.id, review.id);

  const itemTwo = await stageItem(book, reviewer, source, "two");
  await stageItem(book, reviewer, source, "three");

  // Two items are eligible but only one is named. Completeness is proved,
  // never assumed.
  const response = await request(book, "/commerce/fx/remeasurement-reviews", {
    method: "POST",
    body: JSON.stringify({
      itemIds: [itemTwo],
      rateObservationId: rate.observationId,
      rateDigest: rate.digest,
      ...input,
    }),
  });

  expect(response.status).toBe(422);
});

test("NEXT-18 refuses a withdrawn reporting rate", async () => {
  const { book, reviewer, source } = await setup();
  const review = await evidence(book);
  const rate = await reportingRate(book, source.id, review.id);

  const itemFour = await stageItem(book, reviewer, source, "four");

  await post(
    book,
    `/exchange-rates/${rate.observationId}/withdrawals`,
    {
      expectedDigest: rate.digest,
      evidenceId: source.id,
      rationale: "Synthetic withdrawal before remeasurement",
    },
    Rates.ExchangeRateWithdrawal,
  );

  const response = await request(book, "/commerce/fx/remeasurement-reviews", {
    method: "POST",
    body: JSON.stringify({
      itemIds: [itemFour],
      rateObservationId: rate.observationId,
      rateDigest: rate.digest,
      ...input,
    }),
  });

  expect(response.status).toBe(409);
});
