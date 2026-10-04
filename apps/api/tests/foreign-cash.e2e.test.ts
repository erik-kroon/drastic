import * as Bank from "@open-erp/contracts/reconciliation";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Fx from "@open-erp/contracts/commerce-fx";
import * as Rates from "@open-erp/contracts/exchange-rates";
import * as Cash from "@open-erp/contracts/foreign-cash";
import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import {
  environment,
  database,
  decoded,
  evidence,
  execute,
  fixture,
  post,
  journal,
  request,
  saveEvidence,
} from "./support/fixtures";

async function setup() {
  const book = await fixture([
    { id: "account_gain", code: "3960", name: "FX gain" },
    { id: "account_loss", code: "7960", name: "FX loss" },
    { id: "account_second_bank", code: "1940", name: "Second EUR cash" },
    { id: "account_book_bank", code: "1950", name: "SEK cash" },
    { id: "account_fee", code: "6570", name: "Exchange fee" },
    { id: "account_expense", code: "6990", name: "Supplier expense" },
    { id: "account_revenue", code: "3010", name: "Customer revenue" },
  ]);

  const second = await fixture();
  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.memberships(book_id,actor_id,role) VALUES ($1,$2,'operator')",
      [book.bookId, second.actorId],
    );
    await admin.query(
      "INSERT INTO openerp.bank_sources(book_id,account_id,source_bank_account_id) VALUES ($1,'account_bank','synthetic_eur'),($1,'account_second_bank','synthetic_eur_second'),($1,'account_book_bank','synthetic_sek')",
      [book.bookId],
    );
  } finally {
    await admin.end();
  }

  const reviewer = { ...book, actorId: second.actorId, token: second.token };
  const openingEvidence = await evidence(book);

  const opening = await post(
    book,
    "/change-sets",
    { ...journal(openingEvidence.id, "110000"), postingDate: "2026-01-01" },
    Accounting.ChangeSet,
  );

  await execute(book, opening);
  const source = await evidence(book);

  return { book, reviewer, source };
}

async function commitReview(
  book: Awaited<ReturnType<typeof fixture>>,
  reviewer: Awaited<ReturnType<typeof fixture>>,
  input: typeof Cash.Prepare.Type,
) {
  const review = await post(book, "/banking/foreign-cash/reviews", input, Cash.Review);

  const approval = await post(
    reviewer,
    `/banking/foreign-cash/reviews/${review.id}/approvals`,
    { version: 1, digest: review.digest },
    Cash.Approval,
  );

  const result = await post(
    book,
    `/banking/foreign-cash/reviews/${review.id}/execute`,
    { version: 1, digest: review.digest, approvalId: approval.id },
    Cash.Execution,
  );

  return { review, approval, result };
}

test("foreign cash adopts stored opening basis and rejects client carrying", async () => {
  const { book, reviewer, source } = await setup();
  await commitReview(book, reviewer, {
    kind: "open",
    accountId: "account_bank",
    nativeCurrency: "EUR",
    nativeScale: 2,
    openingNativeMinor: "10000",
    date: "2026-01-01",
    accountingPeriodId: "period_2026",
    series: "VER",
    evidenceId: source.id,
    sourceIdentity: "synthetic_opening",
    reason: "Reviewed synthetic EUR opening",
    acknowledgeLimitedProfile: true,
  });

  const holding = await decoded(
    await request(book, "/banking/foreign-cash/accounts/account_bank"),
    Cash.Holding,
  );

  expect(holding.nativeMinor).toBe("10000");
  expect(holding.carryingMinor).toBe("110000");

  const quote = await rate(book, source.id, "23", "2", "2026-01-15");

  const malformed = await request(book, "/banking/foreign-cash/reviews", {
    method: "POST",
    body: JSON.stringify({
      kind: "valuation",
      accountId: "account_bank",
      rateObservationId: quote.observationId,
      rateDigest: quote.digest,
      gainAccountId: "account_gain",
      lossAccountId: "account_loss",
      carryingMinor: "1",
      date: "2026-01-15",
      accountingPeriodId: "period_2026",
      series: "VER",
      evidenceId: source.id,
      sourceIdentity: "synthetic_transfer",
      reason: "No client carrying",
      acknowledgeLimitedProfile: true,
    }),
  });

  expect(malformed.status).toBe(400);

  const lawful = await post(
    book,
    "/banking/foreign-cash/reviews",
    {
      kind: "valuation",
      accountId: "account_bank",
      date: "2026-01-15",
      accountingPeriodId: "period_2026",
      series: "VER",
      evidenceId: source.id,
      sourceIdentity: "synthetic_transfer",
      reason: "No client carrying",
      acknowledgeLimitedProfile: true,
      rateObservationId: quote.observationId,
      rateDigest: quote.digest,
      gainAccountId: "account_gain",
      lossAccountId: "account_loss",
    },
    Cash.Review,
  );

  expect(lawful.effects).toEqual([
    { accountId: "account_bank", nativeDeltaMinor: "0", carryingDeltaMinor: "5000" },
  ]);
  await saveEvidence("foreign-cash-stored-opening", book);
});

async function nativeStatement(
  book: Awaited<ReturnType<typeof fixture>>,
  amountMinor: string,
  date = "2026-01-15",
  closingMinor = (10000n + BigInt(amountMinor)).toString(),
  startsOn = "2026-01-01",
  openingMinor = "10000",
) {
  const source = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: crypto.randomUUID(),
    sourceBankAccountId: "synthetic_eur",
    accountId: "account_bank",
    currency: "EUR",
    startsOn,
    endsOn: date,
    openingMinor,
    closingMinor,
    completeness: { declaredComplete: true, basis: "Synthetic complete native holding" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date,
        description: "Synthetic native cash movement",
        amountMinor,
      },
    ],
  };

  const original = await post(
    book,
    "/evidence",
    {
      title: "Synthetic EUR statement",
      mediaType: "application/json",
      content: JSON.stringify(source),
      origin: "Synthetic foreign cash E2E",
    },
    Accounting.Evidence,
  );

  const imported = await post(
    book,
    "/bank-statements",
    { ...source, evidenceId: original.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );

  return { statementId: imported.statement.id, rowOrdinal: 1 };
}

