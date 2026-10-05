import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Reversals from "@open-erp/contracts/commerce-allocation-reversals";
import { canonicalizeJson } from "@open-erp/domain/canonicalization";
import * as Result from "effect/Result";
import { createHash } from "node:crypto";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Credits from "@open-erp/contracts/customer-credit-notes";
import * as Fx from "@open-erp/contracts/commerce-fx";
import * as Rates from "@open-erp/contracts/exchange-rates";
import * as NativeCash from "@open-erp/contracts/foreign-cash";
import * as Processor from "@open-erp/contracts/processor-clearing";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import {
  createSession,
  database,
  decoded,
  environment,
  evidence,
  execute,
  fixture,
  journal,
  post,
  request,
  saveEvidence,
} from "./support/fixtures";

async function setup(
  currency = "SEK",
  opening: { readonly processorMinor?: string; readonly adoptedTransitMinor?: string } = {},
) {
  const book = await fixture([
    { id: "account_processor", code: "1580", name: "Processor control" },
    { id: "account_transit", code: "1581", name: "Payout transit" },
    { id: "account_dispute", code: "1582", name: "Dispute receivable" },
    { id: "account_fee", code: "6570", name: "Processor fees" },
    { id: "account_loss", code: "6350", name: "Reviewed dispute loss" },
    { id: "account_receivable", code: "1510", name: "Receivables" },
    { id: "account_native_receivable", code: "1511", name: "Native receivables" },
    { id: "account_liability", code: "2890", name: "Customer credit" },
    { id: "account_revenue", code: "3010", name: "Revenue" },
    { id: "account_gain", code: "3960", name: "FX gain" },
    { id: "account_fx_loss", code: "7960", name: "FX loss" },
  ]);

  const second = await fixture();
  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values ($1,$2,'operator')",
      [book.bookId, second.actorId],
    );
    await admin.query(
      "insert into openerp.bank_sources(book_id,account_id,source_bank_account_id) values ($1,'account_bank','synthetic_processor_bank')",
      [book.bookId],
    );
  } finally {
    await admin.end();
  }

  const reviewer = { ...book, actorId: second.actorId, token: (await createSession(second)).token };
  const source = await evidence(book);

  const recognition = await post(
    book,
    "/change-sets",
    {
      ...journal(source.id, "125000"),
      postingDate: "2026-01-01",
      lines: [
        {
          accountId: "account_receivable",
          debitMinor: "125000",
          creditMinor: "0",
          description: "Recognized receivable",
        },
        {
          accountId: "account_revenue",
          debitMinor: "0",
          creditMinor: "125000",
          description: "Recognized revenue",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const recognized = await execute(book, recognition);
  const db = await database();
  let lineId: string;

  try {
    const rows = await db.query<{ id: string }>(
      "select id from openerp.journal_lines where book_id=$1 and voucher_id=$2 and account_id='account_receivable'",
      [book.bookId, recognized.voucherId],
    );

    const line = rows.rows[0];

    if (!line) throw new Error("Recognition line was not retained");
    lineId = line.id;
  } finally {
    await db.end();
  }

  const party = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: `processor_customer_${book.bookId}`,
      role: "customer",
      displayName: "Synthetic processor customer",
      evidenceId: source.id,
      reason: "Processor clearing proof",
    },
    Commerce.CounterpartyRevision,
  );

  const invoice = await post(
    book,
    "/commerce/invoices",
    {
      kind: "synthetic_invoice_v1",
      direction: "customer",
      counterpartyId: party.id,
      counterpartyRevision: party.revision,
      documentNumber: "PROCESSOR-125000",
      issuedOn: "2026-01-01",
      dueOn: "2026-01-31",
      currency: "SEK",
      amountMinor: "125000",
      controlAccountId: "account_receivable",
      recognitionVoucherId: recognized.voucherId,
      recognitionLineId: lineId,
      evidenceId: source.id,
      description: "Retained processor obligation",
    },
    Commerce.Invoice,
  );

  let adoptedVoucherId: string | undefined;

  if (opening.processorMinor || opening.adoptedTransitMinor) {
    const amount = opening.processorMinor ?? opening.adoptedTransitMinor;

    if (!amount) throw new Error("An opening amount is required");

    const openingPlan = await post(
      book,
      "/change-sets",
      {
        ...journal(source.id, amount),
        postingDate: opening.processorMinor ? "2026-01-01" : "2026-01-18",
        lines: opening.processorMinor
          ? [
              {
                accountId: "account_processor",
                debitMinor: amount,
                creditMinor: "0",
                description: "Stored processor opening",
              },
              {
                accountId: "account_clearing",
                debitMinor: "0",
                creditMinor: amount,
                description: "Stored opening basis",
              },
            ]
          : [
              {
                accountId: "account_bank",
                debitMinor: amount,
                creditMinor: "0",
                description: "Existing payout bank receipt",
              },
              {
                accountId: "account_transit",
                debitMinor: "0",
                creditMinor: amount,
                description: "Existing payout transit receipt",
              },
            ],
      },
      Accounting.ChangeSet,
    );

    adoptedVoucherId = (await execute(book, openingPlan)).voucherId;
  }

  const account = await post(
    book,
    "/banking/processors/accounts",
    {
      profile: "synthetic_stripe_balance_v1",
      providerAccountId: `acct_${book.bookId}`,
      liveMode: false,
      currency,
      currencyScale: 2,
      openedOn: "2026-01-01",
      processorControlAccountId: "account_processor",
      payoutTransitAccountId: "account_transit",
      feeCostAccountId: "account_fee",
      disputeReceivableAccountId: "account_dispute",
      disputeLossAccountId: "account_loss",
      bankAccountId: "account_bank",
      gainAccountId: "account_gain",
      lossAccountId: "account_fx_loss",
      evidenceId: source.id,
      acknowledgeLimitedProfile: true,
      acknowledgeGrossFeesWithoutInputVat: true,
    },
    Processor.Account,
  );

  return { book, reviewer, source, invoice, account, party, adoptedVoucherId };
}

function charge(id = "txn_charge"): typeof Processor.ProviderRow.Type {
  return {
    id,
    sourceId: "charge_125000",
    type: "charge",
    currency: "SEK",
    currencyScale: 2,
    grossMinor: "125000",
    feeMinor: "3000",
    netMinor: "122000",
    occurredOn: "2026-01-15",
    availableOn: "2026-01-16",
    providerPayoutId: null,
    disputeId: null,
    payoutMethod: null,
    destinationBankAccountId: null,
  };
}

function payout(): typeof Processor.ProviderRow.Type {
  return {
    ...charge("txn_payout"),
    sourceId: "po_122000",
    type: "payout",
    grossMinor: "-122000",
    feeMinor: "0",
    netMinor: "-122000",
    occurredOn: "2026-01-17",
    availableOn: "2026-01-17",
    providerPayoutId: "po_122000",
    payoutMethod: "automatic",
    destinationBankAccountId: "synthetic_processor_bank",
  };
}

async function seed(
  account: typeof Processor.Account.Type,
  rows: Array<ReturnType<typeof charge>>,
  closingMinor = "0",
  options: {
    readonly openingMinor?: string;
    readonly pageSize?: number;
    readonly lostResponses?: number;
    readonly startsOn?: string;
    readonly endsOn?: string;
  } = {},
) {
  const fixtureEnvironment = environment();

  const response = await fetch(
    `${fixtureEnvironment.processorFixtureUrl}/fixtures/${account.providerAccountId}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${fixtureEnvironment.processorFixtureSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        profile: account.profile,
        accountId: account.providerAccountId,
        liveMode: account.liveMode,
        currency: account.currency,
        currencyScale: account.currencyScale,
        startsOn: "2026-01-01",
        endsOn: "2026-01-31",
        openingMinor: "0",
        closingMinor,
        complete: true,
        rows,
        ...options,
      }),
    },
  );

  expect(response.status).toBe(200);
}

async function fetchObservations(
  book: Awaited<ReturnType<typeof fixture>>,
  accountId: string,
  view: "balance" | "automatic_payout" = "balance",
) {
  return post(
    book,
    `/banking/processors/accounts/${accountId}/fetches`,
    {
      startsOn: "2026-01-01",
      endsOn: "2026-01-31",
      view,
      ...(view === "automatic_payout" ? { providerPayoutId: "po_122000" } : {}),
    },
    Processor.Fetch,
  );
}

async function commit(
  book: Awaited<ReturnType<typeof fixture>>,
  reviewer: Awaited<ReturnType<typeof fixture>>,
  input: typeof Processor.Prepare.Type,
) {
  const review = await post(book, "/banking/processors/reviews", input, Processor.Review);

  const approval = await post(
    reviewer,
    `/banking/processors/reviews/${review.id}/approvals`,
    { version: 1, digest: review.digest },
    Processor.Approval,
  );

  const execution = await post(
    book,
    `/banking/processors/reviews/${review.id}/execute`,
    { version: 1, digest: review.digest, approvalId: approval.id },
    Processor.Execution,
  );

  return { review, approval, execution };
}

function reviewBasis(accountId: string, evidenceId: string) {
  return {
    accountId,
    evidenceId,
    date: "2026-01-17",
    accountingPeriodId: "period_2026",
    series: "VER",
    reason: "Synthetic processor clearing",
    acknowledgeLimitedProfile: true as const,
  };
}

async function statement(
  book: Awaited<ReturnType<typeof fixture>>,
  evidenceId: string,
  window = { startsOn: "2026-01-01", receivedOn: "2026-01-18" },
) {
  const original = {
    kind: "synthetic_bank_statement_v1" as const,
    statementIdentifier: crypto.randomUUID(),
    sourceBankAccountId: "synthetic_processor_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: window.startsOn,
    endsOn: "2026-01-31",
    openingMinor: "0",
    closingMinor: "122000",
    completeness: { declaredComplete: true, basis: "Synthetic complete payout receipt" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: "po_122000",
        date: window.receivedOn,
        description: "Processor payout po_122000",
        amountMinor: "122000",
      },
    ],
  };

  const raw = await post(
    book,
    "/evidence",
    {
      title: "Synthetic payout statement",
      mediaType: "application/json",
      content: JSON.stringify(original),
      origin: evidenceId,
    },
    Accounting.Evidence,
  );

  return post(
    book,
    "/bank-statements",
    { ...original, evidenceId: raw.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );
}

test("processor charge125000 fee3000 payout122000 clears bank transit without another sale", async () => {
  const { book, reviewer, source, invoice, account } = await setup();
  await seed(account, [charge(), payout()]);
  const fetched = await fetchObservations(book, account.id);
  expect(fetched.observations.map((o) => o.balanceTransactionId)).toEqual([
    "txn_charge",
    "txn_payout",
  ]);
  const chargeObservation = fetched.observations[0];
  const payoutObservation = fetched.observations[1];

  if (!chargeObservation || !payoutObservation)
    throw new Error("Both provider occurrences must be retained");

  const charged = await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: chargeObservation.id,
    invoiceId: invoice.id,
  });

  expect(charged.review.journal).toEqual([
    {
      accountId: "account_processor",
      debitMinor: "122000",
      creditMinor: "0",
      description: "Processor control net",
    },
    {
      accountId: "account_fee",
      debitMinor: "3000",
      creditMinor: "0",
      description: "Qualified processor fee cost",
    },
    {
      accountId: "account_receivable",
      debitMinor: "0",
      creditMinor: "125000",
      description: "Customer AR principal allocation",
    },
  ]);

  const paid = await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: payoutObservation.id,
  });

  expect(
    paid.review.journal.map((line) => [line.accountId, line.debitMinor, line.creditMinor]),
  ).toEqual([
    ["account_transit", "122000", "0"],
    ["account_processor", "0", "122000"],
  ]);
  const imported = await statement(book, source.id);

  const received = await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    date: "2026-01-18",
    kind: "bank_receipt",
    payoutObservationId: payoutObservation.id,
    bankObservation: { statementId: imported.statement.id, rowOrdinal: 1 },
  });

  expect(
    received.review.journal.map((line) => [line.accountId, line.debitMinor, line.creditMinor]),
  ).toEqual([
    ["account_bank", "122000", "0"],
    ["account_transit", "0", "122000"],
  ]);
  const duplicate = await fetchObservations(book, account.id, "automatic_payout");
  expect(duplicate.observations.map((o) => o.id)).toEqual(fetched.observations.map((o) => o.id));

  const control = await decoded(
    await request(book, `/banking/processors/accounts/${account.id}/reconciliation/${fetched.id}`),
    Processor.Reconciliation,
  );

  expect(control.processorNativeMinor).toBe("0");
  expect(control.processorLedgerMinor).toBe("0");
  expect(control.transitNativeMinor).toBe("0");
  expect(control.transitLedgerMinor).toBe("0");
  expect(control.complete).toBe(true);
  const admin = await database();

  try {
    const totals = await admin.query<{ account_id: string; minor: string }>(
      "select account_id,sum(debit_minor-credit_minor)::text as minor from openerp.journal_lines where book_id=$1 group by account_id order by account_id",
      [book.bookId],
    );

    expect(totals.rows).toEqual([
      { account_id: "account_bank", minor: "122000" },
      { account_id: "account_fee", minor: "3000" },
      { account_id: "account_processor", minor: "0" },
      { account_id: "account_receivable", minor: "0" },
      { account_id: "account_revenue", minor: "-125000" },
      { account_id: "account_transit", minor: "0" },
    ]);

    const matches = await admin.query<{ amount: string; count: string }>(
      "select coalesce(sum(o.amount_minor),0)::text as amount,count(*)::text as count from openerp.bank_matches m join openerp.bank_observations o on (o.book_id,o.statement_id,o.row_ordinal)=(m.book_id,m.statement_id,m.row_ordinal) where m.book_id=$1",
      [book.bookId],
    );

    expect(matches.rows).toEqual([{ amount: "122000", count: "1" }]);

    const obligations = await decoded(
      await request(book, `/commerce/invoices/${invoice.id}`),
      Commerce.Invoice,
    );

    expect(obligations.outstandingMinor).toBe("0");
  } finally {
    await admin.end();
  }

  await saveEvidence("processor-charge-payout-receipt", book);
});

async function creditOrigin(
  book: Awaited<ReturnType<typeof fixture>>,
  customerId: string,
  evidenceId: string,
) {
  const prepare = {
    customerId,
    currency: "SEK",
    cashMinor: "10000",
    legs: [],
    surplusClassification: "unapplied_cash" as const,
    bankAccountId: "account_bank",
    evidenceId,
    receivableControlAccountId: "account_receivable",
    creditLiabilityAccountId: "account_liability",
    fiscalYearId: "fy_2026",
    accountingPeriodId: "period_2026",
    series: "VER",
    reason: "Synthetic original customer credit",
  };

  const reviewed = await post(
    book,
    "/commerce/customer-receipts",
    prepare,
    Credits.CustomerReceiptView,
  );

  const receipt = await post(
    book,
    "/commerce/customer-receipts/execute",
    { version: 1, digest: reviewed.digest, prepare },
    Credits.CustomerReceiptView,
  );

  if (!receipt.originId) throw new Error("Canonical customer credit must be retained");

  return receipt.originId;
}

test("processor refund fees and dispute hold win loss consume their canonical capacities once", async () => {
  const { book, reviewer, source, invoice, account, party } = await setup();
  const originId = await creditOrigin(book, party.id, source.id);

  const rows: Array<typeof Processor.ProviderRow.Type> = [
    charge(),
    {
      ...charge("txn_refund"),
      type: "refund",
      grossMinor: "-10000",
      feeMinor: "200",
      netMinor: "-10200",
    },
    { ...charge("txn_fee"), type: "fee_only", grossMinor: "-500", feeMinor: "0", netMinor: "-500" },
    {
      ...charge("txn_hold"),
      type: "dispute_hold",
      grossMinor: "-20000",
      feeMinor: "300",
      netMinor: "-20300",
      disputeId: "dp_won",
    },
    {
      ...charge("txn_won"),
      type: "dispute_won",
      grossMinor: "20000",
      feeMinor: "0",
      netMinor: "20000",
      disputeId: "dp_won",
    },
    {
      ...charge("txn_lost_hold"),
      type: "dispute_hold",
      grossMinor: "-7000",
      feeMinor: "100",
      netMinor: "-7100",
      disputeId: "dp_lost",
    },
    {
      ...charge("txn_loss"),
      type: "dispute_lost",
      grossMinor: "0",
      feeMinor: "0",
      netMinor: "0",
      disputeId: "dp_lost",
    },
  ];

  await seed(account, rows, "103900");
  const fetched = await fetchObservations(book, account.id);

  for (const observation of fetched.observations) {
    const common = reviewBasis(account.id, source.id);

    const input: typeof Processor.Prepare.Type =
      observation.type === "dispute_lost"
        ? { ...common, kind: "dispute_loss", observationId: observation.id }
        : {
            ...common,
            kind: "observation",
            observationId: observation.id,
            ...(observation.type === "charge" ? { invoiceId: invoice.id } : {}),
            ...(observation.type === "refund" ? { creditOriginId: originId } : {}),
          };

    await commit(book, reviewer, input);
  }

  const control = await decoded(
    await request(book, `/banking/processors/accounts/${account.id}/reconciliation/${fetched.id}`),
    Processor.Reconciliation,
  );

  expect([
    control.processorNativeMinor,
    control.processorLedgerMinor,
    control.processorNativeDifferenceMinor,
    control.complete,
  ]).toEqual(["103900", "103900", "0", true]);
  const admin = await database();

  try {
    const totals = await admin.query<{ account_id: string; minor: string }>(
      "select account_id,sum(debit_minor-credit_minor)::text as minor from openerp.journal_lines where book_id=$1 and account_id in ('account_fee','account_dispute','account_loss','account_liability','account_revenue') group by account_id order by account_id",
      [book.bookId],
    );

    expect(totals.rows).toEqual([
      { account_id: "account_dispute", minor: "0" },
      { account_id: "account_fee", minor: "4100" },
      { account_id: "account_liability", minor: "0" },
      { account_id: "account_loss", minor: "7000" },
      { account_id: "account_revenue", minor: "-125000" },
    ]);

    const capacity = await admin.query<{ consumed: string; count: string }>(
      "select sum(signed_consumed_minor::numeric)::text as consumed,count(*)::text as count from openerp.customer_credit_effects where book_id=$1 and origin_id=$2",
      [book.bookId, originId],
    );

    expect(capacity.rows).toEqual([{ consumed: "10000", count: "1" }]);
  } finally {
    await admin.end();
  }

  const exhausted = await request(book, "/banking/processors/reviews", {
    method: "POST",
    body: JSON.stringify({
      ...reviewBasis(account.id, source.id),
      kind: "observation",
      observationId: fetched.observations.find((row) => row.type === "refund")?.id,
      creditOriginId: originId,
    }),
  });

  expect(exhausted.status).toBe(422);
  await saveEvidence("processor-refund-fee-disputes", book);
});

test("processor stale capacity generic alternate journal and late fault cannot leave partial effects", async () => {
  const { book, reviewer, source, invoice, account } = await setup();
  await seed(account, [charge(), charge("txn_second")], "244000");
  const fetched = await fetchObservations(book, account.id);
  const first = fetched.observations[0];
  const second = fetched.observations[1];

  if (!first || !second)
    throw new Error("Two distinct equal-amount provider identities must remain distinct");

  const review = await post(
    book,
    "/banking/processors/reviews",
    {
      ...reviewBasis(account.id, source.id),
      kind: "observation",
      observationId: first.id,
      invoiceId: invoice.id,
    },
    Processor.Review,
  );

  const secondReview = await post(
    book,
    "/banking/processors/reviews",
    {
      ...reviewBasis(account.id, source.id),
      kind: "observation",
      observationId: second.id,
      invoiceId: invoice.id,
    },
    Processor.Review,
  );

  const approval = await post(
    reviewer,
    `/banking/processors/reviews/${review.id}/approvals`,
    { version: 1, digest: review.digest },
    Processor.Approval,
  );

  const secondApproval = await post(
    reviewer,
    `/banking/processors/reviews/${secondReview.id}/approvals`,
    { version: 1, digest: secondReview.digest },
    Processor.Approval,
  );

  const generic = await post(
    book,
    "/change-sets",
    {
      ...journal(source.id, "122000"),
      eventKey: `processor_${review.id}`,
      lines: [
        {
          accountId: "account_processor",
          debitMinor: "122000",
          creditMinor: "0",
          description: "Alternate processor action",
        },
        {
          accountId: "account_clearing",
          debitMinor: "0",
          creditMinor: "122000",
          description: "Alternate unsupported counterline",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const bypass = await request(reviewer, `/change-sets/${generic.id}/approvals`, {
    method: "POST",
    body: JSON.stringify({ version: generic.version, planDigest: generic.planDigest }),
  });

  expect(bypass.status).toBe(403);
  const key = crypto.randomUUID();

  const executionInput = {
    method: "POST",
    headers: { "idempotency-key": key },
    body: JSON.stringify({ version: 1, digest: review.digest, approvalId: approval.id }),
  };

  const admin = await database();
  const constraint = `processor_fault_${book.bookId}`;

  if (!/^[A-Za-z0-9_]+$/.test(constraint) || !/^[A-Za-z0-9_-]+$/.test(review.id))
    throw new Error("Synthetic fault identity is unsafe");

  try {
    await admin.query(
      `alter table openerp.processor_cash_effects add constraint ${constraint} check (review_id <> '${review.id}')`,
    );

    const failed = await request(
      book,
      `/banking/processors/reviews/${review.id}/execute`,
      executionInput,
    );

    expect(failed.status).toBe(500);

    const rollback = await admin.query<{
      vouchers: string;
      allocations: string;
      executions: string;
      consumed_approvals: string;
    }>(
      "select (select count(*)::text from openerp.vouchers where book_id=$1 and occurrence_key=$2) as vouchers,(select count(*)::text from openerp.commerce_allocation_legs where book_id=$1) as allocations,(select count(*)::text from openerp.processor_executions where book_id=$1) as executions,(select count(*)::text from openerp.approval_consumptions where book_id=$1 and approval_id=$3) as consumed_approvals",
      [book.bookId, review.id, approval.id],
    );

    expect(rollback.rows).toEqual([
      { vouchers: "0", allocations: "0", executions: "0", consumed_approvals: "0" },
    ]);
  } finally {
    await admin.query(
      `alter table openerp.processor_cash_effects drop constraint if exists ${constraint}`,
    );
    await admin.end();
  }

  const retried = await decoded(
    await request(book, `/banking/processors/reviews/${review.id}/execute`, executionInput),
    Processor.Execution,
  );

  expect(retried.cashEffects).toEqual([
    {
      accountId: "account_processor",
      capacityVersion: review.cashEffects[0]?.capacityVersion,
      nativeDeltaMinor: "122000",
      carryingDeltaMinor: "122000",
    },
  ]);

  const stale = await request(book, `/banking/processors/reviews/${secondReview.id}/execute`, {
    method: "POST",
    body: JSON.stringify({
      version: 1,
      digest: secondReview.digest,
      approvalId: secondApproval.id,
    }),
  });

  expect(stale.status).toBe(409);
  const outsider = await fixture();

  const denied = await request(
    { ...book, token: outsider.token },
    `/banking/processors/reviews/${review.id}/execute`,
    executionInput,
  );

  expect(denied.status).toBe(403);
  await saveEvidence("processor-capacity-ownership-rollback-retry", book);
});

test("native processor charge uses current rate stored AR basis and real EUR payout bank holding", async () => {
  const { book, reviewer, source, account, party } = await setup("EUR");

  const opening = await post(
    book,
    "/banking/foreign-cash/reviews",
    {
      kind: "open",
      accountId: "account_bank",
      nativeCurrency: "EUR",
      nativeScale: 2,
      openingNativeMinor: "0",
      date: "2026-01-01",
      accountingPeriodId: "period_2026",
      series: "VER",
      evidenceId: source.id,
      sourceIdentity: "processor_bank_opening",
      reason: "Real synthetic EUR bank holding",
      acknowledgeLimitedProfile: true,
    },
    NativeCash.Review,
  );

  const openingApproval = await post(
    reviewer,
    `/banking/foreign-cash/reviews/${opening.id}/approvals`,
    { version: 1, digest: opening.digest },
    NativeCash.Approval,
  );

  await post(
    book,
    `/banking/foreign-cash/reviews/${opening.id}/execute`,
    { version: 1, digest: opening.digest, approvalId: openingApproval.id },
    NativeCash.Execution,
  );

  const quote = await post(
    book,
    "/exchange-rates",
    {
      sourceKey: crypto.randomUUID(),
      terms: {
        fromCurrency: "EUR",
        toCurrency: "SEK",
        effectiveOn: "2026-01-01",
        retrievedOn: "2026-01-01",
        rateNumerator: "11",
        rateDenominator: "1",
        evidenceId: source.id,
        sourceLocator: "Synthetic recognition quote",
        reviewEvidenceId: source.id,
        rationale: "Synthetic rate qualification",
      },
    },
    Rates.ExchangeRateRevision,
  );

  const recognition = await post(
    book,
    "/commerce/fx/recognition-reviews",
    {
      profile: "synthetic_customer_foreign_receivable_v1",
      sourceKey: crypto.randomUUID(),
      sourceRevision: "1",
      counterpartyId: party.id,
      counterpartyRevision: party.revision,
      documentNumber: "PROCESSOR-EUR",
      recognitionDate: "2026-01-01",
      originalCurrency: "EUR",
      originalScale: 2,
      originalMinor: "125000",
      rateObservationId: quote.observationId,
      rateDigest: quote.digest,
      accountingPeriodId: "period_2026",
      series: "VER",
      controlAccountId: "account_native_receivable",
      cashAccountId: "account_bank",
      realizedGainAccountId: "account_gain",
      realizedLossAccountId: "account_fx_loss",
      revenueAccountId: "account_revenue",
      accountRoleEvidence: { evidenceId: source.id, sha256: source.sha256 },
      evidenceId: source.id,
      eventKey: "processor_fx_recognition",
      reason: "Stored canonical EUR obligation",
      syntheticNoTaxConfirmed: true,
      acknowledgeLimitedProfile: true,
    },
    Fx.RecognitionReview,
  );

  const approved = await post(
    reviewer,
    `/commerce/fx/recognition-reviews/${recognition.id}/approvals`,
    { version: 1, digest: recognition.digest },
    Fx.FxApproval,
  );

  const item = await post(
    book,
    `/commerce/fx/recognition-reviews/${recognition.id}/execute`,
    { version: 1, digest: recognition.digest, approvalId: approved.id },
    Fx.MonetaryItem,
  );

  const spot = await post(
    book,
    "/exchange-rates",
    {
      sourceKey: crypto.randomUUID(),
      terms: {
        fromCurrency: "EUR",
        toCurrency: "SEK",
        effectiveOn: "2026-01-15",
        retrievedOn: "2026-01-15",
        rateNumerator: "10",
        rateDenominator: "1",
        evidenceId: source.id,
        sourceLocator: "Synthetic settlement quote",
        reviewEvidenceId: source.id,
        rationale: "Synthetic rate qualification",
      },
    },
    Rates.ExchangeRateRevision,
  );

  await seed(account, [
    { ...charge(), currency: "EUR" },
    { ...payout(), currency: "EUR" },
  ]);
  const fetched = await fetchObservations(book, account.id);
  const chargeSource = fetched.observations[0];
  const payoutSource = fetched.observations[1];

  if (!chargeSource || !payoutSource) throw new Error("Native source manifest must be retained");

  const cleared = await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: chargeSource.id,
    fxItemId: item.id,
    rateObservationId: spot.observationId,
    rateDigest: spot.digest,
  });

  expect(
    cleared.review.journal.map((line) => [line.accountId, line.debitMinor, line.creditMinor]),
  ).toEqual([
    ["account_processor", "1220000", "0"],
    ["account_fee", "30000", "0"],
    ["account_native_receivable", "0", "1375000"],
    ["account_fx_loss", "125000", "0"],
  ]);

  const held = await decoded(
    await request(book, "/banking/foreign-cash/accounts/account_processor"),
    NativeCash.Holding,
  );

  expect([held.nativeMinor, held.carryingMinor]).toEqual(["122000", "1220000"]);
  await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: payoutSource.id,
  });

  const statementSource = {
    kind: "synthetic_bank_statement_v1" as const,
    statementIdentifier: crypto.randomUUID(),
    sourceBankAccountId: "synthetic_processor_bank",
    accountId: "account_bank",
    currency: "EUR",
    startsOn: "2026-01-01",
    endsOn: "2026-01-31",
    openingMinor: "0",
    closingMinor: "122000",
    completeness: { declaredComplete: true, basis: "Synthetic complete EUR payout" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: "po_122000",
        date: "2026-01-18",
        description: "Native processor payout",
        amountMinor: "122000",
      },
    ],
  };

  const raw = await post(
    book,
    "/evidence",
    {
      title: "Native payout bank source",
      mediaType: "application/json",
      content: JSON.stringify(statementSource),
      origin: "Synthetic native payout proof",
    },
    Accounting.Evidence,
  );

  const statement = await post(
    book,
    "/bank-statements",
    { ...statementSource, evidenceId: raw.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );

  await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    date: "2026-01-18",
    kind: "bank_receipt",
    payoutObservationId: payoutSource.id,
    bankObservation: { statementId: statement.statement.id, rowOrdinal: 1 },
  });

  const bank = await decoded(
    await request(book, "/banking/foreign-cash/accounts/account_bank"),
    NativeCash.Holding,
  );

  expect([bank.nativeMinor, bank.carryingMinor]).toEqual(["122000", "1220000"]);

  const remaining = await decoded(
    await request(book, `/commerce/fx/items/${item.id}`),
    Fx.MonetaryItem,
  );

  expect([
    remaining.remainingOriginalMinor,
    remaining.remainingCarryingMinor,
    remaining.status,
  ]).toEqual(["0", "0", "settled"]);

  const control = await decoded(
    await request(book, `/banking/processors/accounts/${account.id}/reconciliation/${fetched.id}`),
    Processor.Reconciliation,
  );

  expect([
    control.processorNativeMinor,
    control.processorLedgerMinor,
    control.transitNativeMinor,
    control.transitLedgerMinor,
    control.complete,
  ]).toEqual(["0", "0", "0", "0", true]);

  const bankControl = await decoded(
    await request(
      book,
      `/banking/foreign-cash/accounts/account_bank/reconciliation/${statement.statement.id}`,
    ),
    NativeCash.Reconciliation,
  );

  expect([
    bankControl.nativeDifferenceMinor,
    bankControl.bookDifferenceMinor,
    bankControl.sourceConsumptionComplete,
    bankControl.nativeReconciled,
    bankControl.bookReconciled,
  ]).toEqual(["0", "0", true, true, true]);
  await saveEvidence("processor-native-cash-obligation-payout", book);
});

const Rpc = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Finite,
  result: Schema.optional(Schema.JsonObject),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.Finite,
      message: Schema.String,
      data: Schema.Struct({ code: Accounting.FailureCode }),
    }),
  ),
});

async function processorTool(
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

  return Schema.decodeUnknownSync(Rpc)(await response.json());
}

test("processor MCP rejects client money and agent approval then executes the operator-approved source once", async () => {
  const { book, reviewer, source, invoice, account } = await setup();
  await seed(account, [charge()], "122000");
  const fetched = await fetchObservations(book, account.id);
  const observation = fetched.observations[0];

  if (!observation) throw new Error("MCP proof needs a retained source");

  const input = {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: observation.id,
    invoiceId: invoice.id,
  };

  const malformed = await processorTool(book, "banking_prepare_processor_clearing", {
    scope: { entityId: book.entityId, bookId: book.bookId },
    idempotencyKey: crypto.randomUUID(),
    input: { ...input, grossMinor: "1" },
  });

  expect(malformed.error?.data.code).toBe("InvalidRequest");

  const prepared = await processorTool(book, "banking_prepare_processor_clearing", {
    scope: { entityId: book.entityId, bookId: book.bookId },
    idempotencyKey: crypto.randomUUID(),
    input,
  });

  expect(prepared.result, JSON.stringify(prepared.result)).toMatchObject({ isError: false });

  const response = Schema.decodeUnknownSync(
    Schema.Struct({
      isError: Schema.Literal(false),
      structuredContent: Schema.Struct({ result: Processor.Review }),
    }),
  )(prepared.result);

  const review = response.structuredContent.result;

  const denied = await processorTool(book, "banking_approve_processor_clearing", {
    scope: { entityId: book.entityId, bookId: book.bookId },
    idempotencyKey: crypto.randomUUID(),
    reviewId: review.id,
    input: { version: 1, digest: review.digest },
  });

  expect(denied.error).toMatchObject({
    code: -32602,
    message: "Unknown tool.",
    data: { code: "InvalidRequest" },
  });

  const listed = await fetch(`${environment().baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${book.agentToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

  expect(listed.status).toBe(200);

  const catalog = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
    }),
  )(await listed.json());

  const names = catalog.result.tools.map((tool) => tool.name);
  expect(names).toContain("banking_prepare_processor_clearing");
  expect(names).toContain("banking_execute_processor_clearing");
  expect(names).not.toContain("banking_approve_processor_clearing");

  const unapproved = await processorTool(book, "banking_execute_processor_clearing", {
    scope: { entityId: book.entityId, bookId: book.bookId },
    idempotencyKey: crypto.randomUUID(),
    reviewId: review.id,
    input: { version: 1, digest: review.digest, approvalId: "missing_processor_approval" },
  });

  const refusal = Schema.decodeUnknownSync(
    Schema.Struct({
      isError: Schema.Literal(true),
      content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
    }),
  )(unapproved.result);

  const text = refusal.content[0]?.text;

  if (!text) throw new Error("MCP must expose the approval refusal");
  expect(
    Schema.decodeSync(Schema.fromJsonString(Schema.Struct({ code: Accounting.FailureCode })))(text)
      .code,
  ).toBe("ApprovalRequired");
  const before = await database();

  try {
    const counts = await before.query<{ reviews: string; approvals: string; executions: string }>(
      "select (select count(*)::text from openerp.processor_reviews where book_id=$1) reviews,(select count(*)::text from openerp.processor_approvals where book_id=$1) approvals,(select count(*)::text from openerp.processor_executions where book_id=$1) executions",
      [book.bookId],
    );

    expect(counts.rows).toEqual([{ reviews: "1", approvals: "0", executions: "0" }]);
  } finally {
    await before.end();
  }

  const approval = await post(
    reviewer,
    `/banking/processors/reviews/${review.id}/approvals`,
    { version: 1, digest: review.digest },
    Processor.Approval,
  );

  const arguments_ = {
    scope: { entityId: book.entityId, bookId: book.bookId },
    idempotencyKey: crypto.randomUUID(),
    reviewId: review.id,
    input: { version: 1, digest: review.digest, approvalId: approval.id },
  };

  const executed = await processorTool(book, "banking_execute_processor_clearing", arguments_);
  expect(executed.result, JSON.stringify(executed.result)).toMatchObject({ isError: false });

  const committed = Schema.decodeUnknownSync(
    Schema.Struct({
      isError: Schema.Literal(false),
      structuredContent: Schema.Struct({ result: Processor.Execution }),
    }),
  )(executed.result);

  expect(
    committed.structuredContent.result.cashEffects.map((effect) => [
      effect.nativeDeltaMinor,
      effect.carryingDeltaMinor,
    ]),
  ).toEqual([["122000", "122000"]]);
  const retry = await processorTool(book, "banking_execute_processor_clearing", arguments_);
  expect(retry.result).toEqual(executed.result);
  await saveEvidence("processor-mcp-owned-handoff", book);
});

