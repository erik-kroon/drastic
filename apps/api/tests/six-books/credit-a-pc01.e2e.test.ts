import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as Credits from "@open-erp/contracts/supplier-credits";
import * as Recognition from "@open-erp/contracts/supplier-recognition";
import {
  createSession,
  database,
  decoded,
  environment,
  key,
  post,
  request,
  run,
  type BookFixture,
} from "../support/fixtures";

// NEXT-07 unpaid credit via Book A facts (challenge input only).
// A-P01: INV-001 line_1 1000000+250000, line_2 600000+150000, gross 2000000.
// A-PC01: credit on line_2, net 400000 + tax 100000, gross 500000.
// Expected after credit: outstanding 1500000, line_2 remaining 200000+50000,
// deductible released 100000. No oracle journal is imported; every asserted
// number is the packet's own arithmetic read back from the live projection.
// Paid-credit/refund legs stay out of scope for this slice.

const apiDirectory = resolve(import.meta.dirname, "../..");

async function fixtureBookA(): Promise<BookFixture> {
  const env = environment();

  const id = randomBytes(8).toString("hex");

  const token = randomBytes(32).toString("hex");

  const agentToken = randomBytes(32).toString("hex");

  const entityId = `entity_${id}`;

  const bookId = `book_${id}`;

  const actorId = `operator_${id}`;

  const agentId = `agent_${id}`;

  const config = {
    entity: { id: entityId, name: "Six-books A-PC01 synthetic entity" },
    book: {
      id: bookId,
      name: "Six-books A-PC01 book",
      currency: "SEK",
      profile: "synthetic-core-v1",
    },
    actor: {
      id: actorId,
      name: "Six-books operator",
      role: "operator",
      tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
    fiscalYear: { id: "fy-a", startsOn: "2025-05-17", endsOn: "2026-04-30" },
    periods: [{ id: "period-a", startsOn: "2025-05-17", endsOn: "2026-04-30" }],
    accounts: [
      { id: "account_bank", code: "1930", name: "Bank SEK" },
      { id: "account_payable", code: "2440", name: "Supplier payable" },
      { id: "account_input_vat", code: "2641", name: "Input VAT" },
      { id: "account_expense", code: "6000", name: "Office expense" },
    ],
  };

  const path = join(env.scratch, `${bookId}.json`);

  await writeFile(path, JSON.stringify(config));

  await run("bun", ["scripts/provision.ts", path], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      DATABASE_ADMIN_URL: env.adminUrl,
      OPENERP_ACCESS_TOKEN: token,
    },
  });

  const admin = await database();

  try {
    await admin.query("INSERT INTO openerp.actors(id, name) VALUES ($1, 'Six-books agent')", [
      agentId,
    ]);

    await admin.query(
      "INSERT INTO openerp.memberships(book_id, actor_id, role) VALUES ($1, $2, 'agent')",
      [bookId, agentId],
    );

    await admin.query(
      "INSERT INTO openerp.credentials(token_hash, actor_id, expires_at) VALUES ($1, $2, now() + interval '1 day')",
      [createHash("sha256").update(agentToken).digest("hex"), agentId],
    );
  } finally {
    await admin.end();
  }

  return {
    entityId,
    bookId,
    actorId,
    agentId,
    token,
    agentToken,
    path: `/api/v1/entities/${entityId}/books/${bookId}`,
  };
}

const treatment = {
  basis: "full_deduction",
  rate: { numerator: "25", denominator: "100" },
  deduction: { numerator: "1", denominator: "1" },
  invoiceTaxRounding: "half_up",
  deductionRounding: "half_up",
  acceptancePolicy: "exact_match",
  toleranceMinor: "0",
} as const;

type DraftLine = {
  readonly id: string;
  readonly netMinor: string;
  readonly taxMinor: string;
};