async function exchangeSources(book: Awaited<ReturnType<typeof fixture>>, extraRow = false) {
  const source = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: crypto.randomUUID(),
    sourceBankAccountId: "synthetic_sek",
    accountId: "account_book_bank",
    currency: "SEK",
    startsOn: "2026-01-01",
    endsOn: "2026-01-15",
    openingMinor: "0",
    closingMinor: extraRow ? "89000" : "44500",
    completeness: { declaredComplete: true, basis: "Synthetic exchange receiving row" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date: "2026-01-15",
        description: "Synthetic SEK exchange receipt",
        amountMinor: "44500",
      },
    ],
  };

  if (extraRow)
    source.rows.push({
      rowOrdinal: 2,
      providerId: null,
      date: "2026-01-15",
      description: "Separate synthetic SEK receipt",
      amountMinor: "44500",
    });

  const original = await post(
    book,
    "/evidence",
    {
      title: "Synthetic SEK statement",
      mediaType: "application/json",
      content: JSON.stringify(source),
      origin: "Synthetic exchange E2E",
    },
    Accounting.Evidence,
  );

  const imported = await post(
    book,
    "/bank-statements",
    { ...source, evidenceId: original.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );

  const fee = await post(
    book,
    "/evidence",
    {
      title: "Synthetic exchange fee",
      mediaType: "application/json",
      content: JSON.stringify({
        kind: "synthetic_foreign_cash_fee_v1",
        currency: "SEK",
        feeMinor: "500",
      }),
      origin: "Synthetic exchange E2E",
    },
    Accounting.Evidence,
  );

  return {
    bookObservation: { statementId: imported.statement.id, rowOrdinal: 1 },
    feeEvidenceId: fee.id,
    alternateObservation: { statementId: imported.statement.id, rowOrdinal: 2 },
  };
}

async function transferStatement(book: Awaited<ReturnType<typeof fixture>>, receiver: boolean) {
  const source = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: crypto.randomUUID(),
    sourceBankAccountId: receiver ? "synthetic_eur_second" : "synthetic_eur",
    accountId: receiver ? "account_second_bank" : "account_bank",
    currency: "EUR",
    startsOn: "2026-02-01",
    endsOn: "2026-02-02",
    openingMinor: receiver ? "0" : "10000",
    closingMinor: receiver ? "10000" : "0",
    completeness: { declaredComplete: true, basis: "Synthetic paired transfer rows" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date: "2026-02-01",
        description: "First paired transfer",
        amountMinor: receiver ? "1000" : "-1000",
      },
      {
        rowOrdinal: 2,
        providerId: null,
        date: "2026-02-02",
        description: "Final paired transfer",
        amountMinor: receiver ? "9000" : "-9000",
      },
    ],
  };

  const original = await post(
    book,
    "/evidence",
    {
      title: "Synthetic paired EUR statement",
      mediaType: "application/json",
      content: JSON.stringify(source),
      origin: "Synthetic transfer E2E",
    },
    Accounting.Evidence,
  );

  const imported = await post(
    book,
    "/bank-statements",
    {
      ...source,
      evidenceId: original.id,
      existingMatches: [],
    },
    Bank.StatementImportReceipt,
  );

  return imported.statement.id;
}

async function rate(
  book: Awaited<ReturnType<typeof fixture>>,
  evidenceId: string,
  numerator: string,
  denominator: string,
  effectiveOn = "2026-01-01",
) {
  return post(
    book,
    "/exchange-rates",
    {
      sourceKey: `synthetic_${crypto.randomUUID()}`,
      terms: {
        fromCurrency: "EUR",
        toCurrency: "SEK",
        effectiveOn,
        retrievedOn: effectiveOn,
        rateNumerator: numerator,
        rateDenominator: denominator,
        evidenceId,
        sourceLocator: "synthetic",
        reviewEvidenceId: evidenceId,
        rationale: "Synthetic qualified rate",
      },
    },
    Rates.ExchangeRateRevision,
  );
}

