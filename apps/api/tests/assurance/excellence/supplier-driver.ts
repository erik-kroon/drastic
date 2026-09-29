import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { expect } from "vitest";
import * as A from "@open-erp/contracts/accounting";
import * as C from "@open-erp/contracts/commerce";
import * as D from "@open-erp/contracts/supplier-invoice-drafts";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Refunds from "@open-erp/contracts/supplier-refunds";
import {
  createSession,
  database,
  decoded,
  environment,
  execute,
  failure,
  fixture,
  key,
  post,
  request,
  type BookFixture,
} from "../../support/fixtures";
import {
  assertExactRows,
  balances,
  position,
  type Event,
  type State,
  type Specification,
} from "../../../../../verification/assurance/excellence/models/supplier.mjs";

const accounts = [
  { id: "account_payable", code: "2440", name: "Synthetic supplier liability" },
  { id: "account_input_vat", code: "2641", name: "Synthetic input VAT" },
  { id: "account_expense", code: "6000", name: "Synthetic expense" },
  { id: "account_refund_receivable", code: "1510", name: "Synthetic refund asset" },
];

export interface Replay {
  eventId: string;
  path: string;
  key: string;
  body: string;
  response: unknown;
}

export interface World {
  book: BookFixture;
  invoiceId: string;
  acceptance: typeof Acceptance.SupplierAcceptanceReceipt.Type;
  replays: Replay[];
  voucherIds: string[];
  observations: unknown[];
  creditInputs: unknown[];
}

async function evidence(book: BookFixture, label: string) {
  return post(
    book,
    "/evidence",
    {
      title: `EXC synthetic ${label}`,
      content: `Synthetic fixture ${label} ${key()}`,
      mediaType: "text/plain",
      origin: "excellent-test-only",
    },
    A.Evidence,
  );
}

async function commit<
  S extends Schema.Top & {
    readonly DecodingServices: never;
  },
>(w: World, eventId: string, path: string, input: unknown, schema: S) {
  const requestKey = key(),
    body = JSON.stringify(input);

  const value = await decoded(
    await request(w.book, path, {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body,
    }),
    schema,
  );

  w.replays.push({ eventId, path, key: requestKey, body, response: value });

  return value;
}

export async function createPurchase(spec: Specification): Promise<World> {
  const base = await fixture(accounts);
  const book = { ...base, token: (await createSession(base)).token };

  const N = BigInt(spec.netMinor ?? "100000"),
    T = N / 4n;

  const source = await evidence(book, "purchase-original");

  const supplier = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "supplier",
      displayName: "Synthetic sequence supplier",
      evidenceId: source.id,
      reason: "Independent stateful test",
    },
    C.CounterpartyRevision,
  );

  const identity = {
    legalName: "Synthetic AB",
    registrationId: "5560000001",
    taxId: null,
    address: "Synthetic road1",
    countryCode: "SE",
    evidenceId: source.id,
  };

  const draft = await post(
    book,
    "/commerce/supplier-invoice-drafts",
    {
      draftKey: `sequence_${key()}`,
      content: {
        title: "Stateful synthetic purchase",
        counterpartyId: supplier.id,
        counterpartyRevision: supplier.revision,
        supplier: identity,
        buyer: identity,
        sourceEvidenceId: source.id,
        supplierDocumentNumber: `SEQ-${key()}`,
        currency: "SEK",
        currencyScale: 2,
        documentDate: "2026-09-01",
        supplyDate: "2026-09-01",
        dueDate: "2026-10-01",
        paymentTerms: "30days",
        sourceTotalMinor: String(N + T),
        lines: [
          {
            id: "line_purchase",
            description: "Synthetic service",
            quantity: "1",
            unitPriceMinor: String(N),
            baseMinor: String(N),
            discountMinor: "0",
            chargeMinor: "0",
            taxMinor: String(T),
            taxDescription: "Synthetic quarter rate",
            taxEvidenceId: source.id,
            sourceGrossMinor: String(N + T),
          },
        ],
      },
    },
    D.SupplierInvoiceDraftRevision,
  );

  const review = await post(
    book,
    "/commerce/supplier-acceptance-reviews",
    {
      profile: "swedish-purchase-v1",
      draftId: draft.id,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      controlAccountId: "account_payable",
      accountingPeriodId: "period_2026",
      series: "A",
      reason: "Synthetic source-driven recognition",
      acknowledgeSyntheticOnly: true,
      taxPoint: { taxPointOn: "2026-09-01", basis: "document_date" },
      lineAssignments: [
        {
          lineId: "line_purchase",
          expenseAccountId: "account_expense",
          treatment: {
            basis: spec.deductionDenominator === "2" ? "half_deduction" : "full_deduction",
            rate: { numerator: "1", denominator: "4" },
            deduction: { numerator: "1", denominator: spec.deductionDenominator ?? "1" },
            invoiceTaxRounding: "half_up",
            deductionRounding: "half_up",
            acceptancePolicy: "exact_match",
            toleranceMinor: "0",
          },
        },
      ],
    },
    Acceptance.SupplierAcceptanceReview,
  );

  const input = { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true };

  const approval = await post(
    book,
    `/commerce/supplier-acceptance-reviews/${review.id}/approvals`,
    input,
    Acceptance.SupplierAcceptanceApproval,
  );

  const requestKey = key(),
    path = `/commerce/supplier-acceptance-reviews/${review.id}/execute`,
    body = JSON.stringify({ ...input, approvalId: approval.id });

  const acceptance = await decoded(
    await request(book, path, { method: "POST", headers: { "idempotency-key": requestKey }, body }),
    Acceptance.SupplierAcceptanceReceipt,
  );

  return {
    book,
    invoiceId: acceptance.registerInvoiceId,
    acceptance,
    replays: [{ eventId: "source-purchase", key: requestKey, path, body, response: acceptance }],
    voucherIds: [acceptance.postingReceipt.voucherId],
    observations: [],
    creditInputs: [],
  };
}