test("processor public boundary rejects asserted money and agent approval before lawful agent execution", async () => {
  const { book, reviewer, source, invoice, account } = await setup();
  await seed(account, [charge()], "122000");
  const fetched = await fetchObservations(book, account.id);
  const observation = fetched.observations[0];

  if (!observation) throw new Error("Charge source must be retained");

  const input = {
    ...reviewBasis(account.id, source.id),
    kind: "observation" as const,
    observationId: observation.id,
    invoiceId: invoice.id,
  };

  const malformed = await request(book, "/banking/processors/reviews", {
    method: "POST",
    body: JSON.stringify({ ...input, netMinor: "1" }),
  });

  expect(malformed.status).toBe(400);
  const agent = { ...book, actorId: book.agentId, token: book.agentToken };
  const review = await post(agent, "/banking/processors/reviews", input, Processor.Review);

  const forbidden = await request(agent, `/banking/processors/reviews/${review.id}/approvals`, {
    method: "POST",
    body: JSON.stringify({ version: 1, digest: review.digest }),
  });

  expect(forbidden.status).toBe(403);

  const unapproved = await request(agent, `/banking/processors/reviews/${review.id}/execute`, {
    method: "POST",
    body: JSON.stringify({ version: 1, digest: review.digest, approvalId: "missing_approval" }),
  });

  expect(unapproved.status).toBe(403);

  const approval = await post(
    reviewer,
    `/banking/processors/reviews/${review.id}/approvals`,
    { version: 1, digest: review.digest },
    Processor.Approval,
  );

  const key = crypto.randomUUID();

  const executed = await request(agent, `/banking/processors/reviews/${review.id}/execute`, {
    method: "POST",
    headers: { "idempotency-key": key },
    body: JSON.stringify({ version: 1, digest: review.digest, approvalId: approval.id }),
  });

  const result = await decoded(executed, Processor.Execution);

  const retry = await decoded(
    await request(agent, `/banking/processors/reviews/${review.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": key },
      body: JSON.stringify({ version: 1, digest: review.digest, approvalId: approval.id }),
    }),
    Processor.Execution,
  );

  expect(retry).toEqual(result);
  const db = await database();

  try {
    const rows = await db.query<{ actor_id: string; consumed: boolean }>(
      "select actor_id,consumed_at is not null as consumed from openerp.approvals where book_id=$1 and id=$2",
      [book.bookId, approval.id],
    );

    expect(rows.rows).toEqual([{ actor_id: reviewer.actorId, consumed: true }]);
  } finally {
    await db.end();
  }

  await saveEvidence("processor-operator-agent-handoff", book);
});

test("processor identity conflict and unknown reserve remain visible without money effects", async () => {
  const { book, account } = await setup();
  await seed(account, [charge()], "122000");
  const first = await fetchObservations(book, account.id);
  await seed(account, [{ ...charge(), netMinor: "121000", feeMinor: "4000" }], "121000");

  const conflict = await request(book, `/banking/processors/accounts/${account.id}/fetches`, {
    method: "POST",
    body: JSON.stringify({ startsOn: "2026-01-01", endsOn: "2026-01-31", view: "balance" }),
  });

  expect(conflict.status).toBe(409);
  await seed(
    account,
    [
      {
        ...charge("txn_reserve"),
        type: "reserve_hold",
        grossMinor: "-100",
        netMinor: "-100",
        feeMinor: "0",
      },
    ],
    "-100",
  );
  const unsupported = await fetchObservations(book, account.id);
  expect(unsupported.observations[0]?.classification).toBe("requires_classification");

  const controls = await decoded(
    await request(
      book,
      `/banking/processors/accounts/${account.id}/reconciliation/${unsupported.id}`,
    ),
    Processor.Reconciliation,
  );

  expect(controls.complete).toBe(false);
  expect(controls.blockers).toContain("unclassified_observation");
  expect(first.observations[0]?.netMinor).toBe("122000");
  await saveEvidence("processor-identity-and-unclassified", book);
});

test("native processor refund consumes stored credit and real holding basis then fetches the next window", async () => {
  const { book, reviewer, source, account, party } = await setup("EUR", {
    processorMinor: "10000",
  });

  const plan = await post(
    book,
    "/change-sets",
    {
      ...journal(source.id, "1000"),
      postingDate: "2026-01-01",
      lines: [
        {
          accountId: "account_bank",
          debitMinor: "1000",
          creditMinor: "0",
          description: "Qualified original cash",
        },
        {
          accountId: "account_liability",
          debitMinor: "0",
          creditMinor: "1000",
          description: "Qualified original credit",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const posted = await execute(book, plan);
  const db = await database();
  let lineId: string;

  try {
    const lines = await db.query<{ id: string }>(
      "select id from openerp.journal_lines where book_id=$1 and voucher_id=$2 and account_id='account_liability'",
      [book.bookId, posted.voucherId],
    );

    const line = lines.rows[0];

    if (!line) throw new Error("Original native credit book basis must be retained");
    lineId = line.id;
  } finally {
    await db.end();
  }

  const witness = await post(
    book,
    "/evidence",
    {
      title: "Qualified synthetic native credit",
      mediaType: "application/json",
      origin: "Synthetic processor credit qualification",
      content: JSON.stringify({
        kind: "synthetic_native_processor_credit_v1",
        customerId: party.id,
        currency: "EUR",
        currencyScale: 2,
        nativeMinor: "100",
        liabilityAccountId: "account_liability",
        receivableAccountId: "account_receivable",
        voucherId: posted.voucherId,
        lineId,
      }),
    },
    Accounting.Evidence,
  );

  const malformed = await request(book, "/banking/processors/native-credit-origins", {
    method: "POST",
    body: JSON.stringify({
      accountId: account.id,
      evidenceId: witness.id,
      reason: "Stored native basis",
      carryingMinor: "1",
    }),
  });

  expect(malformed.status).toBe(400);

  const adopted = await post(
    book,
    "/banking/processors/native-credit-origins",
    { accountId: account.id, evidenceId: witness.id, reason: "Stored native basis" },
    Processor.NativeCreditOrigin,
  );

  expect(adopted.originalNativeMinor).toBe("100");
  expect(adopted.originalCarryingMinor).toBe("1000");
  expect(adopted.customerId).toBe(party.id);

  const duplicate = await request(book, "/banking/processors/native-credit-origins", {
    method: "POST",
    body: JSON.stringify({
      accountId: account.id,
      evidenceId: witness.id,
      reason: "Second adoption is forbidden",
    }),
  });

  expect(duplicate.status).toBe(409);
  await seed(
    account,
    [
      {
        ...charge(),
        id: "txn_native_refund",
        sourceId: "native_credit_refund",
        type: "refund",
        currency: "EUR",
        grossMinor: "-100",
        feeMinor: "0",
        netMinor: "-100",
      },
    ],
    "900",
    { openingMinor: "1000" },
  );
  const fetched = await fetchObservations(book, account.id);
  const refund = fetched.observations[0];

  if (!refund) throw new Error("The native refund source must be retained");

  const refunded = await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: refund.id,
    creditOriginId: adopted.id,
  });

  expect(
    refunded.review.journal.map((line) => [line.accountId, line.debitMinor, line.creditMinor]),
  ).toEqual([
    ["account_liability", "1000", "0"],
    ["account_processor", "0", "1000"],
  ]);

  const holding = await decoded(
    await request(book, "/banking/foreign-cash/accounts/account_processor"),
    NativeCash.Holding,
  );

  expect([holding.nativeMinor, holding.carryingMinor]).toEqual(["900", "9000"]);
  const verify = await database();

  try {
    const totals = await verify.query<{ consumed: string; count: string; carrying: string }>(
      "select (select sum(signed_consumed_minor::numeric)::text from openerp.customer_credit_effects where book_id=$1 and origin_id=$2) consumed,(select count(*)::text from openerp.customer_credit_effects where book_id=$1 and origin_id=$2) count,(select sum(debit_minor-credit_minor)::text from openerp.journal_lines where book_id=$1 and account_id='account_liability') carrying",
      [book.bookId, adopted.id],
    );

    expect(totals.rows).toEqual([{ consumed: "100", count: "1", carrying: "0" }]);
  } finally {
    await verify.end();
  }

  await seed(account, [], "900", {
    openingMinor: "900",
    startsOn: "2026-02-01",
    endsOn: "2026-02-28",
  });

  const next = await post(
    book,
    `/banking/processors/accounts/${account.id}/fetches`,
    { startsOn: "2026-02-01", endsOn: "2026-02-28", view: "balance" },
    Processor.Fetch,
  );

  const control = await decoded(
    await request(book, `/banking/processors/accounts/${account.id}/reconciliation/${next.id}`),
    Processor.Reconciliation,
  );

  expect([
    control.processorNativeMinor,
    control.processorLedgerMinor,
    control.providerClosingMinor,
    control.complete,
  ]).toEqual(["900", "9000", "900", true]);
  await saveEvidence("processor-native-credit-stored-basis", book);
});

test("processor fetch survives a lost response and retains each page once under the original key", async () => {
  const { book, reviewer, source, account, invoice } = await setup();
  await seed(account, [charge(), payout()], "0", { pageSize: 1, lostResponses: 1 });

  const init = {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ startsOn: "2026-01-01", endsOn: "2026-01-31", view: "balance" }),
  };

  const path = `/banking/processors/accounts/${account.id}/fetches`;
  const lost = await request(book, path, init);
  expect(lost.status).toBe(503);
  expect((await lost.json()).code).toBe("Unavailable");
  const fetched = await decoded(await request(book, path, init), Processor.Fetch);
  expect(fetched.observations.map((row) => [row.balanceTransactionId, row.netMinor])).toEqual([
    ["txn_charge", "122000"],
    ["txn_payout", "-122000"],
  ]);
  expect(fetched.rawSourceRefs).toHaveLength(2);
  expect(await decoded(await request(book, path, init), Processor.Fetch)).toEqual(fetched);
  const chargeRow = fetched.observations[0];
  const payoutRow = fetched.observations[1];

  if (!chargeRow || !payoutRow) throw new Error("Both retried pages must be retained");
  await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: chargeRow.id,
    invoiceId: invoice.id,
  });
  await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: payoutRow.id,
  });
  const admin = await database();

  try {
    const counts = await admin.query<{
      requests: string;
      pages: string;
      observations: string;
      effects: string;
    }>(
      "select (select count(*)::text from openerp.processor_fetch_requests where book_id=$1) requests,(select count(*)::text from openerp.processor_fetch_pages where book_id=$1) pages,(select count(*)::text from openerp.processor_observations where book_id=$1) observations,(select count(*)::text from openerp.processor_executions where book_id=$1) effects",
      [book.bookId],
    );

    expect(counts.rows).toEqual([{ requests: "1", pages: "2", observations: "2", effects: "2" }]);
  } finally {
    await admin.end();
  }

  await saveEvidence("processor-fetch-lost-response-pages", book);
});

test("processor payout cannot spend unfunded custody and succeeds after the retained charge", async () => {
  const { book, reviewer, source, account, invoice } = await setup();
  await seed(account, [charge(), payout()]);
  const fetched = await fetchObservations(book, account.id);
  const chargeRow = fetched.observations[0];
  const payoutRow = fetched.observations[1];

  if (!chargeRow || !payoutRow) throw new Error("Funding and payout rows must exist");

  const payoutInput = {
    ...reviewBasis(account.id, source.id),
    kind: "observation" as const,
    observationId: payoutRow.id,
  };

  const unfunded = await request(book, "/banking/processors/reviews", {
    method: "POST",
    body: JSON.stringify(payoutInput),
  });

  expect(unfunded.status).toBe(422);
  expect((await unfunded.json()).code).toBe("InvalidJournal");
  await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: chargeRow.id,
    invoiceId: invoice.id,
  });
  const paid = await commit(book, reviewer, payoutInput);
  expect(
    paid.execution.cashEffects.map((effect) => [
      effect.accountId,
      effect.nativeDeltaMinor,
      effect.carryingDeltaMinor,
    ]),
  ).toEqual([
    ["account_processor", "-122000", "-122000"],
    ["account_transit", "122000", "122000"],
  ]);
  await saveEvidence("processor-funded-capacity", book);
});

async function emptyStatement(
  book: Awaited<ReturnType<typeof fixture>>,
  evidenceId: string,
  endsOn = "2026-01-31",
) {
  const input = {
    kind: "synthetic_bank_statement_v1" as const,
    statementIdentifier: crypto.randomUUID(),
    sourceBankAccountId: "synthetic_processor_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-01-01",
    endsOn,
    openingMinor: "0",
    closingMinor: "0",
    completeness: { declaredComplete: true, basis: "Complete synthetic nonsettlement window" },
    rows: [],
  };

  const raw = await post(
    book,
    "/evidence",
    {
      title: "Independent empty payout bank window",
      mediaType: "application/json",
      content: JSON.stringify(input),
      origin: evidenceId,
    },
    Accounting.Evidence,
  );

  return post(
    book,
    "/bank-statements",
    { ...input, evidenceId: raw.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );
}

test("processor failed payout requires a retained complete nonsettlement window and current failure date", async () => {
  const { book, reviewer, source, account, invoice } = await setup();

  const failed = {
    ...payout(),
    id: "txn_payout_failure",
    sourceId: "payout_failure",
    type: "payout_failure",
    grossMinor: "122000",
    netMinor: "122000",
    occurredOn: "2026-01-19",
    availableOn: "2026-01-19",
  };

  await seed(account, [charge(), payout(), failed], "122000");
  const fetched = await fetchObservations(book, account.id);
  const [chargeRow, payoutRow, failureRow] = fetched.observations;

  if (!chargeRow || !payoutRow || !failureRow)
    throw new Error("Payout failure manifest is incomplete");
  await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: chargeRow.id,
    invoiceId: invoice.id,
  });
  await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: payoutRow.id,
  });
  const imported = await emptyStatement(book, source.id);

  const proof = await post(
    book,
    "/evidence",
    {
      title: "Qualified synthetic payout did not settle",
      mediaType: "application/json",
      origin: source.id,
      content: JSON.stringify({
        kind: "synthetic_processor_nonsettlement_v1",
        providerAccountId: account.providerAccountId,
        providerPayoutId: "po_122000",
        failureBalanceTransactionId: failed.id,
        bankAccountId: "account_bank",
        startsOn: "2026-01-01",
        endsOn: "2026-01-31",
        cashDidNotSettle: true,
        statementId: imported.statement.id,
      }),
    },
    Accounting.Evidence,
  );

  const input = {
    ...reviewBasis(account.id, source.id),
    date: "2026-01-19",
    kind: "payout_failure" as const,
    payoutObservationId: payoutRow.id,
    failureObservationId: failureRow.id,
    nonSettlementEvidenceId: proof.id,
  };

  const statusOnly = await request(book, "/banking/processors/reviews", {
    method: "POST",
    body: JSON.stringify({ ...input, nonSettlementEvidenceId: source.id }),
  });

  expect(statusOnly.status).toBe(422);
  expect((await statusOnly.json()).code).toBe("MissingEvidence");

  const earlier = await request(book, "/banking/processors/reviews", {
    method: "POST",
    body: JSON.stringify({ ...input, date: "2026-01-17" }),
  });

  expect(earlier.status).toBe(422);
  expect((await earlier.json()).code).toBe("InvalidJournal");
  const returned = await commit(book, reviewer, input);
  expect(
    returned.review.journal.map((line) => [line.accountId, line.debitMinor, line.creditMinor]),
  ).toEqual([
    ["account_processor", "122000", "0"],
    ["account_transit", "0", "122000"],
  ]);

  const control = await decoded(
    await request(book, `/banking/processors/accounts/${account.id}/reconciliation/${fetched.id}`),
    Processor.Reconciliation,
  );

  expect([
    control.processorNativeMinor,
    control.processorLedgerMinor,
    control.transitNativeMinor,
    control.transitLedgerMinor,
    control.complete,
  ]).toEqual(["122000", "122000", "0", "0", true]);
  await saveEvidence("processor-payout-failure-nonsettlement", book);
});

test("processor bank receipt adopts a compatible stored cash posting without posting it twice", async () => {
  const { book, reviewer, source, account, invoice, adoptedVoucherId } = await setup("SEK", {
    adoptedTransitMinor: "122000",
  });

  if (!adoptedVoucherId) throw new Error("An independently posted payout receipt is required");
  await seed(account, [charge(), payout()]);
  const fetched = await fetchObservations(book, account.id);
  const [chargeRow, payoutRow] = fetched.observations;

  if (!chargeRow || !payoutRow) throw new Error("Adoption needs retained economic sources");
  await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: chargeRow.id,
    invoiceId: invoice.id,
  });
  await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: payoutRow.id,
  });
  const imported = await statement(book, source.id);
  const admin = await database();
  let bankLineId: string;

  try {
    const rows = await admin.query<{ id: string }>(
      "select id from openerp.journal_lines where book_id=$1 and voucher_id=$2 and account_id='account_bank'",
      [book.bookId, adoptedVoucherId],
    );

    const line = rows.rows[0];

    if (!line) throw new Error("The stored bank line must exist");
    bankLineId = line.id;
  } finally {
    await admin.end();
  }

  const adopted = await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    date: "2026-01-18",
    kind: "bank_receipt",
    payoutObservationId: payoutRow.id,
    bankObservation: { statementId: imported.statement.id, rowOrdinal: 1 },
    adoptedVoucherId,
    adoptedBankLineId: bankLineId,
  });

  expect(adopted.review.journal).toEqual([]);
  expect(adopted.execution.voucherId).toBe(adoptedVoucherId);

  const control = await decoded(
    await request(book, `/banking/processors/accounts/${account.id}/reconciliation/${fetched.id}`),
    Processor.Reconciliation,
  );

  expect([control.transitNativeMinor, control.transitLedgerMinor, control.complete]).toEqual([
    "0",
    "0",
    true,
  ]);
  const verify = await database();

  try {
    const totals = await verify.query<{ bank: string; revenue: string; matches: string }>(
      "select (select sum(debit_minor-credit_minor)::text from openerp.journal_lines where book_id=$1 and account_id='account_bank') bank,(select sum(debit_minor-credit_minor)::text from openerp.journal_lines where book_id=$1 and account_id='account_revenue') revenue,(select count(*)::text from openerp.bank_matches where book_id=$1) matches",
      [book.bookId],
    );

    expect(totals.rows).toEqual([{ bank: "122000", revenue: "-125000", matches: "1" }]);
  } finally {
    await verify.end();
  }

  await saveEvidence("processor-existing-receipt-adoption", book);
});

test("synthetic hostile retained generic reversal cannot release a processor-owned allocation", async () => {
  const { book, reviewer, source, account, invoice } = await setup();
  await seed(account, [charge()], "122000");
  const fetched = await fetchObservations(book, account.id);
  const row = fetched.observations[0];

  if (!row) throw new Error("The protected allocation needs a source");
  await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: row.id,
    invoiceId: invoice.id,
  });

  const currentInvoice = await decoded(
    await request(book, `/commerce/invoices/${invoice.id}`),
    Commerce.Invoice,
  );

  const admin = await database();
  const planId = `hostile_reversal_${crypto.randomUUID()}`;
  const approvalId = `hostile_approval_${crypto.randomUUID()}`;
  let digest: string;

  try {
    const rows = await admin.query<{ receipt: Schema.JsonObject; plan: Schema.JsonObject }>(
      "select r.body receipt,p.body plan from openerp.commerce_allocation_receipts r join openerp.commerce_allocation_plans p on (p.book_id,p.id)=(r.book_id,r.plan_id) where r.book_id=$1",
      [book.bookId],
    );

    const retained = rows.rows[0];

    if (!retained) throw new Error("The canonical owned allocation must be retained");
    const original = Schema.decodeUnknownSync(Commerce.AllocationReceipt)(retained.receipt);
    const originalPlan = Schema.decodeUnknownSync(Commerce.AllocationPlan)(retained.plan);

    const legacy = {
      id: planId,
      version: 1,
      scope: { entityId: book.entityId, bookId: book.bookId },
      input: { receiptId: original.id, reason: "Synthetic hostile legacy reversal probe" },
      snapshot: {
        original,
        originalPlan,
        legs: [
          {
            ordinal: 1,
            invoiceId: invoice.id,
            paymentVoucherId: originalPlan.payment.voucherId,
            paymentLineId: originalPlan.payment.lineId,
            amountMinor: "125000",
          },
        ],
        invoices: [
          { invoice: currentInvoice, releasedMinor: "125000", outstandingAfterMinor: "125000" },
        ],
        payment: {
          ...originalPlan.payment,
          allocatedMinor: "125000",
          remainingMinor: "0",
          capacityVersion: "1",
        },
        paymentRemainingAfterMinor: "125000",
        periods: [{ id: "period_2026", version: "1", locked: false }],
        account: { id: "account_receivable", version: originalPlan.accountVersion },
        profileVersion: originalPlan.profileVersion,
        writerEpoch: originalPlan.writerEpoch,
      },
      currency: "SEK",
      currencyScale: 2,
      createdBy: book.actorId,
      createdAt: new Date().toISOString(),
      digest: "",
      receipt: {
        key: crypto.randomUUID(),
        operation: "synthetic_hostile_legacy_provisioning",
        actorId: book.actorId,
      },
    };

    const canonical = canonicalizeJson(legacy);

    if (Result.isFailure(canonical))
      throw new Error("The synthetic retained plan must be canonical JSON");
    digest = `sha256:${createHash("sha256").update(canonical.success.bytes).digest("hex")}`;

    const plan = Schema.decodeUnknownSync(Reversals.CommerceAllocationReversalPlan)({
      ...legacy,
      digest,
    });

    await admin.query(
      "insert into openerp.commerce_allocation_reversal_plans(book_id,id,receipt_id,body) values ($1,$2,$3,$4::jsonb)",
      [book.bookId, planId, original.id, JSON.stringify(plan)],
    );

    const approval = Schema.decodeUnknownSync(Reversals.CommerceAllocationReversalApproval)({
      id: approvalId,
      planId,
      version: 1,
      digest,
      actorId: reviewer.actorId,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      receipt: {
        key: crypto.randomUUID(),
        operation: "synthetic_hostile_legacy_provisioning",
        actorId: reviewer.actorId,
      },
    });

    await admin.query(
      "insert into openerp.commerce_allocation_reversal_approvals(book_id,id,plan_id,actor_id,expires_at,body) values ($1,$2,$3,$4,$5,$6::jsonb)",
      [
        book.bookId,
        approvalId,
        planId,
        reviewer.actorId,
        approval.expiresAt,
        JSON.stringify(approval),
      ],
    );
  } finally {
    await admin.end();
  }

  const deniedApproval = await request(
    reviewer,
    `/commerce/allocation-reversal-plans/${planId}/approve`,
    { method: "POST", body: JSON.stringify({ version: 1, digest }) },
  );

  expect(deniedApproval.status).toBe(403);
  expect((await deniedApproval.json()).code).toBe("ApprovalRequired");

  const deniedExecution = await request(
    book,
    `/commerce/allocation-reversal-plans/${planId}/execute`,
    { method: "POST", body: JSON.stringify({ version: 1, digest, approvalId }) },
  );

  expect(deniedExecution.status).toBe(403);
  expect((await deniedExecution.json()).code).toBe("ApprovalRequired");

  const unchanged = await decoded(
    await request(book, `/commerce/invoices/${invoice.id}`),
    Commerce.Invoice,
  );

  expect(unchanged.outstandingMinor).toBe("0");
  const verify = await database();

  try {
    const effects = await verify.query<{ reversals: string; allocations: string }>(
      "select (select count(*)::text from openerp.commerce_allocation_reversals where book_id=$1) reversals,(select count(*)::text from openerp.commerce_allocation_receipts where book_id=$1) allocations",
      [book.bookId],
    );

    expect(effects.rows).toEqual([{ reversals: "0", allocations: "1" }]);
  } finally {
    await verify.end();
  }

  await saveEvidence("processor-hostile-generic-reversal-refusal", book);
});

test("processor registration refuses reserved commerce and bank account collisions", async () => {
  const { book, account } = await setup();
  const base = Schema.decodeUnknownSync(Processor.RegisterAccount)(account);
  const seedBank = await database();

  try {
    await seedBank.query(
      "insert into openerp.bank_sources(book_id,account_id,source_bank_account_id) values ($1,'account_fee','synthetic_second_bank')",
      [book.bookId],
    );
  } finally {
    await seedBank.end();
  }

  for (const feeCostAccountId of ["account_receivable", "account_bank"]) {
    const response = await request(book, "/banking/processors/accounts", {
      method: "POST",
      body: JSON.stringify({
        ...base,
        providerAccountId: `acct_collision_${crypto.randomUUID()}`,
        processorControlAccountId: "account_native_receivable",
        payoutTransitAccountId: "account_liability",
        disputeReceivableAccountId: "account_revenue",
        feeCostAccountId,
        bankAccountId: feeCostAccountId === "account_bank" ? "account_fee" : "account_bank",
      }),
    });

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("InvalidJournal");
  }

  const admin = await database();

  try {
    const retained = await admin.query<{ accounts: string }>(
      "select count(*)::text accounts from openerp.processor_accounts where book_id=$1",
      [book.bookId],
    );

    expect(retained.rows).toEqual([{ accounts: "1" }]);
  } finally {
    await admin.end();
  }

  await saveEvidence("processor-reserved-account-registration", book);
});

test("processor nonsettlement evidence cannot override an independently admitted payout receipt", async () => {
  const { book, reviewer, source, account, invoice } = await setup();

  const failed = {
    ...payout(),
    id: "txn_payout_failure",
    sourceId: "payout_failure",
    type: "payout_failure",
    grossMinor: "122000",
    netMinor: "122000",
    occurredOn: "2026-01-19",
    availableOn: "2026-01-19",
  };

  await seed(account, [charge(), payout(), failed], "122000");
  const fetched = await fetchObservations(book, account.id);
  const [chargeRow, payoutRow, failureRow] = fetched.observations;

  if (!chargeRow || !payoutRow || !failureRow)
    throw new Error("Payout failure manifest is incomplete");
  await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: chargeRow.id,
    invoiceId: invoice.id,
  });
  await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: payoutRow.id,
  });
  const imported = await emptyStatement(book, source.id, "2026-01-19");

  const proof = await post(
    book,
    "/evidence",
    {
      title: "Qualified synthetic payout did not settle",
      mediaType: "application/json",
      origin: source.id,
      content: JSON.stringify({
        kind: "synthetic_processor_nonsettlement_v1",
        providerAccountId: account.providerAccountId,
        providerPayoutId: "po_122000",
        failureBalanceTransactionId: failed.id,
        bankAccountId: "account_bank",
        startsOn: "2026-01-01",
        endsOn: "2026-01-19",
        cashDidNotSettle: true,
        statementId: imported.statement.id,
      }),
    },
    Accounting.Evidence,
  );

  const input = {
    ...reviewBasis(account.id, source.id),
    date: "2026-01-21",
    kind: "payout_failure" as const,
    payoutObservationId: payoutRow.id,
    failureObservationId: failureRow.id,
    nonSettlementEvidenceId: proof.id,
  };

  await statement(book, source.id, { startsOn: "2026-01-20", receivedOn: "2026-01-20" });

  const denied = await request(book, "/banking/processors/reviews", {
    method: "POST",
    body: JSON.stringify(input),
  });

  expect(denied.status).toBe(422);
  expect((await denied.json()).code).toBe("InvalidJournal");
  const admin = await database();

  try {
    const effects = await admin.query<{ failures: string; movements: string }>(
      "select count(*) filter(where kind='failure')::text failures,count(*) filter(where kind='movement')::text movements from openerp.processor_payout_effects where book_id=$1",
      [book.bookId],
    );

    expect(effects.rows).toEqual([{ failures: "0", movements: "1" }]);
  } finally {
    await admin.end();
  }

  await saveEvidence("processor-payout-bank-counterevidence", book);
});

test("generic journals cannot consume the registered processor dispute receivable", async () => {
  const { book, reviewer, source } = await setup();

  const generic = await post(
    book,
    "/change-sets",
    {
      ...journal(source.id, "7000"),
      lines: [
        {
          accountId: "account_dispute",
          debitMinor: "7000",
          creditMinor: "0",
          description: "Unowned dispute control",
        },
        {
          accountId: "account_clearing",
          debitMinor: "0",
          creditMinor: "7000",
          description: "Unowned counterline",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const response = await request(reviewer, `/change-sets/${generic.id}/approvals`, {
    method: "POST",
    body: JSON.stringify({ version: generic.version, planDigest: generic.planDigest }),
  });

  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("ApprovalRequired");
  const admin = await database();

  try {
    const totals = await admin.query<{ dispute: string; accounts: string }>(
      "select (select coalesce(sum(debit_minor-credit_minor),0)::text from openerp.journal_lines where book_id=$1 and account_id='account_dispute') dispute,(select count(*)::text from openerp.processor_accounts where book_id=$1) accounts",
      [book.bookId],
    );

    expect(totals.rows).toEqual([{ dispute: "0", accounts: "1" }]);
  } finally {
    await admin.end();
  }

  await saveEvidence("processor-generic-dispute-control-refusal", book);
});

test("native processor payout cannot consume a carrying basis from a later posting", async () => {
  const { book, reviewer, source, account } = await setup("EUR", { processorMinor: "10000" });

  const fee = {
    ...charge("txn_later_fee"),
    type: "fee_only",
    currency: "EUR",
    grossMinor: "-100",
    feeMinor: "0",
    netMinor: "-100",
    occurredOn: "2026-01-19",
    availableOn: "2026-01-19",
  };

  const outgoing = { ...payout(), currency: "EUR", grossMinor: "-500", netMinor: "-500" };
  await seed(account, [outgoing, fee], "400", { openingMinor: "1000" });
  const fetched = await fetchObservations(book, account.id);
  const feeRow = fetched.observations.find((row) => row.balanceTransactionId === fee.id);
  const payoutRow = fetched.observations.find((row) => row.balanceTransactionId === outgoing.id);

  if (!feeRow || !payoutRow) throw new Error("Chronology needs both retained events");

  const applied = await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    date: "2026-01-20",
    kind: "observation",
    observationId: feeRow.id,
  });

  expect(
    applied.review.journal.map((line) => [line.accountId, line.debitMinor, line.creditMinor]),
  ).toEqual([
    ["account_fee", "1000", "0"],
    ["account_processor", "0", "1000"],
  ]);

  const denied = await request(book, "/banking/processors/reviews", {
    method: "POST",
    body: JSON.stringify({
      ...reviewBasis(account.id, source.id),
      kind: "observation",
      observationId: payoutRow.id,
    }),
  });

  expect(denied.status).toBe(409);
  expect((await denied.json()).code).toBe("StaleDependency");
  const admin = await database();

  try {
    const effects = await admin.query<{ cash: string; movements: string }>(
      "select (select sum(native_delta_minor)::text from openerp.processor_cash_effects where book_id=$1) cash,(select count(*)::text from openerp.processor_payout_effects where book_id=$1) movements",
      [book.bookId],
    );

    expect(effects.rows).toEqual([{ cash: "-100", movements: "0" }]);
  } finally {
    await admin.end();
  }

  await saveEvidence("processor-native-custody-chronology", book);
});

test("expired processor approval and revoked human authority cannot execute then restored authority succeeds", async () => {
  const { book, reviewer, source, account, invoice } = await setup();
  await seed(account, [charge()], "122000");
  const fetched = await fetchObservations(book, account.id);
  const row = fetched.observations[0];

  if (!row) throw new Error("Approval admission needs a retained charge");

  const review = await post(
    book,
    "/banking/processors/reviews",
    {
      ...reviewBasis(account.id, source.id),
      kind: "observation",
      observationId: row.id,
      invoiceId: invoice.id,
    },
    Processor.Review,
  );

  const approval = await post(
    reviewer,
    `/banking/processors/reviews/${review.id}/approvals`,
    { version: 1, digest: review.digest },
    Processor.Approval,
  );

  const expired = Schema.decodeUnknownSync(Processor.Approval)({
    ...approval,
    id: `synthetic_expired_${crypto.randomUUID()}`,
    expiresAt: "2000-01-01T00:00:00.000Z",
  });

  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.processor_approvals(book_id,id,review_id,actor_id,digest,expires_at,body) values ($1,$2,$3,$4,$5,$6,$7::jsonb)",
      [
        book.bookId,
        expired.id,
        review.id,
        expired.actorId,
        expired.digest,
        expired.expiresAt,
        JSON.stringify(expired),
      ],
    );

    const expiredRequest = await request(book, `/banking/processors/reviews/${review.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: review.digest, approvalId: expired.id }),
    });

    expect(expiredRequest.status).toBe(403);
    expect((await expiredRequest.json()).code).toBe("ApprovalRequired");
    await admin.query(
      "update openerp.memberships set role='agent' where book_id=$1 and actor_id=$2",
      [book.bookId, reviewer.actorId],
    );

    const revoked = await request(book, `/banking/processors/reviews/${review.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: review.digest, approvalId: approval.id }),
    });

    expect(revoked.status).toBe(403);
    expect((await revoked.json()).code).toBe("ApprovalRequired");

    const absent = await admin.query<{
      executions: string;
      allocations: string;
      consumptions: string;
    }>(
      "select (select count(*)::text from openerp.processor_executions where book_id=$1) executions,(select count(*)::text from openerp.commerce_allocation_receipts where book_id=$1) allocations,(select count(*)::text from openerp.approval_consumptions where book_id=$1 and approval_id=$2) consumptions",
      [book.bookId, approval.id],
    );

    expect(absent.rows).toEqual([{ executions: "0", allocations: "0", consumptions: "0" }]);
  } finally {
    await admin.query(
      "update openerp.memberships set role='operator' where book_id=$1 and actor_id=$2",
      [book.bookId, reviewer.actorId],
    );
    await admin.end();
  }

  const executed = await post(
    book,
    `/banking/processors/reviews/${review.id}/execute`,
    { version: 1, digest: review.digest, approvalId: approval.id },
    Processor.Execution,
  );

  expect(executed.reviewId).toBe(review.id);

  const settled = await decoded(
    await request(book, `/commerce/invoices/${invoice.id}`),
    Commerce.Invoice,
  );

  expect(settled.outstandingMinor).toBe("0");
  await saveEvidence("processor-expired-revoked-human-approval", book);
});

test("processor payout read retains both steps and a returned review cannot approve or spend transit", async () => {
  const { book, reviewer, source, invoice, account } = await setup();
  await seed(account, [charge(), payout()]);
  const fetched = await fetchObservations(book, account.id);
  const chargeObservation = fetched.observations.find((item) => item.type === "charge");
  const payoutObservation = fetched.observations.find((item) => item.type === "payout");

  if (!chargeObservation || !payoutObservation) throw new Error("Missing synthetic observations");
  await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: chargeObservation.id,
    invoiceId: invoice.id,
  });

  const paid = await commit(book, reviewer, {
    ...reviewBasis(account.id, source.id),
    kind: "observation",
    observationId: payoutObservation.id,
  });

  const imported = await statement(book, source.id);

  const input: typeof Processor.Prepare.Type = {
    ...reviewBasis(account.id, source.id),
    date: "2026-01-18",
    kind: "bank_receipt",
    payoutObservationId: payoutObservation.id,
    bankObservation: { statementId: imported.statement.id, rowOrdinal: 1 },
  };

  const review = await post(book, "/banking/processors/reviews", input, Processor.Review);
  const base = `/banking/processors/reviews/${review.id}`;
  const missing = await request(book, `${base}/payout`);
  expect(missing.status).toBe(422);
  expect((await missing.json()).code).toBe("MissingEvidence");
  await fetchObservations(book, account.id, "automatic_payout");
  const view = await decoded(await request(book, `${base}/payout`), Processor.PayoutReviewView);
  expect(view.postedPayout.execution.voucherId).toBe(paid.execution.voucherId);
  expect(view.members.map((item) => [item.observation.id, item.invoiceDocumentNumber])).toEqual([
    [chargeObservation.id, "PROCESSOR-125000"],
  ]);
  expect([view.processorLedgerMinor, view.transitLedgerMinor, view.payoutNativeMinor]).toEqual([
    "0",
    "122000",
    "122000",
  ]);
  expect(view.bankAvailable).toBe(true);

  const candidates = await decoded(
    await request(book, `${base}/bank-candidates`),
    Processor.BankCandidatePage,
  );

  expect(
    candidates.items.map((item) => [item.row.statementId, item.row.rowOrdinal, item.available]),
  ).toEqual([[imported.statement.id, 1, true]]);
  expect((await request(book, `${base}/bank-candidates?afterRowOrdinal=1`)).status).toBe(422);

  const directory = await decoded(
    await request(book, "/banking/processors/accounts"),
    Processor.AccountPage,
  );

  expect(directory.items.map((item) => item.id)).toEqual([account.id]);

  const reviews = await decoded(
    await request(book, `/banking/processors/accounts/${account.id}/reviews`),
    Processor.ReviewPage,
  );

  expect(reviews.items.map((item) => item.id)).toContain(review.id);
  const outsider = await fixture();
  expect((await request(outsider, `${base}/payout`)).status).toBe(404);
  expect((await request(outsider, `/banking/processors/accounts?after=${account.id}`)).status).toBe(
    404,
  );

  const forbidden = await request(book, `${base}/approvals`, {
    method: "POST",
    body: JSON.stringify({ version: 1, digest: review.digest }),
  });

  expect(forbidden.status).toBe(403);

  const approval = await post(
    reviewer,
    `${base}/approvals`,
    { version: 1, digest: review.digest },
    Processor.Approval,
  );

  const returned = await post(
    reviewer,
    `${base}/returns`,
    { version: 1, digest: review.digest },
    Processor.ReviewReturn,
  );

  const repeatReturn = await post(
    reviewer,
    `${base}/returns`,
    { version: 1, digest: review.digest },
    Processor.ReviewReturn,
  );

  expect(repeatReturn.id).toBe(returned.id);

  const rejectedApproval = await request(reviewer, `${base}/approvals`, {
    method: "POST",
    body: JSON.stringify({ version: 1, digest: review.digest }),
  });

  expect((await rejectedApproval.json()).code).toBe("StaleDependency");

  const rejectedExecution = await request(book, `${base}/execute`, {
    method: "POST",
    body: JSON.stringify({ version: 1, digest: review.digest, approvalId: approval.id }),
  });

  expect((await rejectedExecution.json()).code).toBe("StaleDependency");
  const reloaded = await decoded(await request(book, `${base}/payout`), Processor.PayoutReviewView);
  expect(reloaded.returned?.id).toBe(returned.id);
  expect(reloaded.execution).toBeNull();
  expect([reloaded.transitLedgerMinor, reloaded.payoutNativeMinor, reloaded.bankAvailable]).toEqual(
    ["122000", "122000", true],
  );
  const fresh = await post(book, "/banking/processors/reviews", input, Processor.Review);
  expect(fresh.id).not.toBe(review.id);

  const oldApproval = await request(book, `/banking/processors/reviews/${fresh.id}/execute`, {
    method: "POST",
    body: JSON.stringify({ version: 1, digest: fresh.digest, approvalId: approval.id }),
  });

  expect((await oldApproval.json()).code).toBe("ApprovalRequired");

  const freshApproval = await post(
    reviewer,
    `/banking/processors/reviews/${fresh.id}/approvals`,
    { version: 1, digest: fresh.digest },
    Processor.Approval,
  );

  const executed = await post(
    book,
    `/banking/processors/reviews/${fresh.id}/execute`,
    { version: 1, digest: fresh.digest, approvalId: freshApproval.id },
    Processor.Execution,
  );

  const final = await decoded(
    await request(book, `/banking/processors/reviews/${fresh.id}/payout`),
    Processor.PayoutReviewView,
  );

  expect(final.execution?.voucherId).toBe(executed.voucherId);
  expect(final.postedPayout.execution.voucherId).toBe(paid.execution.voucherId);
  expect([
    final.processorLedgerMinor,
    final.transitLedgerMinor,
    final.payoutNativeMinor,
    final.bankAvailable,
  ]).toEqual(["0", "0", "0", false]);

  const afterPostReturn = await request(
    reviewer,
    `/banking/processors/reviews/${fresh.id}/returns`,
    { method: "POST", body: JSON.stringify({ version: 1, digest: fresh.digest }) },
  );

  expect((await afterPostReturn.json()).code).toBe("AlreadyPosted");
  await saveEvidence("processor-two-step-return-and-fresh-human-match", book);
});
