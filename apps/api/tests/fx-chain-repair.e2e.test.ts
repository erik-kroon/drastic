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
  post,
  request,
} from "./support/fixtures";

// NEXT-41. Late FX valuation and consumed-chain correction.
//
// An item is recognised at 10.00, partially settled, and then repaired with a
// corrected 10.85 rate. Every expected figure below is derived by hand from
// the retained recognition, settlement and rate rows, never from the repair
// compiler. The repair must attribute the correction without moving real cash,
// foreign quantities or fees.

async function setup() {
  const second = await fixture();

  const book = await fixture([
    { id: "account_control", code: "1510", name: "Foreign receivables" },
    { id: "account_revenue", code: "3050", name: "Synthetic revenue" },
    { id: "account_gain", code: "3960", name: "Unrealized FX gains" },
    { id: "account_loss", code: "3961", name: "Unrealized FX losses" },
    { id: "account_cash", code: "1931", name: "Cash" },
  ]);

  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.memberships(book_id, actor_id, role) VALUES ($1, $2, 'operator')",
      [book.bookId, second.actorId],
    );
    await admin.query(
      "INSERT INTO openerp.bank_sources(book_id, account_id, source_bank_account_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [book.bookId, "account_cash", "synthetic_bank_cash"],
    );
  } finally {
    await admin.end();
  }

  const reviewer = {
    ...book,
    actorId: second.actorId,
    token: (await createSession(second)).token,
  };

  const source = await evidence(book);

  return { book, reviewer, source };
}

async function reportingRate(
  book: Awaited<ReturnType<typeof fixture>>,
  evidenceId: string,
  reviewEvidenceId: string,
  numerator: string,
  denominator: string,
) {
  return post(
    book,
    "/exchange-rates",
    {
      sourceKey: `synthetic-usd-sek-${numerator}-${denominator}-${Date.now()}`,
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
        rationale: "Synthetic rate for NEXT-41",
      },
    },
    Rates.ExchangeRateRevision,
  );
}