test("foreign payable settles against independent cash capacity and valuation posts only the delta", async () => {
  const { book, reviewer, source } = await setup();

  const shared = {
    accountId: "account_bank",
    date: "2026-01-01",
    accountingPeriodId: "period_2026",
    series: "A",
    evidenceId: source.id,
    sourceIdentity: "synthetic_opening",
    reason: "Synthetic foreign cash",
    acknowledgeLimitedProfile: true as const,
  };

  await commitReview(book, reviewer, {
    ...shared,
    kind: "open",
    nativeCurrency: "EUR",
    nativeScale: 2,
    openingNativeMinor: "10000",
  });
  const quote = await rate(book, source.id, "45", "4");

  const supplier = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: `supplier_${crypto.randomUUID()}`,
      role: "supplier",
      displayName: "Synthetic supplier",
      evidenceId: source.id,
      reason: "Synthetic payable",
    },
    Commerce.CounterpartyRevision,
  );

  const recognition = await post(
    book,
    "/commerce/fx/recognition-reviews",
    {
      profile: "synthetic_supplier_foreign_payable_v1",
      sourceKey: `payable_${crypto.randomUUID()}`,
      sourceRevision: "1",
      counterpartyId: supplier.id,
      counterpartyRevision: supplier.revision,
      documentNumber: "SYN-EUR-1",
      recognitionDate: "2026-01-01",
      originalCurrency: "EUR",
      originalScale: 2,
      originalMinor: "4000",
      rateObservationId: quote.observationId,
      rateDigest: quote.digest,
      accountingPeriodId: "period_2026",
      series: "A",
      controlAccountId: "account_clearing",
      cashAccountId: "account_bank",
      realizedGainAccountId: "account_gain",
      realizedLossAccountId: "account_loss",
      accountRoleEvidence: { evidenceId: source.id, sha256: source.sha256 },
      evidenceId: source.id,
      eventKey: "synthetic_payable",
      reason: "Synthetic EUR payable",
      expenseAccountId: "account_expense",
      syntheticNoTaxConfirmed: true,
      acknowledgeLimitedProfile: true,
    },
    Fx.RecognitionReview,
  );

  const recognitionApproval = await post(
    reviewer,
    `/commerce/fx/recognition-reviews/${recognition.id}/approvals`,
    { version: 1, digest: recognition.digest },
    Fx.FxApproval,
  );

  const item = await post(
    book,
    `/commerce/fx/recognition-reviews/${recognition.id}/execute`,
    { version: 1, digest: recognition.digest, approvalId: recognitionApproval.id },
    Fx.MonetaryItem,
  );

  const nativeObservation = await nativeStatement(book, "-4000");

  const settlement = await commitReview(book, reviewer, {
    ...shared,
    kind: "payable",
    nativeObservation,
    date: "2026-01-15",
    sourceIdentity: "synthetic_payable_cash",
    itemId: item.id,
    nativeMinor: "4000",
    gainAccountId: "account_gain",
    lossAccountId: "account_loss",
  });

  expect(
    settlement.review.journal.map((line) => [line.accountId, line.debitMinor, line.creditMinor]),
  ).toEqual([
    ["account_clearing", "45000", "0"],
    ["account_bank", "0", "44000"],
    ["account_gain", "0", "1000"],
  ]);

  const holding = await decoded(
    await request(book, "/banking/foreign-cash/accounts/account_bank"),
    Cash.Holding,
  );

  expect([holding.nativeMinor, holding.carryingMinor]).toEqual(["6000", "66000"]);

  const settled = await decoded(
    await request(book, `/commerce/fx/items/${item.id}`),
    Fx.MonetaryItem,
  );

  expect([settled.remainingOriginalMinor, settled.remainingCarryingMinor]).toEqual(["0", "0"]);

  const reconciliation = await decoded(
    await request(
      book,
      `/banking/foreign-cash/accounts/account_bank/reconciliation/${nativeObservation.statementId}`,
    ),
    Cash.Reconciliation,
  );

  expect([
    reconciliation.nativeDifferenceMinor,
    reconciliation.bookDifferenceMinor,
    reconciliation.nativeReconciled,
    reconciliation.bookReconciled,
  ]).toEqual(["0", "0", true, true]);

  const repeatedSource = await request(book, "/banking/foreign-cash/reviews", {
    method: "POST",
    body: JSON.stringify({
      ...shared,
      kind: "payable",
      nativeObservation,
      date: "2026-01-15",
      sourceIdentity: "different_label_same_native_row",
      itemId: item.id,
      nativeMinor: "4000",
      gainAccountId: "account_gain",
      lossAccountId: "account_loss",
    }),
  });

  expect(repeatedSource.status).toBe(409);

  const missingUnitStatement = await nativeStatement(
    book,
    "1",
    "2026-01-16",
    "6001",
    "2026-01-16",
    "6000",
  );

  const missingUnit = await decoded(
    await request(
      book,
      `/banking/foreign-cash/accounts/account_bank/reconciliation/${missingUnitStatement.statementId}`,
    ),
    Cash.Reconciliation,
  );

  expect([
    missingUnit.nativeDifferenceMinor,
    missingUnit.bookDifferenceMinor,
    missingUnit.nativeReconciled,
    missingUnit.bookReconciled,
  ]).toEqual(["1", "0", false, true]);
  const reportRate = await rate(book, source.id, "23", "2", "2026-01-31");

  const valuation = await commitReview(book, reviewer, {
    ...shared,
    kind: "valuation",
    date: "2026-01-31",
    sourceIdentity: "synthetic_valuation",
    rateObservationId: reportRate.observationId,
    rateDigest: reportRate.digest,
    gainAccountId: "account_gain",
    lossAccountId: "account_loss",
  });

  expect(
    valuation.review.journal.map((line) => [line.accountId, line.debitMinor, line.creditMinor]),
  ).toEqual([
    ["account_bank", "3000", "0"],
    ["account_gain", "0", "3000"],
  ]);

  const valued = await decoded(
    await request(book, "/banking/foreign-cash/accounts/account_bank"),
    Cash.Holding,
  );

  expect([valued.nativeMinor, valued.carryingMinor]).toEqual(["6000", "69000"]);
  const admin = await database();

  try {
    const rows = await admin.query(
      "select sum(debit_minor-credit_minor)::text as balance from openerp.journal_lines where book_id=$1 and account_id='account_bank'",
      [book.bookId],
    );

    expect(rows.rows[0]?.balance).toBe("69000");
  } finally {
    await admin.end();
  }

  await saveEvidence("foreign-cash-payable-and-valuation", book);
});

