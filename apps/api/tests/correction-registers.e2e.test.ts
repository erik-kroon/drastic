import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Corrections from "@open-erp/contracts/corrections";
import * as Reports from "@open-erp/contracts/register-reports";
import { expect, test } from "vitest";
import {
  database,
  decoded,
  evidence,
  execute,
  failure,
  fixture,
  journal,
  key,
  persisted,
  post,
  request,
} from "./support/fixtures";
import { injectScopedInsertFault, saveSanitizedJourney } from "./assurance/database-support";
import { supplierFixture, createDraft, acceptDraft } from "./support/supplier-review";

async function setup() {
  const book = await fixture([
    { id: "account_expense", code: "6550", name: "Synthetic services" },
    { id: "account_replacement", code: "4010", name: "Synthetic purchases" },
    { id: "account_vat", code: "2641", name: "Synthetic input VAT" },
  ]);

  const source = await evidence(book);

  const party = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "supplier",
      displayName: "Synthetic invoice 1048 supplier",
      evidenceId: source.id,
      reason: "Independent correction oracle",
    },
    Commerce.CounterpartyRevision,
  );

  const originalLines = [
    {
      accountId: "account_expense",
      debitMinor: "10000",
      creditMinor: "0",
      description: "Original expense",
    },
    {
      accountId: "account_vat",
      debitMinor: "2500",
      creditMinor: "0",
      description: "Unchanged input VAT",
    },
    {
      accountId: "account_clearing",
      debitMinor: "0",
      creditMinor: "12500",
      description: "Unchanged payable",
    },
  ];

  const plan = await post(
    book,
    "/change-sets",
    { ...journal(source.id), postingDate: "2026-09-30", lines: originalLines },
    Accounting.ChangeSet,
  );

  const original = await execute(book, plan);

  const control = plan.groups[0]?.actions[0]?.lines.find(
    (line) => line.accountId === "account_clearing",
  );

  if (!control) throw new Error("Missing original payable");

  const invoice = await post(
    book,
    "/commerce/invoices",
    {
      kind: "synthetic_invoice_v1",
      direction: "supplier",
      counterpartyId: party.id,
      counterpartyRevision: party.revision,
      documentNumber: "1048",
      issuedOn: "2026-09-30",
      dueOn: "2026-10-30",
      currency: "SEK",
      amountMinor: "12500",
      controlAccountId: "account_clearing",
      recognitionVoucherId: original.voucherId,
      recognitionLineId: control.lineId,
      evidenceId: source.id,
      description: "Retained supplier invoice 1048",
    },
    Commerce.Invoice,
  );

  const paymentSource = await evidence(book);

  const paymentPlan = await post(
    book,
    "/change-sets",
    {
      ...journal(paymentSource.id),
      postingDate: "2026-10-01",
      lines: [
        {
          accountId: "account_clearing",
          debitMinor: "5000",
          creditMinor: "0",
          description: "Partial supplier payment",
        },
        {
          accountId: "account_bank",
          debitMinor: "0",
          creditMinor: "5000",
          description: "Synthetic bank payment",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const payment = await execute(book, paymentPlan);

  const paymentLine = paymentPlan.groups[0]?.actions[0]?.lines.find(
    (line) => line.accountId === "account_clearing",
  );

  if (!paymentLine) throw new Error("Missing payment payable");

  const allocation = await post(
    book,
    "/commerce/allocation-plans",
    {
      voucherId: payment.voucherId,
      lineId: paymentLine.lineId,
      evidenceId: paymentSource.id,
      rationale: "Partial 5000 of retained 12500",
      allocations: [{ invoiceId: invoice.id, amountMinor: "5000" }],
    },
    Commerce.AllocationPlan,
  );

  const approval = await post(
    book,
    `/commerce/allocation-plans/${allocation.id}/approvals`,
    {
      version: 1,
      planDigest: allocation.digest,
    } satisfies typeof Commerce.ApproveAllocation.Type,
    Commerce.AllocationApproval,
  );

  await post(
    book,
    `/commerce/allocation-plans/${allocation.id}/apply`,
    {
      version: 1,
      planDigest: allocation.digest,
      approvalId: approval.id,
    } satisfies typeof Commerce.ApplyAllocation.Type,
    Commerce.AllocationReceipt,
  );

  const before = await decoded(
    await request(book, `/commerce/invoices/${invoice.id}`),
    Commerce.Invoice,
  );

  const paymentCapacityPath = `/commerce/payments/${payment.voucherId}/lines/${paymentLine.lineId}/capacity`;

  const paymentCapacity = await decoded(
    await request(book, paymentCapacityPath),
    Commerce.PaymentCapacity,
  );

  const intent = {
    datePolicy: "explicit_open_period" as const,
    accountingPeriodId: "period_2026",
    postingDate: "2026-10-04",
    rationale: "Reclassify expense, preserve invoice and VAT",
    replacement: {
      description: "Supplier expense correction",
      lines: originalLines.map((line) => ({
        ...line,
        accountId: line.accountId === "account_expense" ? "account_replacement" : line.accountId,
      })),
    },
  };

  return { book, original, invoice, before, intent, paymentCapacityPath, paymentCapacity };
}

async function prepare(context: Awaited<ReturnType<typeof setup>>) {
  const { book, original, intent } = context;

  const impact = await post(
    book,
    `/vouchers/${original.voucherId}/correction-impact-reviews`,
    intent,
    Corrections.CorrectionImpact,
  );

  expect(impact.basis.blockers).toEqual([]);

  const bundle = await post(
    book,
    `/vouchers/${original.voucherId}/correction-bundles`,
    {
      ...intent,
      impactReview: { id: impact.id, digest: impact.digest },
    },
    Corrections.CorrectionBundle,
  );

  const approval = await post(
    book,
    `/correction-bundles/${bundle.id}/approvals`,
    {
      version: 1,
      bundleDigest: bundle.bundleDigest,
    },
    Corrections.CorrectionBundleApproval,
  );

  return { bundle, approval };
}

test("invoice expense correction retains partial allocation and cutoff control, and exact replay commits once", async () => {
  const context = await setup();

  const september = await post(
    context.book,
    "/commerce/register-snapshots",
    { asOfDate: "2026-09-30" },
    Reports.RegisterReport,
  );

  const { bundle, approval } = await prepare(context);

  const input = { version: 1, bundleDigest: bundle.bundleDigest, approvalId: approval.id };

  const receipt = await post(
    context.book,
    `/correction-bundles/${bundle.id}/execute`,
    input,
    Corrections.CorrectionBundleReceipt,
  );

  const after = await decoded(
    await request(context.book, `/commerce/invoices/${context.invoice.id}`),
    Commerce.Invoice,
  );

  expect(after).toMatchObject({
    amountMinor: "12500",
    recordedAllocatedMinor: "5000",
    outstandingMinor: "7500",
    status: "partially_allocated",
    blockers: [],
  });

  expect(after.recognition).toEqual(context.before.recognition);

  expect(after.currentRevision).toEqual(context.before.currentRevision);

  expect(after.evidence).toEqual(context.before.evidence);

  expect(after.effectiveRecognition?.voucherId).toBe(receipt.replacement.voucherId);

  expect(after.recognitionHistory).toHaveLength(1);

  expect(
    await decoded(
      await request(context.book, context.paymentCapacityPath),
      Commerce.PaymentCapacity,
    ),
  ).toEqual(context.paymentCapacity);

  expect(context.paymentCapacity).toMatchObject({
    amountMinor: "5000",
    allocatedMinor: "5000",
    remainingMinor: "0",
  });

  for (const plan of [bundle.reversal, bundle.replacement]) {
    const control = plan.groups[0]?.actions[0]?.lines.find(
      (line) => line.accountId === "account_clearing",
    );

    if (!control) throw new Error("Missing retained correction payable line");

    const voucherId =
      plan.id === bundle.reversal.id ? receipt.reversal.voucherId : receipt.replacement.voucherId;

    await failure(
      await request(
        context.book,
        `/commerce/payments/${voucherId}/lines/${control.lineId}/capacity`,
      ),
      422,
      "InvalidJournal",
    );
  }

  const counts = await persisted(context.book);

  expect(
    await post(
      context.book,
      `/correction-bundles/${bundle.id}/execute`,
      input,
      Corrections.CorrectionBundleReceipt,
    ),
  ).toEqual(receipt);

  expect(await persisted(context.book)).toEqual(counts);

  expect(
    await decoded(
      await request(context.book, `/commerce/register-snapshots/${september.id}`),
      Reports.RegisterReport,
    ),
  ).toEqual(september);

  const october = await post(
    context.book,
    "/commerce/register-snapshots",
    { asOfDate: "2026-10-04" },
    Reports.RegisterReport,
  );

  expect(october.controls.every((control) => control.differenceMinor === "0")).toBe(true);

  expect(october.controls.every((control) => control.unexplainedLineCount === 0)).toBe(true);

  await saveSanitizedJourney("invoice-recognition-correction", {
    bundle,
    receipt,
    before: context.before,
    after,
    september,
    october,
    counts,
    paymentCapacity: context.paymentCapacity,
  });
});

test("late bundle receipt failure rolls back invoice recognition and both journals before retry", async () => {
  const context = await setup();

  const { bundle, approval } = await prepare(context);

  const before = await persisted(context.book);

  const removeFault = await injectScopedInsertFault(context.book, "correction_bundle_receipts");

  const commandKey = key();

  const init = {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify({
      version: 1,
      bundleDigest: bundle.bundleDigest,
      approvalId: approval.id,
    }),
  };

  try {
    await failure(
      await request(context.book, `/correction-bundles/${bundle.id}/execute`, init),
      500,
      "InternalError",
    );

    expect(await persisted(context.book)).toEqual(before);

    expect(
      await decoded(
        await request(context.book, `/commerce/invoices/${context.invoice.id}`),
        Commerce.Invoice,
      ),
    ).toEqual(context.before);
  } finally {
    await removeFault();
  }

  const receipt = await decoded(
    await request(context.book, `/correction-bundles/${bundle.id}/execute`, init),
    Corrections.CorrectionBundleReceipt,
  );

  expect(
    await decoded(
      await request(context.book, `/correction-bundles/${bundle.id}/execute`, init),
      Corrections.CorrectionBundleReceipt,
    ),
  ).toEqual(receipt);

  await saveSanitizedJourney("invoice-recognition-rollback", {
    before,
    after: await persisted(context.book),
    receipt,
  });
});

test("concurrent invoice alternatives retain one successor and tax/control changes are refused", async () => {
  const context = await setup();

  const invalid = {
    ...context.intent,
    replacement: {
      ...context.intent.replacement,
      lines: context.intent.replacement.lines.map((line) => ({
        ...line,
        debitMinor:
          new Map([
            ["account_vat", "2501"],
            ["account_replacement", "9999"],
          ]).get(line.accountId) ?? line.debitMinor,
      })),
    },
  };

  const review = await post(
    context.book,
    `/vouchers/${context.original.voucherId}/correction-impact-reviews`,
    invalid,
    Corrections.CorrectionImpact,
  );

  expect(review.basis.blockers.length).toBeGreaterThan(0);

  const first = await prepare(context),
    second = await prepare(context);

  const responses = await Promise.all(
    [first, second].map(({ bundle, approval }) =>
      request(context.book, `/correction-bundles/${bundle.id}/execute`, {
        method: "POST",
        body: JSON.stringify({
          version: 1,
          bundleDigest: bundle.bundleDigest,
          approvalId: approval.id,
        }),
      }),
    ),
  );

  expect(responses.filter((response) => response.status === 200)).toHaveLength(1);

  expect(responses.filter((response) => response.status !== 200)).toHaveLength(1);

  const after = await decoded(
    await request(context.book, `/commerce/invoices/${context.invoice.id}`),
    Commerce.Invoice,
  );

  expect(after.outstandingMinor).toBe("7500");

  await saveSanitizedJourney("invoice-recognition-race", {
    statuses: responses.map((response) => response.status),
    after,
  });
});

test("the native supplier acceptance source remains immutable while its exact invoice owner contributes correction", async () => {
  const context = await supplierFixture([
    { id: "account_expense", code: "6550", name: "Synthetic services" },
    { id: "account_replacement", code: "4010", name: "Synthetic purchases" },
  ]);

  const draft = await createDraft(context.book, context.content);

  const accepted = await acceptDraft(context.book, draft, "account_expense");

  const before = await decoded(
    await request(context.book, `/commerce/invoices/${accepted.registerInvoiceId}`),
    Commerce.Invoice,
  );

  const original = await decoded(
    await request(context.book, `/vouchers/${accepted.postingReceipt.voucherId}`),
    Accounting.Voucher,
  );

  const intent = {
    datePolicy: "explicit_open_period",
    accountingPeriodId: "period_2026",
    postingDate: "2026-10-04",
    rationale: "Expense-only correction retains supplier acceptance",
    replacement: {
      description: "Supplier expense reclassification",
      lines: original.action.lines.map((line) => ({
        accountId: line.accountId === "account_expense" ? "account_replacement" : line.accountId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        description: line.description,
        originalDimensions: line.originalDimensions ?? [],
      })),
    },
  };

  const impact = await post(
    context.book,
    `/vouchers/${original.id}/correction-impact-reviews`,
    intent,
    Corrections.CorrectionImpact,
  );

  expect(impact.basis.blockers).toEqual([]);

  expect(impact.basis.registerContribution).toMatchObject({
    sourceOwners: [{ kind: "supplier_acceptance", id: accepted.reviewId }],
  });

  const bundle = await post(
    context.book,
    `/vouchers/${original.id}/correction-bundles`,
    {
      ...intent,
      impactReview: { id: impact.id, digest: impact.digest },
    },
    Corrections.CorrectionBundle,
  );

  const approval = await post(
    context.book,
    `/correction-bundles/${bundle.id}/approvals`,
    {
      version: 1,
      bundleDigest: bundle.bundleDigest,
    },
    Corrections.CorrectionBundleApproval,
  );

  const receipt = await post(
    context.book,
    `/correction-bundles/${bundle.id}/execute`,
    {
      version: 1,
      bundleDigest: bundle.bundleDigest,
      approvalId: approval.id,
    },
    Corrections.CorrectionBundleReceipt,
  );

  const after = await decoded(
    await request(context.book, `/commerce/invoices/${accepted.registerInvoiceId}`),
    Commerce.Invoice,
  );

  expect(after).toMatchObject({
    amountMinor: "10000",
    outstandingMinor: "10000",
    blockers: [],
    status: "open",
  });

  expect(after.supplierAcceptanceDigest).toBe(before.supplierAcceptanceDigest);

  expect(after.recognition).toEqual(before.recognition);

  expect(after.currentRevision).toEqual(before.currentRevision);

  await saveSanitizedJourney("supplier-owned-recognition-correction", {
    accepted,
    bundle,
    receipt,
    before,
    after,
  });
});

test("runtime-role foreign-key-valid forged recognition owner and transition bindings are refused", async () => {
  const context = await setup();

  const { bundle, approval } = await prepare(context);

  const receipt = await post(
    context.book,
    `/correction-bundles/${bundle.id}/execute`,
    {
      version: 1,
      bundleDigest: bundle.bundleDigest,
      approvalId: approval.id,
    },
    Corrections.CorrectionBundleReceipt,
  );

  const admin = await database();

  try {
    await admin.query("set role openerp_runtime");

    await expect(
      admin.query(
        `insert into openerp.invoice_recognition_replacement_owners
      (book_id,bundle_id,invoice_id,predecessor_voucher_id,body)
      select book_id,bundle_id,invoice_id,$3,jsonb_set(body,'{predecessorVoucherId}',to_jsonb($3::text))
      from openerp.invoice_recognition_replacement_owners where book_id=$1 and bundle_id=$2`,
        [context.book.bookId, bundle.id, receipt.replacement.voucherId],
      ),
    ).rejects.toMatchObject({ code: "P0001" });

    await expect(
      admin.query(
        `insert into openerp.invoice_recognition_replacements
      (book_id,bundle_id,invoice_id,predecessor_voucher_id,reversal_voucher_id,replacement_voucher_id,reversal_line_id,replacement_line_id)
      select book_id,bundle_id,invoice_id,predecessor_voucher_id,reversal_voucher_id,predecessor_voucher_id,reversal_line_id,$3
      from openerp.invoice_recognition_replacements where book_id=$1 and bundle_id=$2`,
        [context.book.bookId, bundle.id, context.invoice.recognition?.lineId],
      ),
    ).rejects.toMatchObject({ code: "P0001" });
  } finally {
    await admin.query("reset role");

    await admin.end();
  }

  await saveSanitizedJourney("invoice-recognition-binding-guards", {
    bundleId: bundle.id,
    receipt,
    forgedOwner: "P0001",
    forgedTransition: "P0001",
  });
});