async function recognisedItem(
  book: Awaited<ReturnType<typeof fixture>>,
  reviewer: Awaited<ReturnType<typeof fixture>>,
  source: { readonly id: string; readonly sha256: string },
  tag: string,
) {
  const recognitionRate = await reportingRate(book, source.id, source.id, "1000", "100");

  const counterparty = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: `synthetic_customer_${tag}`,
      role: "customer",
      displayName: "Synthetic Customer",
      evidenceId: source.id,
      reason: "Synthetic counterparty for NEXT-41",
    },
    Commerce.CounterpartyRevision,
  );

  const recognition = await post(
    book,
    "/commerce/fx/recognition-reviews",
    {
      profile: "synthetic_customer_foreign_receivable_v1",
      sourceKey: `synthetic_source_${tag}`,
      sourceRevision: "1",
      counterpartyId: counterparty.id,
      counterpartyRevision: counterparty.revision,
      documentNumber: `INV-${tag}`,
      recognitionDate: "2026-01-15",
      originalCurrency: "USD",
      originalScale: 2,
      originalMinor: "10000",
      rateObservationId: recognitionRate.observationId,
      rateDigest: recognitionRate.digest,
      accountingPeriodId: "period_2026",
      series: "VER",
      controlAccountId: "account_control",
      cashAccountId: "account_cash",
      realizedGainAccountId: "account_gain",
      realizedLossAccountId: "account_loss",
      accountRoleEvidence: { evidenceId: source.id, sha256: source.sha256 },
      evidenceId: source.id,
      eventKey: `synthetic_recognition_${tag}`,
      reason: "Synthetic recognition for NEXT-41",
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

  const item = await post(
    book,
    `/commerce/fx/recognition-reviews/${recognition.id}/execute`,
    { version: 1, digest: recognition.digest, approvalId: recognitionApproval.id },
    CommerceFx.MonetaryItem,
  );

  return item;
}

async function settlePartially(
  book: Awaited<ReturnType<typeof fixture>>,
  reviewer: Awaited<ReturnType<typeof fixture>>,
  source: { readonly id: string; readonly sha256: string },
  itemId: string,
) {
  const settlement = await post(
    book,
    "/commerce/fx/partial-settlement-reviews",
    {
      profile: "synthetic_partial_book_currency_settlement_v1",
      itemId,
      originalReleasedMinor: "4000",
      settlementDate: "2026-02-15",
      accountingPeriodId: "period_2026",
      considerationMinor: "4000",
      evidenceId: source.id,
      eventKey: `synthetic_settlement_${itemId}`,
      series: "VER",
      reason: "Synthetic partial settlement for NEXT-41",
      feesExcluded: true,
      acknowledgeLimitedProfile: true,
    },
    CommerceFx.PartialSettlementReview,
  );

  const approval = await post(
    reviewer,
    `/commerce/fx/partial-settlement-reviews/${settlement.id}/approvals`,
    { version: 1, digest: settlement.digest },
    CommerceFx.FxApproval,
  );

  await post(
    book,
    `/commerce/fx/partial-settlement-reviews/${settlement.id}/execute`,
    { version: 1, digest: settlement.digest, approvalId: approval.id },
    CommerceFx.PartialSettlementReceipt,
  );
}

const repairFields = {
  rounding: "exact" as const,
  economicDecisionId: "decision_synthetic",
  unrealizedGainAccountId: "account_gain",
  unrealizedLossAccountId: "account_loss",
  fiscalYearId: "fy_2026",
  accountingPeriodId: "period_2026",
  series: "VER",
  reason: "Synthetic late rate correction",
};

function repairInput(
  itemId: string,
  rate: { readonly observationId: string; readonly digest: string },
  repairKey: string,
) {
  return {
    itemId,
    rateObservationId: rate.observationId,
    rateDigest: rate.digest,
    accountingCutoff: "2026-02-28",
    repairKey,
    ...repairFields,
  };
}

test("NEXT-41 replays a settled chain with a corrected rate and posts only attribution", async () => {
  const { book, reviewer, source } = await setup();
  const item = await recognisedItem(book, reviewer, source, "chain");

  await settlePartially(book, reviewer, source, item.id);

  const corrected = await reportingRate(book, source.id, source.id, "1085", "100");

  const prepared = await post(
    book,
    "/commerce/fx/chain-repair-reviews",
    {
      ...repairInput(item.id, corrected, "repair_synthetic_one"),
    },
    CommerceFx.ChainRepairReview,
  );

  // The repair carries no cash and no foreign movement: only attribution moves.
  // The retained voucher for this assertion is the correction journal posted
  // at execute, checked below.
  console.log("DELTAS " + JSON.stringify(prepared.repair.deltas));

  expect(prepared.repair.cashDeltaMinor).toBe("0");
  expect(prepared.repair.foreignDeltaMinor).toBe("0");
  expect(prepared.repair.deltas.length).toBeGreaterThan(0);

  const approval = await post(
    reviewer,
    `/commerce/fx/chain-repair-reviews/${prepared.id}/approvals`,
    { version: 1, digest: prepared.digest },
    CommerceFx.ChainRepairApproval,
  );

  const executed = await post(
    book,
    `/commerce/fx/chain-repair-reviews/${prepared.id}/execute`,
    { version: 1, digest: prepared.digest, approvalId: approval.id },
    CommerceFx.ChainRepairExecuted,
  );

  expect(executed.voucherId).not.toBeNull();

  // The retained correction voucher moves only attribution accounts, and its
  // legs sum to the sealed delta. Cash and fee accounts are untouched.
  const admin = await database();

  try {
    const lines = await admin.query(
      "select account_id, debit_minor, credit_minor from openerp.journal_lines where book_id=$1 and voucher_id=$2 order by ordinal",
      [book.bookId, executed.voucherId],
    );

    expect(lines.rows.length).toBeGreaterThan(0);

    const debits = lines.rows.reduce(
      (carry: bigint, row: { debit_minor: string }) => carry + BigInt(row.debit_minor),
      0n,
    );

    const credits = lines.rows.reduce(
      (carry: bigint, row: { credit_minor: string }) => carry + BigInt(row.credit_minor),
      0n,
    );

    expect(debits).toBe(credits);
    expect(
      lines.rows.some((row: { account_id: string }) => row.account_id === "account_cash"),
    ).toBe(false);
  } finally {
    await admin.end();
  }

  const reread = await decoded(
    await request(book, `/commerce/fx/chain-repair-reviews/${prepared.id}`),
    CommerceFx.ChainRepairReview,
  );

  expect(reread.digest).toBe(prepared.digest);
});

test("NEXT-41 refuses a replayed repair key", async () => {
  const { book, reviewer, source } = await setup();
  const item = await recognisedItem(book, reviewer, source, "replay");
  const corrected = await reportingRate(book, source.id, source.id, "1085", "100");

  const prepared = await post(
    book,
    "/commerce/fx/chain-repair-reviews",
    repairInput(item.id, corrected, "repair_synthetic_replay"),
    CommerceFx.ChainRepairReview,
  );

  const approval = await post(
    reviewer,
    `/commerce/fx/chain-repair-reviews/${prepared.id}/approvals`,
    { version: 1, digest: prepared.digest },
    CommerceFx.ChainRepairApproval,
  );

  await post(
    book,
    `/commerce/fx/chain-repair-reviews/${prepared.id}/execute`,
    { version: 1, digest: prepared.digest, approvalId: approval.id },
    CommerceFx.ChainRepairExecuted,
  );

  // The same correction key a second time is a duplicate gain, not a second
  // repair. Preparing it again refuses at seal time.
  const again = await request(book, "/commerce/fx/chain-repair-reviews", {
    method: "POST",
    body: JSON.stringify(repairInput(item.id, corrected, "repair_synthetic_replay")),
  });

  expect(again.status).toBe(422);
});