test("customer receipt releases retained AR and adds native cash at the retained rate", async () => {
  const { book, reviewer, source } = await setup();

  const shared = {
    accountId: "account_bank",
    date: "2026-01-01",
    accountingPeriodId: "period_2026",
    series: "A",
    evidenceId: source.id,
    sourceIdentity: "synthetic_opening",
    reason: "Synthetic customer receipt",
    acknowledgeLimitedProfile: true as const,
  };

  await commitReview(book, reviewer, {
    ...shared,
    kind: "open",
    nativeCurrency: "EUR",
    nativeScale: 2,
    openingNativeMinor: "10000",
  });
  const quote = await rate(book, source.id, "45", "4");

  const customer = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: `customer_${crypto.randomUUID()}`,
      role: "customer",
      displayName: "Synthetic customer",
      evidenceId: source.id,
      reason: "Synthetic foreign receivable",
    },
    Commerce.CounterpartyRevision,
  );

  const recognition = await post(
    book,
    "/commerce/fx/recognition-reviews",
    {
      profile: "synthetic_customer_foreign_receivable_v1",
      sourceKey: `receivable_${crypto.randomUUID()}`,
      sourceRevision: "1",
      counterpartyId: customer.id,
      counterpartyRevision: customer.revision,
      documentNumber: "SYN-EUR-AR-1",
      recognitionDate: "2026-01-01",
      originalCurrency: "EUR",
      originalScale: 2,
      originalMinor: "4000",
      rateObservationId: quote.observationId,
      rateDigest: quote.digest,
      accountingPeriodId: "period_2026",
      series: "A",
      controlAccountId: "account_clearing",
      cashAccountId: "account_bank",
      realizedGainAccountId: "account_gain",
      realizedLossAccountId: "account_loss",
      accountRoleEvidence: { evidenceId: source.id, sha256: source.sha256 },
      evidenceId: source.id,
      eventKey: "synthetic_receivable",
      reason: "Synthetic EUR receivable",
      revenueAccountId: "account_revenue",
      syntheticNoTaxConfirmed: true,
      acknowledgeLimitedProfile: true,
    },
    Fx.RecognitionReview,
  );

  const recognitionApproval = await post(
    reviewer,
    `/commerce/fx/recognition-reviews/${recognition.id}/approvals`,
    { version: 1, digest: recognition.digest },
    Fx.FxApproval,
  );

  const item = await post(
    book,
    `/commerce/fx/recognition-reviews/${recognition.id}/execute`,
    { version: 1, digest: recognition.digest, approvalId: recognitionApproval.id },
    Fx.MonetaryItem,
  );

  const nativeObservation = await nativeStatement(book, "4000");
  const receiptRate = await rate(book, source.id, "23", "2", "2026-01-15");

  const receipt = await commitReview(book, reviewer, {
    ...shared,
    kind: "receipt",
    date: "2026-01-15",
    sourceIdentity: "synthetic_customer_receipt",
    nativeObservation,
    itemId: item.id,
    nativeMinor: "4000",
    rateObservationId: receiptRate.observationId,
    rateDigest: receiptRate.digest,
    gainAccountId: "account_gain",
    lossAccountId: "account_loss",
  });

  expect(
    receipt.review.journal.map((line) => [line.accountId, line.debitMinor, line.creditMinor]),
  ).toEqual([
    ["account_bank", "46000", "0"],
    ["account_clearing", "0", "45000"],
    ["account_gain", "0", "1000"],
  ]);

  const holding = await decoded(
    await request(book, "/banking/foreign-cash/accounts/account_bank"),
    Cash.Holding,
  );

  expect([holding.nativeMinor, holding.carryingMinor]).toEqual(["14000", "156000"]);

  const settled = await decoded(
    await request(book, `/commerce/fx/items/${item.id}`),
    Fx.MonetaryItem,
  );

  expect([settled.remainingOriginalMinor, settled.remainingCarryingMinor]).toEqual(["0", "0"]);

  const reconciliation = await decoded(
    await request(
      book,
      `/banking/foreign-cash/accounts/account_bank/reconciliation/${nativeObservation.statementId}`,
    ),
    Cash.Reconciliation,
  );

  expect([
    reconciliation.nativeDifferenceMinor,
    reconciliation.bookDifferenceMinor,
    reconciliation.sourceConsumptionComplete,
    reconciliation.nativeReconciled,
    reconciliation.bookReconciled,
  ]).toEqual(["0", "0", true, true, true]);
  await saveEvidence("foreign-cash-customer-receipt", book);
});

test("foreign cash seals current capacity and execution replay recovers one effect", async () => {
  const { book, reviewer, source } = await setup();

  const shared = {
    accountId: "account_bank",
    date: "2026-01-01",
    accountingPeriodId: "period_2026",
    series: "A",
    evidenceId: source.id,
    sourceIdentity: "synthetic_opening",
    reason: "Synthetic foreign cash",
    acknowledgeLimitedProfile: true as const,
  };

  await commitReview(book, reviewer, {
    ...shared,
    kind: "open",
    nativeCurrency: "EUR",
    nativeScale: 2,
    openingNativeMinor: "10000",
  });
  const quote = await rate(book, source.id, "23", "2", "2026-01-31");

  const input = {
    ...shared,
    kind: "valuation" as const,
    date: "2026-01-31",
    sourceIdentity: "synthetic_valuation_one",
    rateObservationId: quote.observationId,
    rateDigest: quote.digest,
    gainAccountId: "account_gain",
    lossAccountId: "account_loss",
  };

  const first = await post(book, "/banking/foreign-cash/reviews", input, Cash.Review);

  const second = await post(
    book,
    "/banking/foreign-cash/reviews",
    { ...input, sourceIdentity: "synthetic_valuation_two" },
    Cash.Review,
  );

  const selfApproval = await request(book, `/banking/foreign-cash/reviews/${first.id}/approvals`, {
    method: "POST",
    body: JSON.stringify({ version: 1, digest: first.digest }),
  });

  expect(selfApproval.status).toBe(403);

  const firstApproval = await post(
    reviewer,
    `/banking/foreign-cash/reviews/${first.id}/approvals`,
    { version: 1, digest: first.digest },
    Cash.Approval,
  );

  const secondApproval = await post(
    reviewer,
    `/banking/foreign-cash/reviews/${second.id}/approvals`,
    { version: 1, digest: second.digest },
    Cash.Approval,
  );

  const executionKey = crypto.randomUUID();
  const executionInput = { version: 1, digest: first.digest, approvalId: firstApproval.id };

  const executeRequest = {
    method: "POST",
    headers: { "idempotency-key": executionKey },
    body: JSON.stringify(executionInput),
  };

  const committed = await decoded(
    await request(book, `/banking/foreign-cash/reviews/${first.id}/execute`, executeRequest),
    Cash.Execution,
  );

  const recovered = await decoded(
    await request(book, `/banking/foreign-cash/reviews/${first.id}/execute`, executeRequest),
    Cash.Execution,
  );

  expect(recovered).toEqual(committed);
  expect(committed.effects).toEqual([
    { accountId: "account_bank", nativeDeltaMinor: "0", carryingDeltaMinor: "5000" },
  ]);

  const stale = await request(book, `/banking/foreign-cash/reviews/${second.id}/execute`, {
    method: "POST",
    body: JSON.stringify({ version: 1, digest: second.digest, approvalId: secondApproval.id }),
  });

  expect(stale.status).toBe(409);

  const generic = await request(book, "/change-sets", {
    method: "POST",
    body: JSON.stringify(journal(source.id, "1000")),
  });

  const genericPlan = await decoded(generic, Accounting.ChangeSet);

  const approvalRefusal = await request(book, `/change-sets/${genericPlan.id}/approvals`, {
    method: "POST",
    body: JSON.stringify({ planDigest: genericPlan.planDigest, version: genericPlan.version }),
  });

  expect(approvalRefusal.status).toBe(403);
  expect(await approvalRefusal.json()).toMatchObject({ code: "ApprovalRequired" });

  const protectedHolding = await decoded(
    await request(book, "/banking/foreign-cash/accounts/account_bank"),
    Cash.Holding,
  );

  expect([protectedHolding.nativeMinor, protectedHolding.carryingMinor]).toEqual([
    "10000",
    "115000",
  ]);
  const admin = await database();

  try {
    const rows = await admin.query(
      "select count(*)::int as effects from openerp.bank_foreign_cash_effects where book_id=$1 and review_id=$2",
      [book.bookId, first.id],
    );

    expect(rows.rows[0]?.effects).toBe(1);
  } finally {
    await admin.end();
  }

  await saveEvidence("foreign-cash-capacity-replay", book);
});

