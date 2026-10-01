import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Accounting from "@open-erp/contracts/accounting";
import { expect, test } from "vitest";
import {
  database,
  environment,
  decoded,
  failure,
  execute,
  fixture,
  key,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";
import { createDraft, supplierFixture } from "./support/supplier-review";

// Failure-first expectations: original G125000=N100000+VAT25000 remains
// commercial debt only. Acceptance publishes no journal or tax fact.
const path = "/commerce/invoices/cash-method";

async function qualify(
  book: BookFixture,
  evidence: { id: string; sha256: string },
  method: "cash" | "accrual" = "cash",
  reviewed = true,
) {
  const admin = await database();
  const reviewerId = `reviewer_${randomBytes(8).toString("hex")}`;
  const token = randomBytes(32).toString("hex");

  try {
    await admin.query(
      "insert into openerp.actors(id,name) values($1,'Independent synthetic reviewer')",
      [reviewerId],
    );
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, reviewerId],
    );
    await admin.query(
      "insert into openerp.credentials(token_hash,actor_id,expires_at) values($1,$2,now()+interval '1 day')",
      [createHash("sha256").update(token).digest("hex"), reviewerId],
    );

    for (const family of ["posting_eligibility", "vat"] as const) {
      const id = `next38_synthetic_${family}`;

      const body = {
        id,
        jurisdiction: "SE",
        family,
        version: 38,
        checksum: `sha256:${"3".repeat(64)}`,
        applicability: {
          legalForms: [],
          accountingMethods: ["cash"],
          vatRegistrations: ["registered"],
          payrollRegistrations: [],
        },
        requiredFactKinds: ["accounting_method", "vat_registration"],
        requiredRoleKinds: [family === "vat" ? "vat" : "commerce"],
        calculatorVersion: "synthetic-cash-method-domestic-v1",
        rounding: { mode: "half_up", scale: 2 },
        validFrom: "2026-01-01",
        validTo: "2026-12-31",
        sourceManifest: "Explicit synthetic cash-method fixture; no statutory qualification claim",
        qualificationStatus: "reviewed",
        recordClasses: ["synthetic"],
      };

      await admin.query(
        "insert into openerp.rule_releases(id,jurisdiction,family,version,checksum,body) values($1,'SE',$2,38,$3,$4) on conflict(id) do nothing",
        [id, family, body.checksum, body],
      );
    }
  } finally {
    await admin.end();
  }

  let methodId = "";

  for (const input of [
    { factKind: "jurisdiction", value: { state: "known", value: "SE" } },
    { factKind: "accounting_method", value: { state: "known", value: method } },
    { factKind: "vat_registration", value: { state: "known", value: "registered" } },
  ]) {
    const fact = await post(
      book,
      "/company-facts",
      {
        ...input,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        supersedesId: null,
        evidence: [{ evidenceId: evidence.id, sha256: evidence.sha256 }],
        note: "Explicit synthetic company fact",
      },
      Profiles.FactRevision,
    );

    if (fact.factKind === "accounting_method") methodId = fact.id;

    if (reviewed)
      await post(
        { ...book, token, actorId: reviewerId },
        `/company-facts/${fact.id}/reviews`,
        {
          factRevisionId: fact.id,
          expectedDigest: fact.digest,
          result: "confirmed",
          rationale: "Independent synthetic fact review",
        },
        Profiles.FactReview,
      );
  }

  for (const [roleKind, accountId] of [
    ["commerce", "account_clearing"],
    ["vat", "account_vat"],
  ] as const) {
    await post(
      book,
      "/company-role-bindings",
      {
        roleKind,
        accountId,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        supersedesId: null,
        reviewer: reviewerId,
        evidence: [{ evidenceId: evidence.id, sha256: evidence.sha256 }],
        note: "Synthetic reviewed cash-method account role",
      },
      Profiles.RoleBinding,
    );
  }

  return methodId;
}