export async function current(w: World) {
  return {
    invoice: await decoded(await request(w.book, `/commerce/invoices/${w.invoiceId}`), C.Invoice),
    position: await decoded(
      await request(w.book, `/commerce/invoices/${w.invoiceId}/supplier-refund-position`),
      Refunds.SupplierRefundPosition,
    ),
  };
}

export async function applyEvent(
  w: World,
  event: Exclude<
    Event,
    {
      kind: "recognize";
    }
  >,
  before: State,
) {
  const { book } = w;

  if (event.kind === "pay") {
    const source = await evidence(book, event.id);

    const plan = await post(
      book,
      "/change-sets",
      {
        kind: "manual_journal",
        evidenceId: source.id,
        eventKey: event.id,
        accountingPeriodId: "period_2026",
        postingDate: "2026-09-02",
        series: "A",
        description: "Synthetic recorded cash payment",
        rationale: "Adopt the exact retained payment line, not a provider acceptance claim",
        taxAssessment: "not_applicable",
        lines: [
          {
            accountId: "account_payable",
            debitMinor: event.amountMinor,
            creditMinor: "0",
            description: "AP discharge evidence",
          },
          {
            accountId: "account_bank",
            debitMinor: "0",
            creditMinor: event.amountMinor,
            description: "Synthetic cash movement",
          },
        ],
      },
      A.ChangeSet,
    );

    const receipt = await execute(book, plan);
    w.voucherIds.push(receipt.voucherId);
    const line = plan.groups[0]?.actions[0]?.lines.find((x) => x.accountId === "account_payable");

    if (!line) throw Error("Missing synthetic payment line");
    // This source posting and its later allocation are intentionally TWO public operations.
    // No claim of atomically creating external bank evidence and allocating it is made.
    const original = await current(w);
    expect(original.invoice.outstandingMinor).toBe(position(before).unpaid);
    const proof = await evidence(book, event.id + "-allocation");

    const allocation = await post(
      book,
      "/commerce/allocation-plans",
      {
        voucherId: receipt.voucherId,
        lineId: line.lineId,
        evidenceId: proof.id,
        rationale: "Allocate actual retained test payment",
        allocations: [{ invoiceId: w.invoiceId, amountMinor: event.amountMinor }],
      },
      C.AllocationPlan,
    );

    const approval = await post(
      book,
      `/commerce/allocation-plans/${allocation.id}/approvals`,
      { version: 1, planDigest: allocation.digest },
      C.AllocationApproval,
    );

    await commit(
      w,
      event.id,
      `/commerce/allocation-plans/${allocation.id}/apply`,
      { version: 1, planDigest: allocation.digest, approvalId: approval.id },
      C.AllocationReceipt,
    );
  } else if (event.kind === "credit") {
    const c = await current(w),
      p = position(before),
      source = await evidence(book, event.id),
      net = BigInt(event.netMinor),
      tax = net / 4n;

    const input = {
      profile: "swedish-purchase-partial-credit-v1",
      invoiceId: w.invoiceId,
      acceptanceDigest: w.acceptance.digest,
      expectedInvoiceRevision: c.invoice.currentRevision.revision,
      expectedAllocationVersion: c.invoice.allocationVersion,
      expectedPosition: {
        originalGrossMinor: p.gross,
        creditedMinor: p.credited,
        paidMinor: p.paid,
        refundedMinor: p.refunded,
      },
      creditEvidenceId: source.id,
      supplierCreditNumber: event.id,
      amountMinor: String(net + tax),
      creditLines: [
        { lineId: "line_purchase", netMinor: String(net), sourceTaxMinor: String(tax) },
      ],
      creditDate: "2026-09-03",
      accountingPeriodId: "period_2026",
      series: "A",
      reason: "Synthetic credit sequence",
      refundReceivableAccountId: "account_refund_receivable",
      acknowledgePaidCredit: true,
    };

    w.creditInputs.push(input);

    const review = await post(
      book,
      "/commerce/paid-supplier-credit-reviews",
      input,
      Refunds.PaidSupplierCreditReview,
    );

    const approval = await post(
      book,
      `/commerce/paid-supplier-credit-reviews/${review.id}/approvals`,
      { digest: review.digest, acknowledgePaidCredit: true },
      Refunds.PaidSupplierCreditApproval,
    );

    const result = await commit(
      w,
      event.id,
      `/commerce/paid-supplier-credit-reviews/${review.id}/execute`,
      { digest: review.digest, approvalId: approval.id, acknowledgePaidCredit: true },
      Refunds.PaidSupplierCreditReceipt,
    );

    w.voucherIds.push(result.postingReceipt.voucherId);
  } else {
    const prepared = await prepareRefund(w, event.amountMinor, event.id, before);

    const result = await commit(
      w,
      event.id,
      prepared.path,
      prepared.input,
      Refunds.SupplierRefundReceipt,
    );

    if (!result.voucherId) throw Error("New synthetic cash refund must own a voucher");
    w.voucherIds.push(result.voucherId);
  }
}