test("same-currency transfer conserves both capacities and final consume empties carrying", async () => {
  const { book, reviewer, source } = await setup();

  const shared = {
    date: "2026-01-01",
    accountingPeriodId: "period_2026",
    series: "A",
    evidenceId: source.id,
    reason: "Synthetic cash transfer",
    acknowledgeLimitedProfile: true as const,
  };

  await commitReview(book, reviewer, {
    ...shared,
    kind: "open",
    accountId: "account_bank",
    nativeCurrency: "EUR",
    nativeScale: 2,
    openingNativeMinor: "10000",
    sourceIdentity: "synthetic_opening_sender",
  });
  await commitReview(book, reviewer, {
    ...shared,
    kind: "open",
    accountId: "account_second_bank",
    nativeCurrency: "EUR",
    nativeScale: 2,
    openingNativeMinor: "0",
    sourceIdentity: "synthetic_opening_receiver",
  });
  const quote = await rate(book, source.id, "23", "2", "2026-01-31");
  await commitReview(book, reviewer, {
    ...shared,
    kind: "valuation",
    accountId: "account_bank",
    date: "2026-01-31",
    sourceIdentity: "synthetic_value_sender",
    rateObservationId: quote.observationId,
    rateDigest: quote.digest,
    gainAccountId: "account_gain",
    lossAccountId: "account_loss",
  });

  const senderStatementId = await transferStatement(book, false);
  const receiverStatementId = await transferStatement(book, true);

  const wrongReceiver = await request(book, "/banking/foreign-cash/reviews", {
    method: "POST",
    body: JSON.stringify({
      ...shared,
      kind: "transfer",
      accountId: "account_bank",
      receiverAccountId: "account_second_bank",
      date: "2026-02-01",
      sourceIdentity: "synthetic_wrong_receiver",
      nativeMinor: "1000",
      nativeObservation: { statementId: senderStatementId, rowOrdinal: 1 },
      receiverObservation: { statementId: senderStatementId, rowOrdinal: 1 },
    }),
  });

  expect(wrongReceiver.status).toBe(422);

  const transfer = await commitReview(book, reviewer, {
    ...shared,
    kind: "transfer",
    nativeObservation: { statementId: senderStatementId, rowOrdinal: 1 },
    receiverObservation: { statementId: receiverStatementId, rowOrdinal: 1 },
    accountId: "account_bank",
    receiverAccountId: "account_second_bank",
    date: "2026-02-01",
    sourceIdentity: "synthetic_transfer_one",
    nativeMinor: "1000",
  });

  expect(transfer.review.effects).toEqual([
    { accountId: "account_bank", nativeDeltaMinor: "-1000", carryingDeltaMinor: "-11500" },
    { accountId: "account_second_bank", nativeDeltaMinor: "1000", carryingDeltaMinor: "11500" },
  ]);

  const reusedPair = await request(book, "/banking/foreign-cash/reviews", {
    method: "POST",
    body: JSON.stringify({ ...transfer.review.input, sourceIdentity: "new_label_same_pair" }),
  });

  expect(reusedPair.status).toBe(409);

  const overdraw = await request(book, "/banking/foreign-cash/reviews", {
    method: "POST",
    body: JSON.stringify({
      ...shared,
      kind: "transfer",
      nativeObservation: { statementId: senderStatementId, rowOrdinal: 2 },
      receiverObservation: { statementId: receiverStatementId, rowOrdinal: 2 },
      accountId: "account_bank",
      receiverAccountId: "account_second_bank",
      date: "2026-02-02",
      sourceIdentity: "synthetic_overdraw",
      nativeMinor: "9001",
    }),
  });

  expect(overdraw.status).toBe(422);
  await commitReview(book, reviewer, {
    ...shared,
    kind: "transfer",
    nativeObservation: { statementId: senderStatementId, rowOrdinal: 2 },
    receiverObservation: { statementId: receiverStatementId, rowOrdinal: 2 },
    accountId: "account_bank",
    receiverAccountId: "account_second_bank",
    date: "2026-02-02",
    sourceIdentity: "synthetic_transfer_all",
    nativeMinor: "9000",
  });

  const sender = await decoded(
    await request(book, "/banking/foreign-cash/accounts/account_bank"),
    Cash.Holding,
  );

  const receiver = await decoded(
    await request(book, "/banking/foreign-cash/accounts/account_second_bank"),
    Cash.Holding,
  );

  expect([
    sender.nativeMinor,
    sender.carryingMinor,
    receiver.nativeMinor,
    receiver.carryingMinor,
  ]).toEqual(["0", "0", "10000", "115000"]);

  for (const [accountId, statementId] of [
    ["account_bank", senderStatementId],
    ["account_second_bank", receiverStatementId],
  ]) {
    const reconciliation = await decoded(
      await request(
        book,
        `/banking/foreign-cash/accounts/${accountId}/reconciliation/${statementId}`,
      ),
      Cash.Reconciliation,
    );

    expect([
      reconciliation.nativeDifferenceMinor,
      reconciliation.bookDifferenceMinor,
      reconciliation.sourceConsumptionComplete,
      reconciliation.nativeReconciled,
      reconciliation.bookReconciled,
    ]).toEqual(["0", "0", true, true, true]);
  }

  await saveEvidence("foreign-cash-transfer-conservation", book);
});