async function prepared(method: "cash" | "accrual" = "cash", reviewed = true) {
  const { book, source, content } = await supplierFixture();
  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.accounts(book_id,id,code,name,active,version) values($1,'account_expense','4010','Purchase expense',true,1),($1,'account_vat','2641','Input VAT',true,1)",
      [book.bookId],
    );
  } finally {
    await admin.end();
  }

  const methodId = await qualify(book, source, method, reviewed);

  const draft = await createDraft(book, {
    ...content,
    sourceTotalMinor: "125000",
    lines: [
      {
        ...content.lines[0]!,
        unitPriceMinor: "100000",
        baseMinor: "100000",
        taxMinor: "25000",
        sourceGrossMinor: "125000",
        taxDescription: "Explicit synthetic domestic 25 percent",
      },
    ],
  });

  const input = {
    profile: "synthetic-cash-method-domestic-v1",
    draftId: draft.id,
    expectedRevision: draft.revision,
    expectedDigest: draft.digest,
    controlAccountId: "account_clearing",
    inputVatAccountId: "account_vat",
    lineAssignments: [
      {
        lineId: "line_purchase",
        expenseAccountId: "account_expense",
        treatment: {
          basis: "full_deduction",
          rate: { numerator: "1", denominator: "4" },
          deduction: { numerator: "1", denominator: "1" },
          invoiceTaxRounding: "half_up",
          deductionRounding: "half_up",
          acceptancePolicy: "exact_match",
          toleranceMinor: "0",
        },
      },
    ],
    reason: "Accept retained original commercial debt without recognition",
    acknowledgeSyntheticOnly: true,
  };

  return { book, source, draft, input, methodId };
}

async function financialCounts(book: BookFixture) {
  const admin = await database();

  try {
    const result = await admin.query(
      `select
      (select count(*)::text from openerp.vouchers where book_id=$1) as vouchers,
      (select count(*)::text from openerp.journal_lines where book_id=$1) as lines,
      (select count(*)::text from openerp.purchase_recognitions where book_id=$1) as recognitions,
      (select count(*)::text from openerp.purchase_tax_facts where book_id=$1) as tax_facts,
      (select count(*)::text from openerp.cash_method_lines where book_id=$1) as cash_lines`,
      [book.bookId],
    );

    return result.rows[0];
  } finally {
    await admin.end();
  }
}

test("cash line admission delegates to retained commercial-only invoice ownership", async () => {
  const { book, input } = await prepared();
  const commandKey = key();

  const send = () =>
    request(book, "/commerce/cash-method/lines", {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(input),
    });

  const invoice = await decoded(await send(), Commerce.Invoice);
  expect(invoice.amountMinor).toBe("125000");
  expect(invoice.outstandingMinor).toBe("125000");
  expect(invoice.recognition).toBeNull();
  expect(await decoded(await send(), Commerce.Invoice)).toEqual(invoice);
  expect(await financialCounts(book)).toEqual({
    vouchers: "0",
    lines: "0",
    recognitions: "0",
    tax_facts: "0",
    cash_lines: "0",
  });
}, 240000);

test("qualified retained cash invoice is commercial-only, replayable and sealed against duplicate adoption", async () => {
  const { book, input, draft, methodId } = await prepared();
  const commandKey = key();

  const send = (body = input) =>
    request(book, path, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(body),
    });

  const invoice = await decoded(await send(), Commerce.Invoice);
  expect(invoice.recognition).toBeNull();
  expect(invoice.amountMinor).toBe("125000");
  expect(invoice.outstandingMinor).toBe("125000");
  expect(invoice.recordedAllocatedMinor).toBe("0");
  expect(invoice.status).toBe("open");
  expect(invoice.cashMethod?.methodFactRevisionId).toBe(methodId);
  expect(invoice.cashMethod?.draftId).toBe(draft.id);
  expect(invoice.cashMethod?.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        netMinor: "100000",
        taxMinor: "25000",
        grossMinor: "125000",
        deductibleMinor: "25000",
      }),
    ]),
  );
  expect(await financialCounts(book)).toEqual({
    vouchers: "0",
    lines: "0",
    recognitions: "0",
    tax_facts: "0",
    cash_lines: "0",
  });
  expect(await decoded(await send(), Commerce.Invoice)).toEqual(invoice);
  expect(
    await decoded(await request(book, `/commerce/invoices/${invoice.id}`), Commerce.Invoice),
  ).toEqual(invoice);
  await failure(
    await send({ ...input, reason: "Changed command must not replay" }),
    409,
    "IdempotencyConflict",
  );
  await failure(
    await request(book, path, { method: "POST", body: JSON.stringify(input) }),
    409,
    "IdempotencyConflict",
  );
  await failure(
    await request(book, `/commerce/invoices/${invoice.id}/payments`),
    422,
    "UnsupportedProfile",
  );
  await failure(
    await request(book, `/commerce/supplier-invoice-drafts/${draft.id}/revisions`, {
      method: "POST",
      body: JSON.stringify({
        expectedRevision: draft.revision,
        expectedDigest: draft.digest,
        reason: "Cannot rewrite accepted original",
        content: draft.content,
      }),
    }),
    403,
    "Forbidden",
  );

  const duplicateSource = await createDraft(book, {
    ...draft.content,
    supplierDocumentNumber: "SECOND-LABEL",
  });

  await failure(
    await request(book, path, {
      method: "POST",
      body: JSON.stringify({
        ...input,
        draftId: duplicateSource.id,
        expectedRevision: duplicateSource.revision,
        expectedDigest: duplicateSource.digest,
      }),
    }),
    409,
    "IdempotencyConflict",
  );
  await failure(
    await request(book, "/commerce/supplier-acceptance-reviews", {
      method: "POST",
      body: JSON.stringify({
        profile: "synthetic-gross-cost-supplier-v1",
        draftId: draft.id,
        expectedRevision: draft.revision,
        expectedDigest: draft.digest,
        controlAccountId: "account_clearing",
        debitAccountId: "account_expense",
        accountingPeriodId: "period_2026",
        series: "A",
        reason: "Cannot accrue an accepted cash-method original",
        acknowledgeSyntheticOnly: true,
      }),
    }),
    422,
    "UnsupportedProfile",
  );

  const admin = await database();

  try {
    const rows = await admin.query(
      "select recognition_voucher_id,recognition_line_id,cash_method_source_draft_id from openerp.commerce_invoices where book_id=$1",
      [book.bookId],
    );

    expect(rows.rows).toEqual([
      {
        recognition_voucher_id: null,
        recognition_line_id: null,
        cash_method_source_draft_id: draft.id,
      },
    ]);
  } finally {
    await admin.end();
  }

  expect(await financialCounts(book)).toEqual({
    vouchers: "0",
    lines: "0",
    recognitions: "0",
    tax_facts: "0",
    cash_lines: "0",
  });
}, 240000);