export async function prepareRefund(w: World, amount: string, label: string, before: State) {
  const c = await current(w),
    p = position(before),
    source = await evidence(w.book, label);

  const review = await post(
    w.book,
    "/commerce/supplier-refund-reviews",
    {
      invoiceId: w.invoiceId,
      expectedInvoiceRevision: c.invoice.currentRevision.revision,
      expectedAllocationVersion: c.invoice.allocationVersion,
      expectedRefundDueMinor: p.refundDue,
      expectedRefundedMinor: p.refunded,
      refundDate: "2026-09-04",
      accountingPeriodId: "period_2026",
      series: "A",
      reason: "Synthetic refund sequence",
      refundReceivableAccountId: "account_refund_receivable",
      refundEvidenceId: source.id,
      amountMinor: amount,
      allocations: [{ allocationId: label, amountMinor: amount }],
      source: { kind: "unposted_cash", bankAccountId: "account_bank", evidenceId: source.id },
    },
    Refunds.SupplierRefundReview,
  );

  const approval = await post(
    w.book,
    `/commerce/supplier-refund-reviews/${review.id}/approvals`,
    { digest: review.digest },
    Refunds.SupplierRefundApproval,
  );

  return {
    path: `/commerce/supplier-refund-reviews/${review.id}/execute`,
    input: { digest: review.digest, approvalId: approval.id },
  };
}

export async function replay(w: World, index: number) {
  const cmd = w.replays[index];

  if (!cmd) throw Error("Replay target absent");

  const response = await request(w.book, cmd.path, {
    method: "POST",
    headers: { "idempotency-key": cmd.key },
    body: cmd.body,
  });

  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toEqual(cmd.response);
}