test("foreign-to-book exchange rolls back journal and holding together and retries the original command", async () => {
  const { book, reviewer, source } = await setup();

  const shared = {
    accountId: "account_bank",
    date: "2026-01-01",
    accountingPeriodId: "period_2026",
    series: "A",
    evidenceId: source.id,
    sourceIdentity: "synthetic_opening",
    reason: "Synthetic exchange",
    acknowledgeLimitedProfile: true as const,
  };

  await commitReview(book, reviewer, {
    ...shared,
    kind: "open",
    nativeCurrency: "EUR",
    nativeScale: 2,
    openingNativeMinor: "10000",
  });
  const nativeObservation = await nativeStatement(book, "-4000");

  const { bookObservation, feeEvidenceId, alternateObservation } = await exchangeSources(
    book,
    true,
  );

  const review = await post(
    book,
    "/banking/foreign-cash/reviews",
    {
      ...shared,
      kind: "exchange",
      nativeObservation,
      date: "2026-01-15",
      receiverAccountId: "account_book_bank",
      nativeMinor: "4000",
      bookObservation,
      feeEvidenceId,
      feeAccountId: "account_fee",
      gainAccountId: "account_gain",
      lossAccountId: "account_loss",
      sourceIdentity: "synthetic_exchange",
    },
    Cash.Review,
  );

  expect(review.journal.map((line) => [line.accountId, line.debitMinor, line.creditMinor])).toEqual(
    [
      ["account_book_bank", "44500", "0"],
      ["account_fee", "500", "0"],
      ["account_bank", "0", "44000"],
      ["account_gain", "0", "1000"],
    ],
  );

  const approval = await post(
    reviewer,
    `/banking/foreign-cash/reviews/${review.id}/approvals`,
    { version: 1, digest: review.digest },
    Cash.Approval,
  );

  const executionRequest = {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ version: 1, digest: review.digest, approvalId: approval.id }),
  };

  const admin = await database();
  const constraint = `fail_cash_${crypto.randomUUID().replaceAll("-", "")}`;

  try {
    await admin.query(
      `ALTER TABLE openerp.bank_foreign_cash_effects ADD CONSTRAINT ${constraint} CHECK (review_id <> '${review.id}')`,
    );

    const failed = await request(
      book,
      `/banking/foreign-cash/reviews/${review.id}/execute`,
      executionRequest,
    );

    expect(failed.status).toBe(500);

    const holding = await decoded(
      await request(book, "/banking/foreign-cash/accounts/account_bank"),
      Cash.Holding,
    );

    expect([holding.nativeMinor, holding.carryingMinor]).toEqual(["10000", "110000"]);

    const partial = await admin.query(
      "select count(*)::int as vouchers from openerp.vouchers where book_id=$1 and occurrence_key=$2",
      [book.bookId, review.id],
    );

    expect(partial.rows[0]?.vouchers).toBe(0);
  } finally {
    await admin.query(
      `ALTER TABLE openerp.bank_foreign_cash_effects DROP CONSTRAINT IF EXISTS ${constraint}`,
    );
    await admin.end();
  }

  const retried = await decoded(
    await request(book, `/banking/foreign-cash/reviews/${review.id}/execute`, executionRequest),
    Cash.Execution,
  );

  expect(retried.effects).toEqual([
    { accountId: "account_bank", nativeDeltaMinor: "-4000", carryingDeltaMinor: "-44000" },
  ]);

  const holding = await decoded(
    await request(book, "/banking/foreign-cash/accounts/account_bank"),
    Cash.Holding,
  );

  expect([holding.nativeMinor, holding.carryingMinor]).toEqual(["6000", "66000"]);
  const observed = await database();
  let receivingLineId = "";

  try {
    const matches = await observed.query(
      "select m.line_id,o.amount_minor::text as amount from openerp.bank_matches m join openerp.bank_observations o on (o.book_id,o.statement_id,o.row_ordinal)=(m.book_id,m.statement_id,m.row_ordinal) where m.book_id=$1 and m.voucher_id=$2 and m.statement_id=$3",
      [book.bookId, retried.voucherId, bookObservation.statementId],
    );

    expect(matches.rows.map((row) => row.amount)).toEqual(["44500"]);
    receivingLineId = matches.rows[0]?.line_id;
  } finally {
    await observed.end();
  }

  const duplicateLine = await request(book, "/bank-matches", {
    method: "POST",
    body: JSON.stringify({
      ...alternateObservation,
      voucherId: retried.voucherId,
      lineId: receivingLineId,
    }),
  });

  expect(duplicateLine.status).toBe(422);
  expect(await duplicateLine.json()).toMatchObject({ code: "InvalidJournal" });
  const retained = await database();

  try {
    const matching = await retained.query(
      "select count(*)::int as matches from openerp.bank_matches where book_id=$1 and voucher_id=$2 and line_id=$3",
      [book.bookId, retried.voucherId, receivingLineId],
    );

    expect(matching.rows[0]?.matches).toBe(1);
  } finally {
    await retained.end();
  }

  await saveEvidence("foreign-cash-exchange-rollback-retry", book);
});