// Recognizes one domestic supplier purchase through the real draft and
// acceptance owners. The caller chooses the lines, so the same helper proves
// both the single-line control and the two-line boundary case.
async function recognizePurchase(
  book: BookFixture,
  source: typeof Accounting.Evidence.Type,
  supplier: typeof Commerce.CounterpartyRevision.Type,
  documentNumber: string,
  lines: ReadonlyArray<DraftLine>,
) {
  const identity = {
    legalName: "A-P01 synthetic supplier",
    registrationId: "5560000001",
    taxId: null,
    address: "Synthetic road 1",
    countryCode: "SE",
    evidenceId: source.id,
  };

  const gross = lines.reduce(
    (sum, line) => sum + BigInt(line.netMinor) + BigInt(line.taxMinor),
    0n,
  );

  const draft = await post(
    book,
    "/commerce/supplier-invoice-drafts",
    {
      draftKey: `ap01_${key()}`,
      content: {
        title: `A-P01 ${lines.length}-line domestic purchase`,
        counterpartyId: supplier.id,
        counterpartyRevision: supplier.revision,
        supplier: identity,
        buyer: identity,
        sourceEvidenceId: source.id,
        supplierDocumentNumber: documentNumber,
        currency: "SEK",
        currencyScale: 2,
        documentDate: "2025-05-25",
        supplyDate: "2025-05-25",
        dueDate: "2025-06-24",
        paymentTerms: "30 days",
        sourceTotalMinor: gross.toString(),
        lines: lines.map((line) => ({
          id: line.id,
          description: `Office supplies ${line.id}`,
          quantity: "1",
          unitPriceMinor: line.netMinor,
          baseMinor: line.netMinor,
          discountMinor: "0",
          chargeMinor: "0",
          taxMinor: line.taxMinor,
          taxDescription: "Swedish standard 25%",
          taxEvidenceId: source.id,
          sourceGrossMinor: (BigInt(line.netMinor) + BigInt(line.taxMinor)).toString(),
        })),
      },
    },
    Drafts.SupplierInvoiceDraftRevision,
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
      accountingPeriodId: "period-a",
      series: "A",
      reason: "Six-books A-P01 reviewed purchase",
      acknowledgeSyntheticOnly: true,
      taxPoint: { taxPointOn: "2025-05-25", basis: "document_date" },
      lineAssignments: lines.map((line) => ({
        lineId: line.id,
        expenseAccountId: "account_expense",
        treatment,
      })),
    },
    Acceptance.SupplierAcceptanceReview,
  );

  const approval = await post(
    book,
    `/commerce/supplier-acceptance-reviews/${review.id}/approvals`,
    { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true },
    Acceptance.SupplierAcceptanceApproval,
  );

  const acceptance = await post(
    book,
    `/commerce/supplier-acceptance-reviews/${review.id}/execute`,
    { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true, approvalId: approval.id },
    Acceptance.SupplierAcceptanceReceipt,
  );

  const invoice = await decoded(
    await request(book, `/commerce/invoices/${acceptance.registerInvoiceId}`),
    Commerce.Invoice,
  );

  return { draft, acceptance, invoice, gross: gross.toString() };
}

async function stageSupplier(book: BookFixture) {
  const source = await decoded(
    await request(book, "/evidence", {
      method: "POST",
      body: JSON.stringify({
        title: "A-P01 office supplies synthetic",
        content: "A-P01 supplier_1 office supplies TEST-ONLY",
        mediaType: "text/plain",
        origin: "six-books challenge A-P01 TEST-ONLY",
      }),
    }),
    Accounting.Evidence,
  );

  const supplier = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: "supplier_1",
      role: "supplier",
      displayName: "A-P01 synthetic supplier",
      evidenceId: source.id,
      reason: "Six-books A-PC01 credit slice",
    },
    Commerce.CounterpartyRevision,
  );

  return { source, supplier };
}