test("cash admission refuses original evidence with an executed accrual effect", async () => {
  const { book, input, source } = await prepared();

  const plan = await post(
    book,
    "/change-sets",
    {
      kind: "manual_journal",
      evidenceId: source.id,
      eventKey: "executed_original_accrual",
      accountingPeriodId: "period_2026",
      postingDate: "2026-09-15",
      series: "A",
      description: "Executed original cannot be adopted for cash recognition",
      rationale: "Preserve the existing accrual effect",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "account_expense",
          debitMinor: "100000",
          creditMinor: "0",
          description: "Cost",
        },
        { accountId: "account_vat", debitMinor: "25000", creditMinor: "0", description: "VAT" },
        {
          accountId: "account_clearing",
          debitMinor: "0",
          creditMinor: "125000",
          description: "AP",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  await execute(book, plan);
  const before = await financialCounts(book);
  await failure(
    await request(book, path, { method: "POST", body: JSON.stringify(input) }),
    409,
    "AlreadyPosted",
  );
  expect(await financialCounts(book)).toEqual(before);
}, 240000);

test("unreviewed or accrual method cannot admit a cash commercial invoice", async () => {
  for (const [method, reviewed] of [
    ["cash", false],
    ["accrual", true],
  ] as const) {
    const { book, input } = await prepared(method, reviewed);
    await failure(
      await request(book, path, { method: "POST", body: JSON.stringify(input) }),
      422,
      "UnsupportedProfile",
    );
    expect(await financialCounts(book)).toEqual({
      vouchers: "0",
      lines: "0",
      recognitions: "0",
      tax_facts: "0",
      cash_lines: "0",
    });
  }
}, 240000);

test("cash admission rejects wrong-book draft, stale source, incompatible accounts and agent writes", async () => {
  const { book, input } = await prepared();
  const other = await fixture();
  await failure(
    await request(other, path, { method: "POST", body: JSON.stringify(input) }),
    404,
    "NotFound",
  );
  await failure(
    await request(book, path, {
      method: "POST",
      body: JSON.stringify({ ...input, expectedRevision: "2" }),
    }),
    409,
    "StaleDependency",
  );
  await failure(
    await request(book, path, {
      method: "POST",
      body: JSON.stringify({ ...input, controlAccountId: "account_bank" }),
    }),
    422,
    "InvalidJournal",
  );
  await failure(
    await request(book, path, {
      method: "POST",
      body: JSON.stringify({ ...input, inputVatAccountId: "account_expense" }),
    }),
    422,
    "InvalidJournal",
  );
  await failure(
    await request(book, path, {
      method: "POST",
      headers: { authorization: `Bearer ${book.agentToken}` },
      body: JSON.stringify(input),
    }),
    403,
    "Forbidden",
  );
  expect(await financialCounts(book)).toEqual({
    vouchers: "0",
    lines: "0",
    recognitions: "0",
    tax_facts: "0",
    cash_lines: "0",
  });
}, 240000);

test("locked document period admits only a constrained commercial cash invoice without posting", async () => {
  const { book, input, draft } = await prepared();
  const admin = await database();
  const commandKey = key();

  const send = () =>
    request(book, path, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(input),
    });

  try {
    await admin.query(
      "update openerp.periods set locked=true where book_id=$1 and id='period_2026'",
      [book.bookId],
    );

    const invoice = await decoded(await send(), Commerce.Invoice);
    expect(invoice.recognition).toBeNull();
    expect(invoice.amountMinor).toBe("125000");
    expect(invoice.outstandingMinor).toBe("125000");
    expect(invoice.cashMethod?.draftId).toBe(draft.id);

    const population = await admin.query(
      "select version::text from openerp.cash_method_population_epochs where book_id=$1",
      [book.bookId],
    );

    expect(population.rows).toEqual([{ version: "1" }]);

    const replayed = await decoded(await send(), Commerce.Invoice);

    const replayedPopulation = await admin.query(
      "select version::text from openerp.cash_method_population_epochs where book_id=$1",
      [book.bookId],
    );

    expect(replayed).toEqual(invoice);
    expect(replayedPopulation.rows).toEqual([{ version: "1" }]);

    const invalidInvoices = [
      {
        name: "ordinary_null_recognition",
        voucher: null,
        line: null,
        draft: null,
        body: { ...invoice, kind: "synthetic_invoice_v1" },
      },
      { name: "cash_missing_draft", voucher: null, line: null, draft: null, body: invoice },
      {
        name: "cash_mixed_voucher",
        voucher: "missing_voucher",
        line: null,
        draft: draft.id,
        body: invoice,
      },
      {
        name: "cash_mixed_line",
        voucher: null,
        line: "missing_line",
        draft: draft.id,
        body: invoice,
      },
    ];

    const refusals: Array<{ name: string; code: string; constraint: string } | null> = [];

    for (const invalidInvoice of invalidInvoices) {
      const refusal = await admin
        .query(
          `insert into openerp.commerce_invoices
        (book_id,id,direction,counterparty_id,counterparty_revision,document_number,issued_on,
        amount_minor,control_account_id,recognition_voucher_id,recognition_line_id,evidence_id,
        current_revision,body,cash_method_source_draft_id)
        select book_id,$2,direction,counterparty_id,counterparty_revision,$2,issued_on,
        amount_minor,control_account_id,$3,$4,evidence_id,current_revision,$5::jsonb,$6
        from openerp.commerce_invoices where book_id=$1 and id=$7`,
          [
            book.bookId,
            invalidInvoice.name,
            invalidInvoice.voucher,
            invalidInvoice.line,
            JSON.stringify(invalidInvoice.body),
            invalidInvoice.draft,
            invoice.id,
          ],
        )
        .then(
          () => null,
          (error: unknown) => {
            if (
              !(error instanceof Error) ||
              !("code" in error) ||
              typeof error.code !== "string" ||
              !("constraint" in error) ||
              typeof error.constraint !== "string"
            )
              throw error;

            return { name: invalidInvoice.name, code: error.code, constraint: error.constraint };
          },
        );

      expect(refusal).toEqual({
        name: invalidInvoice.name,
        code: "23514",
        constraint: "commerce_recognition_shape",
      });

      refusals.push(refusal);
    }

    expect(
      (
        await admin.query(
          "select count(*)::int as count from openerp.commerce_invoices where book_id=$1",
          [book.bookId],
        )
      ).rows,
    ).toEqual([{ count: 1 }]);

    const documentPeriod = await admin.query(
      "select locked from openerp.periods where book_id=$1 and id='period_2026'",
      [book.bookId],
    );

    expect(documentPeriod.rows).toEqual([{ locked: true }]);

    const cashRecognition = await admin.query(
      `select (select count(*)::text from openerp.cash_method_recognitions where book_id=$1) as recognitions,
      (select coalesce(sum(last_number),0)::text from openerp.series_counters where book_id=$1) as counter`,
      [book.bookId],
    );

    expect(cashRecognition.rows).toEqual([{ recognitions: "0", counter: "0" }]);

    const financial = await financialCounts(book);
    expect(financial).toEqual({
      vouchers: "0",
      lines: "0",
      recognitions: "0",
      tax_facts: "0",
      cash_lines: "0",
    });
    await writeFile(
      join(environment().artifacts, "cash-commercial-period-admission.json"),
      JSON.stringify(
        {
          invoice,
          documentPeriod: documentPeriod.rows,
          population: population.rows,
          replayed,
          replayedPopulation: replayedPopulation.rows,
          refusals,
          financial,
          cashRecognition: cashRecognition.rows,
        },
        null,
        2,
      ),
    );
  } finally {
    await admin.end();
  }
}, 240000);