test("native source account date and exact quantity are authoritative", async () => {
  const { book, reviewer, source } = await setup();

  const shared = {
    accountId: "account_bank",
    date: "2026-01-01",
    accountingPeriodId: "period_2026",
    series: "A",
    evidenceId: source.id,
    sourceIdentity: "synthetic_opening",
    reason: "Synthetic native admission",
    acknowledgeLimitedProfile: true as const,
  };

  await commitReview(book, reviewer, {
    ...shared,
    kind: "open",
    nativeCurrency: "EUR",
    nativeScale: 2,
    openingNativeMinor: "10000",
  });
  const nativeObservation = await nativeStatement(book, "-4000");
  const { bookObservation, feeEvidenceId } = await exchangeSources(book);

  const exchange = {
    ...shared,
    kind: "exchange",
    nativeObservation,
    date: "2026-01-15",
    sourceIdentity: "synthetic_exchange",
    receiverAccountId: "account_book_bank",
    nativeMinor: "4000",
    bookObservation,
    feeEvidenceId,
    feeAccountId: "account_fee",
    gainAccountId: "account_gain",
    lossAccountId: "account_loss",
  };

  const wrongQuantity = await request(book, "/banking/foreign-cash/reviews", {
    method: "POST",
    body: JSON.stringify({ ...exchange, nativeMinor: "3999" }),
  });

  expect(wrongQuantity.status).toBe(422);

  const wrongDate = await request(book, "/banking/foreign-cash/reviews", {
    method: "POST",
    body: JSON.stringify({ ...exchange, date: "2026-01-16" }),
  });

  expect(wrongDate.status).toBe(422);

  const impersonatedGain = await request(book, "/banking/foreign-cash/reviews", {
    method: "POST",
    body: JSON.stringify({ ...exchange, gainAccountId: "account_bank" }),
  });

  expect(impersonatedGain.status).toBe(422);
  const agent = { ...book, token: book.agentToken };

  const valid = await post(book, "/banking/foreign-cash/reviews", exchange, Cash.Review);

  const unauthorized = await request(agent, `/banking/foreign-cash/reviews/${valid.id}/approvals`, {
    method: "POST",
    body: JSON.stringify({ version: 1, digest: valid.digest }),
  });

  expect(unauthorized.status).toBe(403);
  expect(await unauthorized.json()).toMatchObject({ code: "Forbidden" });

  const unapproved = await request(agent, `/banking/foreign-cash/reviews/${valid.id}/execute`, {
    method: "POST",
    body: JSON.stringify({ version: 1, digest: valid.digest, approvalId: "cash_approval_absent" }),
  });

  expect(unapproved.status).toBe(403);
  expect(await unapproved.json()).toMatchObject({ code: "ApprovalRequired" });

  const unchanged = await decoded(
    await request(book, "/banking/foreign-cash/accounts/account_bank"),
    Cash.Holding,
  );

  expect([unchanged.nativeMinor, unchanged.carryingMinor]).toEqual(["10000", "110000"]);
  const retained = await database();

  try {
    const effects = await retained.query(
      "select (select count(*)::int from openerp.bank_foreign_cash_effects where book_id=$1 and review_id=$2) as effects,(select count(*)::int from openerp.vouchers where book_id=$1 and occurrence_key=$2) as vouchers,(select count(*)::int from openerp.bank_foreign_cash_native_consumptions where book_id=$1 and review_id=$2) as native_claims,(select count(*)::int from openerp.bank_foreign_cash_book_consumptions where book_id=$1 and review_id=$2) as book_claims",
      [book.bookId, valid.id],
    );

    expect(effects.rows).toEqual([{ effects: 0, vouchers: 0, native_claims: 0, book_claims: 0 }]);
  } finally {
    await retained.end();
  }

  expect(valid.effects).toEqual([
    { accountId: "account_bank", nativeDeltaMinor: "-4000", carryingDeltaMinor: "-44000" },
  ]);
  const unrelated = await fixture();

  const forbidden = await request(
    { ...book, token: unrelated.token },
    `/banking/foreign-cash/accounts/account_bank`,
  );

  expect(forbidden.status).toBe(403);
  await saveEvidence("foreign-cash-native-admission", book);
});

test("native reconciliation exposes unexplained cancelling movements", async () => {
  const { book, reviewer, source } = await setup();
  await commitReview(book, reviewer, {
    kind: "open",
    accountId: "account_bank",
    date: "2026-01-01",
    accountingPeriodId: "period_2026",
    series: "A",
    evidenceId: source.id,
    sourceIdentity: "synthetic_opening",
    reason: "Synthetic unmatched native movements",
    acknowledgeLimitedProfile: true,
    nativeCurrency: "EUR",
    nativeScale: 2,
    openingNativeMinor: "10000",
  });

  const statement = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: crypto.randomUUID(),
    sourceBankAccountId: "synthetic_eur",
    accountId: "account_bank",
    currency: "EUR",
    startsOn: "2026-01-01",
    endsOn: "2026-01-15",
    openingMinor: "10000",
    closingMinor: "10000",
    completeness: { declaredComplete: true, basis: "Synthetic two unexplained rows" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date: "2026-01-15",
        description: "Unexplained native debit",
        amountMinor: "-1",
      },
      {
        rowOrdinal: 2,
        providerId: null,
        date: "2026-01-15",
        description: "Unexplained native receipt",
        amountMinor: "1",
      },
    ],
  };

  const original = await post(
    book,
    "/evidence",
    {
      title: "Synthetic cancelling native rows",
      mediaType: "application/json",
      content: JSON.stringify(statement),
      origin: "Synthetic completeness E2E",
    },
    Accounting.Evidence,
  );

  const imported = await post(
    book,
    "/bank-statements",
    { ...statement, evidenceId: original.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );

  const reconciliation = await decoded(
    await request(
      book,
      `/banking/foreign-cash/accounts/account_bank/reconciliation/${imported.statement.id}`,
    ),
    Cash.Reconciliation,
  );

  expect([
    reconciliation.nativeDifferenceMinor,
    reconciliation.bookDifferenceMinor,
    reconciliation.sourceComplete,
    reconciliation.sourceConsumptionComplete,
    reconciliation.nativeReconciled,
    reconciliation.bookReconciled,
  ]).toEqual(["0", "0", true, false, false, true]);
  await saveEvidence("foreign-cash-native-source-completeness", book);
});