export async function assertState(w: World, expected: State) {
  const c = await current(w),
    p = position(expected);

  expect(c.invoice.outstandingMinor).toBe(p.unpaid);
  expect(c.invoice.creditedMinor).toBe(p.credited);
  expect(c.invoice.blockers).toEqual([]);
  expect(c.position).toMatchObject({
    originalGrossMinor: p.gross,
    creditedMinor: p.credited,
    paidMinor: p.paid,
    refundedMinor: p.refunded,
    unpaidMinor: p.unpaid,
    refundPrincipalMinor: p.refundPrincipal,
    refundDueMinor: p.refundDue,
  });
  const db = await database();

  try {
    const journal = await db.query<{
      voucher_id: string;
      account_id: string;
      debit: string;
      credit: string;
    }>(
      `SELECT voucher_id,account_id,debit_minor::text AS debit,credit_minor::text AS credit FROM openerp.journal_lines WHERE book_id=$1 ORDER BY voucher_id,ordinal`,
      [w.book.bookId],
    );

    expect([...new Set(journal.rows.map((x) => x.voucher_id))].sort()).toEqual(
      [...w.voucherIds].sort(),
    );
    expect(w.voucherIds.length).toBe(expected.effects.length);

    for (let i = 0; i < expected.effects.length; i++) {
      const rows = journal.rows.filter((x) => x.voucher_id === w.voucherIds[i]);

      for (const x of rows)
        expect(
          (BigInt(x.debit) > 0n && x.credit === "0") || (BigInt(x.credit) > 0n && x.debit === "0"),
        ).toBe(true);
      assertExactRows(
        rows.map((x) => ({
          accountId: x.account_id,
          signedMinor: String(BigInt(x.debit) - BigInt(x.credit)),
        })),
        expected.effects[i]!.rows,
      );
    }

    const totals: Record<string, string> = { ...balances(expected) };

    for (const k of Object.keys(totals)) totals[k] = "0";

    for (const x of journal.rows)
      totals[x.account_id] = String(
        BigInt(totals[x.account_id] ?? "0") + BigInt(x.debit) - BigInt(x.credit),
      );
    expect(totals).toEqual(balances(expected));

    const tax = await db.query<{
      base: string;
      deduction: string;
      count: number;
      broken: number;
    }>(
      `SELECT coalesce(sum(signed_base_minor),0)::text AS base,coalesce(sum(signed_deductible_tax_minor),0)::text AS deduction,count(*)::int AS count,count(*) FILTER(WHERE adjusts_tax_fact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM openerp.purchase_tax_facts o WHERE o.book_id=f.book_id AND o.id=f.adjusts_tax_fact_id))::int AS broken FROM openerp.purchase_tax_facts f WHERE book_id=$1`,
      [w.book.bookId],
    );

    expect(tax.rows[0]).toEqual({
      base: String(expected.N - expected.creditNet),
      deduction: String(expected.D - expected.releasedDeduction),
      count: 1 + expected.effects.filter((e) => e.kind === "credit").length,
      broken: 0,
    });

    const cap = await db.query<{
      net: string;
      tax: string;
      deduction: string;
    }>(
      `SELECT credited_net_minor::text AS net,credited_source_tax_minor::text AS tax,released_deduction_minor::text AS deduction FROM openerp.purchase_line_capacities WHERE book_id=$1 AND recognition_id=$2`,
      [w.book.bookId, w.acceptance.recognitionId],
    );

    expect(cap.rows).toEqual([
      {
        net: String(expected.creditNet),
        tax: String(expected.creditTax),
        deduction: String(expected.releasedDeduction),
      },
    ]);
    w.observations.push({
      position: p,
      totals,
      tax: tax.rows[0],
      effects: expected.effects.length,
    });
  } finally {
    await db.end();
  }
}

export async function saveTrace(name: string, data: unknown) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw Error("Unsafe trace name");
  await writeFile(
    join(environment().artifacts, `excellence-${name}.json`),
    JSON.stringify(data, null, 2),
    { mode: 0o600 },
  );
}

export async function refuseExcessRefund(w: World, before: State) {
  const c = await current(w),
    p = position(before),
    source = await evidence(w.book, "over-refund");

  const x = String(BigInt(p.refundDue) + 1n);

  const result = await request(w.book, "/commerce/supplier-refund-reviews", {
    method: "POST",
    body: JSON.stringify({
      invoiceId: w.invoiceId,
      expectedInvoiceRevision: c.invoice.currentRevision.revision,
      expectedAllocationVersion: c.invoice.allocationVersion,
      expectedRefundDueMinor: p.refundDue,
      expectedRefundedMinor: p.refunded,
      refundDate: "2026-09-04",
      accountingPeriodId: "period_2026",
      series: "A",
      reason: "Intentional excess synthetic refund",
      refundReceivableAccountId: "account_refund_receivable",
      refundEvidenceId: source.id,
      amountMinor: x,
      allocations: [{ allocationId: "excess", amountMinor: x }],
      source: { kind: "unposted_cash", bankAccountId: "account_bank", evidenceId: source.id },
    }),
  });

  await failure(result, 409, "StaleDependency");
}