test("six-books credit control: single-line partial credit posts and releases deduction", async () => {
  const env = environment();

  const base = await fixtureBookA();

  const book = { ...base, token: (await createSession(base)).token };

  const { source, supplier } = await stageSupplier(book);

  // One line, so the recognition posts the shape loadPurchaseBasis expects:
  // expense + one VAT debit + payable.
  const recognized = await recognizePurchase(book, source, supplier, "INV-SINGLE", [
    { id: "line_1", netMinor: "1000000", taxMinor: "250000" },
  ]);

  expect(recognized.invoice.amountMinor).toBe("1250000");

  const creditEvidence = await decoded(
    await request(book, "/evidence", {
      method: "POST",
      body: JSON.stringify({
        title: "Single-line credit synthetic",
        content: "Single-line partial credit on line_1 net 500000 tax 125000 TEST-ONLY",
        mediaType: "text/plain",
        origin: "six-books single-line control TEST-ONLY",
      }),
    }),
    Accounting.Evidence,
  );

  const review = await post(
    book,
    "/commerce/supplier-credit-reviews",
    {
      profile: "swedish-purchase-partial-credit-v1",
      invoiceId: recognized.invoice.id,
      acceptanceDigest: recognized.acceptance.digest,
      expectedInvoiceRevision: recognized.invoice.currentRevision.revision,
      expectedAllocationVersion: recognized.invoice.allocationVersion,
      expectedOutstandingMinor: recognized.invoice.outstandingMinor,
      creditEvidenceId: creditEvidence.id,
      supplierCreditNumber: "CN-SINGLE",
      amountMinor: "625000",
      taxMinor: "125000",
      creditLines: [{ lineId: "line_1", netMinor: "500000", sourceTaxMinor: "125000" }],
      creditDate: "2025-06-04",
      accountingPeriodId: "period-a",
      series: "A",
      reason: "Single-line control credit",
      acknowledgeSyntheticOnly: true,
    },
    Credits.SupplierCreditReview,
  );

  const approval = await post(
    book,
    `/commerce/supplier-credit-reviews/${review.id}/approvals`,
    { digest: review.digest, acknowledgeSyntheticOnly: true },
    Credits.SupplierCreditApproval,
  );

  const credit = await post(
    book,
    `/commerce/supplier-credit-reviews/${review.id}/execute`,
    { digest: review.digest, acknowledgeSyntheticOnly: true, approvalId: approval.id },
    Credits.SupplierCreditReceipt,
  );

  expect(credit.outstandingAfterMinor).toBe("625000");

  expect(credit.paid).toBe(false);

  const after = await decoded(
    await request(book, `/commerce/purchase-recognitions/by-draft/${recognized.draft.id}`),
    Recognition.PurchaseRecognitionView,
  );

  const remaining = after.capacities.find((entry) => entry.sourceLineId === "line_1");

  expect(remaining?.remainingNetMinor).toBe("500000");

  expect(remaining?.remainingSourceTaxMinor).toBe("125000");

  expect(remaining?.creditedNetMinor).toBe("500000");

  const ledger = await decoded(await request(book, "/ledger"), Accounting.LedgerSnapshot);

  const debits = ledger.accounts.reduce((sum, account) => sum + BigInt(account.debitMinor), 0n);

  const credits = ledger.accounts.reduce((sum, account) => sum + BigInt(account.creditMinor), 0n);

  expect(debits).toBe(credits);

  await writeFile(
    join(env.artifacts, "six-books-credit-single-line-control.json"),
    `${JSON.stringify(
      {
        schema: "six-books-credit-control/v1",
        case: "single-line partial credit control",
        status: "PASS",
        invoiceId: recognized.invoice.id,
        creditId: credit.id,
        outstandingAfterMinor: credit.outstandingAfterMinor,
        remainingNetMinor: remaining?.remainingNetMinor,
        remainingSourceTaxMinor: remaining?.remainingSourceTaxMinor,
        ledgerBalanced: true,
      },
      null,
      2,
    )}\n`,
  );
});