const CashRpc = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Finite,
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.Int,
      message: Schema.String,
      data: Schema.Struct({ code: Accounting.FailureCode }),
    }),
  ),
});

async function cashTool(
  book: Awaited<ReturnType<typeof fixture>>,
  name: string,
  arguments_: Schema.JsonObject,
) {
  const response = await fetch(`${environment().baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${book.agentToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: arguments_ },
    }),
  });

  expect(response.status).toBe(200);

  return Schema.decodeUnknownSync(CashRpc)(await response.json());
}

test("MCP rejects client carrying and executes the same operator-approved cash valuation", async () => {
  const { book, reviewer, source } = await setup();

  const shared = {
    accountId: "account_bank",
    date: "2026-01-01",
    accountingPeriodId: "period_2026",
    series: "A",
    evidenceId: source.id,
    sourceIdentity: "synthetic_opening",
    reason: "Synthetic MCP cash",
    acknowledgeLimitedProfile: true as const,
  };

  await commitReview(book, reviewer, {
    ...shared,
    kind: "open",
    nativeCurrency: "EUR",
    nativeScale: 2,
    openingNativeMinor: "10000",
  });
  const quote = await rate(book, source.id, "23", "2", "2026-01-31");
  const scope = { entityId: book.entityId, bookId: book.bookId };

  const input = {
    ...shared,
    kind: "valuation" as const,
    date: "2026-01-31",
    sourceIdentity: "synthetic_mcp_valuation",
    rateObservationId: quote.observationId,
    rateDigest: quote.digest,
    gainAccountId: "account_gain",
    lossAccountId: "account_loss",
  };

  const malformed = await cashTool(book, "banking_prepare_foreign_cash", {
    scope,
    idempotencyKey: crypto.randomUUID(),
    input: { ...input, carryingMinor: "1" },
  });

  expect(malformed.error).toEqual({
    code: -32602,
    message: "Invalid tool arguments.",
    data: { code: "InvalidRequest" },
  });

  const prepared = await cashTool(book, "banking_prepare_foreign_cash", {
    scope,
    idempotencyKey: crypto.randomUUID(),
    input,
  });

  expect(prepared.result, JSON.stringify(prepared.result)).toMatchObject({ isError: false });

  const review = Schema.decodeUnknownSync(
    Schema.Struct({
      isError: Schema.Literal(false),
      structuredContent: Schema.Struct({ result: Cash.Review }),
    }),
  )(prepared.result).structuredContent.result;

  expect(review.actorId).toBe(book.agentId);
  expect(review.effects).toEqual([
    { accountId: "account_bank", nativeDeltaMinor: "0", carryingDeltaMinor: "5000" },
  ]);

  const approval = await post(
    reviewer,
    `/banking/foreign-cash/reviews/${review.id}/approvals`,
    { version: 1, digest: review.digest },
    Cash.Approval,
  );

  const executed = await cashTool(book, "banking_execute_foreign_cash", {
    scope,
    reviewId: review.id,
    idempotencyKey: crypto.randomUUID(),
    input: { version: 1, digest: review.digest, approvalId: approval.id },
  });

  expect(executed.result, JSON.stringify(executed.result)).toMatchObject({ isError: false });

  const receipt = Schema.decodeUnknownSync(
    Schema.Struct({
      isError: Schema.Literal(false),
      structuredContent: Schema.Struct({ result: Cash.Execution }),
    }),
  )(executed.result).structuredContent.result;

  expect(receipt.effects).toEqual([
    { accountId: "account_bank", nativeDeltaMinor: "0", carryingDeltaMinor: "5000" },
  ]);

  const read = await cashTool(book, "banking_get_foreign_cash_holding", {
    scope,
    accountId: "account_bank",
  });

  const holding = Schema.decodeUnknownSync(
    Schema.Struct({
      isError: Schema.Literal(false),
      structuredContent: Schema.Struct({ result: Cash.Holding }),
    }),
  )(read.result).structuredContent.result;

  expect([holding.nativeMinor, holding.carryingMinor]).toEqual(["10000", "115000"]);
  expect(holding).toEqual(
    await decoded(await request(book, "/banking/foreign-cash/accounts/account_bank"), Cash.Holding),
  );
  const retained = await database();

  try {
    const provenance = await retained.query(
      "select a.actor_id,a.id,(a.consumed_at is not null) as consumed,(a.expires_at=$3::timestamptz) as same_expiry,c.consumed_by_id as executor from openerp.approvals a join openerp.approval_consumptions c on (c.book_id,c.approval_id)=(a.book_id,a.id) where a.book_id=$1 and a.id=$2",
      [book.bookId, approval.id, approval.expiresAt],
    );

    expect(provenance.rows).toEqual([
      {
        actor_id: reviewer.actorId,
        id: approval.id,
        consumed: true,
        same_expiry: true,
        executor: book.agentId,
      },
    ]);
  } finally {
    await retained.end();
  }

  await saveEvidence("foreign-cash-mcp-parity", book);
});