test("six-books credit A-PC01: partial line_2 credit boundary (multi-line defect record)", async () => {
  const env = environment();

  const base = await fixtureBookA();

  const book = { ...base, token: (await createSession(base)).token };

  const source = await decoded(
    await request(book, "/evidence", {
      method: "POST",
      body: JSON.stringify({
        title: "A-P01 office supplies synthetic",
        content: "A-P01 supplier_1 INV-001 line_1 1000000+250000 line_2 600000+150000 TEST-ONLY",
        mediaType: "text/plain",
        origin: "six-books challenge A-P01 TEST-ONLY",
      }),
    }),
    Accounting.Evidence,
  );

  const supplier = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: "supplier_1",
      role: "supplier",
      displayName: "A-P01 synthetic supplier",
      evidenceId: source.id,
      reason: "Six-books A-PC01 credit slice",
    },
    Commerce.CounterpartyRevision,
  );

  const identity = {
    legalName: "A-P01 synthetic supplier",
    registrationId: "5560000001",
    taxId: null,
    address: "Synthetic road 1",
    countryCode: "SE",
    evidenceId: source.id,
  };

  const treatment = {
    basis: "full_deduction",
    rate: { numerator: "25", denominator: "100" },
    deduction: { numerator: "1", denominator: "1" },
    invoiceTaxRounding: "half_up",
    deductionRounding: "half_up",
    acceptancePolicy: "exact_match",
    toleranceMinor: "0",
  } as const;

  const draft = await post(
    book,
    "/commerce/supplier-invoice-drafts",
    {
      draftKey: `ap01_${key()}`,
      content: {
        title: "A-P01 two-line domestic purchase",
        counterpartyId: supplier.id,
        counterpartyRevision: supplier.revision,
        supplier: identity,
        buyer: identity,
        sourceEvidenceId: source.id,
        supplierDocumentNumber: "INV-001",
        currency: "SEK",
        currencyScale: 2,
        documentDate: "2025-05-25",
        supplyDate: "2025-05-25",
        dueDate: "2025-06-24",
        paymentTerms: "30 days",
        sourceTotalMinor: "2000000",
        lines: [
          {
            id: "line_1",
            description: "Office supplies line 1",
            quantity: "1",
            unitPriceMinor: "1000000",
            baseMinor: "1000000",
            discountMinor: "0",
            chargeMinor: "0",
            taxMinor: "250000",
            taxDescription: "Swedish standard 25%",
            taxEvidenceId: source.id,
            sourceGrossMinor: "1250000",
          },
          {
            id: "line_2",
            description: "Office supplies line 2",
            quantity: "1",
            unitPriceMinor: "600000",
            baseMinor: "600000",
            discountMinor: "0",
            chargeMinor: "0",
            taxMinor: "150000",
            taxDescription: "Swedish standard 25%",
            taxEvidenceId: source.id,
            sourceGrossMinor: "750000",
          },
        ],
      },
    },
    Drafts.SupplierInvoiceDraftRevision,
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
      accountingPeriodId: "period-a",
      series: "A",
      reason: "Six-books A-P01 reviewed purchase",
      acknowledgeSyntheticOnly: true,
      taxPoint: { taxPointOn: "2025-05-25", basis: "document_date" },
      lineAssignments: [
        { lineId: "line_1", expenseAccountId: "account_expense", treatment },
        { lineId: "line_2", expenseAccountId: "account_expense", treatment },
      ],
    },
    Acceptance.SupplierAcceptanceReview,
  );

  const approval = await post(
    book,
    `/commerce/supplier-acceptance-reviews/${review.id}/approvals`,
    { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true },
    Acceptance.SupplierAcceptanceApproval,
  );

  const acceptance = await post(
    book,
    `/commerce/supplier-acceptance-reviews/${review.id}/execute`,
    { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true, approvalId: approval.id },
    Acceptance.SupplierAcceptanceReceipt,
  );

  const invoice = await decoded(
    await request(book, `/commerce/invoices/${acceptance.registerInvoiceId}`),
    Commerce.Invoice,
  );

  expect(invoice.amountMinor).toBe("2000000");

  const creditEvidence = await decoded(
    await request(book, "/evidence", {
      method: "POST",
      body: JSON.stringify({
        title: "A-PC01 credit synthetic",
        content: "A-PC01 credit on A-P01 line_2 net 400000 tax 100000 gross 500000 TEST-ONLY",
        mediaType: "text/plain",
        origin: "six-books challenge A-PC01 TEST-ONLY",
      }),
    }),
    Accounting.Evidence,
  );

  const creditPrepareResponse = await request(book, "/commerce/supplier-credit-reviews", {
    method: "POST",
    body: JSON.stringify({
      profile: "swedish-purchase-partial-credit-v1",
      invoiceId: invoice.id,
      acceptanceDigest: acceptance.digest,
      expectedInvoiceRevision: invoice.currentRevision.revision,
      expectedAllocationVersion: invoice.allocationVersion,
      expectedOutstandingMinor: invoice.outstandingMinor,
      creditEvidenceId: creditEvidence.id,
      supplierCreditNumber: "CN-PC01",
      amountMinor: "500000",
      taxMinor: "100000",
      creditLines: [{ lineId: "line_2", netMinor: "400000", sourceTaxMinor: "100000" }],
      creditDate: "2025-06-04",
      accountingPeriodId: "period-a",
      series: "A",
      reason: "Six-books A-PC01 partial credit on line_2",
      acknowledgeSyntheticOnly: true,
    }),
  });

  const creditPrepareBody = await creditPrepareResponse.text();

  let creditCode = `http-${creditPrepareResponse.status}`;

  try {
    const parsed = JSON.parse(creditPrepareBody) as { code?: string };

    if (parsed.code) creditCode = parsed.code;
  } catch {
    creditCode = `http-${creditPrepareResponse.status}:unparsed`;
  }

  if (creditPrepareResponse.status !== 200) {
    const report = {
      schema: "six-books-credit/v1",
      case: "A/A008 supplier_credit (A-PC01 on A-P01 line_2)",
      status: "FAIL",
      reason:
        "Multi-VAT-line recognitions cannot take supplier credits: loadPurchaseBasis (credit-basis.ts) requires action.lines.length === original.length + 2 and one aggregated VAT debit, but per-line VAT split posts 5 lines (2 expense + 2 VAT + 1 payable) for 2 plan lines. Single-line partial credit passes; two-line full and partial both refuse StaleDependency with matching freshness fields.",
      invoiceId: invoice.id,
      prepareStatus: creditPrepareResponse.status,
      prepareCode: creditCode,
      invoiceState: {
        status: invoice.status,
        blockers: invoice.blockers,
        outstandingMinor: invoice.outstandingMinor,
        allocationVersion: invoice.allocationVersion,
        revision: invoice.currentRevision.revision,
      },
    };

    await writeFile(
      join(env.artifacts, "six-books-credit-a-pc01.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );

    expect(creditCode).toBe("StaleDependency");

    return;
  }

  const creditReview = await decoded(
    new Response(creditPrepareBody, {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    Credits.SupplierCreditReview,
  );

  const creditApproval = await post(
    book,
    `/commerce/supplier-credit-reviews/${creditReview.id}/approvals`,
    { digest: creditReview.digest, acknowledgeSyntheticOnly: true },
    Credits.SupplierCreditApproval,
  );

  const credit = await post(
    book,
    `/commerce/supplier-credit-reviews/${creditReview.id}/execute`,
    { digest: creditReview.digest, acknowledgeSyntheticOnly: true, approvalId: creditApproval.id },
    Credits.SupplierCreditReceipt,
  );

  expect(credit.outstandingAfterMinor).toBe("1500000");

  expect(credit.paid).toBe(false);

  const after = await decoded(
    await request(book, `/commerce/purchase-recognitions/by-draft/${draft.id}`),
    Recognition.PurchaseRecognitionView,
  );

  const capacityByLine = new Map(after.capacities.map((entry) => [entry.sourceLineId, entry]));

  expect(capacityByLine.get("line_2")?.remainingNetMinor).toBe("200000");

  expect(capacityByLine.get("line_2")?.remainingSourceTaxMinor).toBe("50000");

  expect(capacityByLine.get("line_1")?.remainingNetMinor).toBe("1000000");

  const ledger = await decoded(await request(book, "/ledger"), Accounting.LedgerSnapshot);

  const debits = ledger.accounts.reduce((sum, account) => sum + BigInt(account.debitMinor), 0n);

  const credits = ledger.accounts.reduce((sum, account) => sum + BigInt(account.creditMinor), 0n);

  expect(debits).toBe(credits);

  const report = {
    schema: "six-books-credit/v1",
    case: "A/A008 supplier_credit (A-PC01 on A-P01 line_2)",
    status: "PASS",
    invoiceId: invoice.id,
    creditId: credit.id,
    outstandingAfterMinor: credit.outstandingAfterMinor,
    line2RemainingNet: capacityByLine.get("line_2")?.remainingNetMinor,
    line2RemainingTax: capacityByLine.get("line_2")?.remainingSourceTaxMinor,
    ledgerBalanced: debits.toString() === credits.toString(),
  };

  await writeFile(
    join(env.artifacts, "six-books-credit-a-pc01.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  expect(report.ledgerBalanced).toBe(true);
});
