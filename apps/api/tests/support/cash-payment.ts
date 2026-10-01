import { createHash, randomBytes } from "node:crypto";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import { database, execute, key, post, type BookFixture } from "./fixtures";
import { createDraft, supplierFixture } from "./supplier-review";

export async function cashFixture(
  options: { priorAccrualReview?: boolean; roundedOriginal?: boolean } = {},
) {
  const { book, content } = await supplierFixture();
  const netMinor = options.roundedOriginal ? "3" : "100000";
  const taxMinor = options.roundedOriginal ? "1" : "25000";
  const grossMinor = options.roundedOriginal ? "4" : "125000";

  const source = await post(
    book,
    "/evidence",
    {
      title: "Synthetic cash-method original",
      content: `REVIEW-001: net${netMinor} + VAT${taxMinor} = gross${grossMinor} minor SEK; domestic full deduction, half-up, issued2026-09-22. Synthetic only.`,
      mediaType: "text/plain",
      origin: "NEXT-38 failure-first fixture",
    },
    Accounting.Evidence,
  );

  const token = randomBytes(32).toString("hex");
  const actorId = `reviewer_${randomBytes(8).toString("hex")}`;
  const reviewer = { ...book, actorId, token };
  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.actors(id,name) values($1,'Independent cash-payment reviewer')",
      [actorId],
    );
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, actorId],
    );
    await admin.query(
      "insert into openerp.credentials(token_hash,actor_id,expires_at) values($1,$2,now()+interval '1 day')",
      [createHash("sha256").update(token).digest("hex"), actorId],
    );
    await admin.query(
      "insert into openerp.accounts(book_id,id,code,name,active,version) values($1,'account_expense','4010','Expense',true,1),($1,'account_vat','2641','Input VAT',true,1)",
      [book.bookId],
    );

    for (const family of ["posting_eligibility", "vat"] as const) {
      const id = `next38_synthetic_${family}`;

      const release = {
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
        [id, family, release.checksum, release],
      );
    }
  } finally {
    await admin.end();
  }

  for (const input of [
    { factKind: "jurisdiction", value: { state: "known", value: "SE" } },
    { factKind: "accounting_method", value: { state: "known", value: "cash" } },
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
        evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
        note: "Explicit synthetic fact",
      },
      Profiles.FactRevision,
    );

    await post(
      reviewer,
      `/company-facts/${fact.id}/reviews`,
      {
        factRevisionId: fact.id,
        expectedDigest: fact.digest,
        result: "confirmed",
        rationale: "Independent fact review",
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
        reviewer: actorId,
        evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
        note: "Reviewed synthetic role",
      },
      Profiles.RoleBinding,
    );
  }

  const line = content.lines[0];

  if (!line) throw new Error("Missing source fixture line");

  const draft = await createDraft(book, {
    ...content,
    sourceEvidenceId: source.id,
    supplier: { ...content.supplier, evidenceId: source.id },
    buyer: { ...content.buyer, evidenceId: source.id },
    sourceTotalMinor: grossMinor,
    lines: [
      {
        ...line,
        baseMinor: netMinor,
        unitPriceMinor: netMinor,
        taxMinor,
        sourceGrossMinor: grossMinor,
        taxEvidenceId: source.id,
      },
    ],
  });

  let accrualReview: typeof Acceptance.SupplierAcceptanceReview.Type | null = null;
  let accrualApproval: typeof Acceptance.SupplierAcceptanceApproval.Type | null = null;

  if (options.priorAccrualReview) {
    const secondLabel = await createDraft(book, {
      ...draft.content,
      supplierDocumentNumber: "SECOND-LABEL",
    });

    accrualReview = await post(
      book,
      "/commerce/supplier-acceptance-reviews",
      {
        profile: "synthetic-gross-cost-supplier-v1",
        draftId: secondLabel.id,
        expectedRevision: secondLabel.revision,
        expectedDigest: secondLabel.digest,
        controlAccountId: "account_clearing",
        debitAccountId: "account_expense",
        accountingPeriodId: "period_2026",
        series: "A",
        reason: "Prior ordinary proposal cannot later accrue an adopted cash original",
        acknowledgeSyntheticOnly: true,
      },
      Acceptance.SupplierAcceptanceReview,
    );
    accrualApproval = await post(
      book,
      `/commerce/supplier-acceptance-reviews/${accrualReview.id}/approvals`,
      {
        version: 1,
        digest: accrualReview.digest,
        acknowledgeSyntheticOnly: true,
      },
      Acceptance.SupplierAcceptanceApproval,
    );
  }

  const invoice = await post(
    book,
    "/commerce/invoices/cash-method",
    {
      profile: "synthetic-cash-method-domestic-v1",
      draftId: draft.id,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      controlAccountId: "account_clearing",
      inputVatAccountId: "account_vat",
      lineAssignments: [
        {
          lineId: line.id,
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
      reason: "Retained commercial debt",
      acknowledgeSyntheticOnly: true,
    },
    Commerce.Invoice,
  );

  return { book, reviewer, source, invoice, draft, accrualReview, accrualApproval };
}

export async function postedCash(
  book: BookFixture,
  options: {
    final?: boolean;
    bank?: boolean;
    amountMinor?: string;
    date?: string;
    periodId?: string;
    dailyStatement?: boolean;
    openingMinor?: string;
  } = {},
) {
  const final = options.final ?? true;
  const amountMinor = options.amountMinor ?? "50000";
  const date = options.date ?? "2026-09-22";
  const openingMinor = options.openingMinor ?? "100000";

  const monthEnd = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);

  const statement = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "synthetic_cash_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: options.dailyStatement ? date : `${date.slice(0, 8)}01`,
    endsOn: options.dailyStatement ? date : monthEnd,
    openingMinor,
    closingMinor: (BigInt(openingMinor) - BigInt(amountMinor)).toString(),
    completeness: { declaredComplete: final, basis: "Explicit synthetic booked cash interval" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date,
        description: "Final supplier cash payment",
        amountMinor: `-${amountMinor}`,
      },
    ],
  };

  const source = await post(
    book,
    "/evidence",
    {
      title: "Synthetic final cash source",
      content: JSON.stringify(statement),
      mediaType: "application/json",
      origin: "NEXT-38 synthetic bank original",
    },
    Accounting.Evidence,
  );

  const bankAccount = options.bank === false ? "account_expense" : "account_bank";

  const plan = await post(
    book,
    "/change-sets",
    {
      kind: "manual_journal",
      evidenceId: source.id,
      eventKey: key(),
      accountingPeriodId: options.periodId ?? "period_2026",
      postingDate: date,
      series: "A",
      description: "Retained cash versus clearing",
      rationale: "Synthetic actual booked cash",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "account_clearing",
          debitMinor: amountMinor,
          creditMinor: "0",
          description: "Cash clearing",
        },
        {
          accountId: bankAccount,
          debitMinor: "0",
          creditMinor: amountMinor,
          description: "Cash outflow",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const posted = await execute(book, plan);
  const action = plan.groups[0]?.actions[0];
  const clearing = action?.lines.find((line) => line.accountId === "account_clearing");
  const bank = action?.lines.find((line) => line.accountId === "account_bank");

  if (!clearing) throw new Error("Missing posted clearing capacity");

  let statementId: string | undefined;

  if (bank) {
    const imported = await post(
      book,
      "/bank-statements",
      {
        ...statement,
        evidenceId: source.id,
        existingMatches: [{ rowOrdinal: 1, voucherId: posted.voucherId, lineId: bank.lineId }],
      },
      Bank.StatementImportReceipt,
    );

    statementId = imported.statement.id;
  }

  return { source, posted, clearingLineId: clearing.lineId, bankLineId: bank?.lineId, statementId };
}

export async function allocateCash(
  context: Awaited<ReturnType<typeof cashFixture>>,
  cash: Awaited<ReturnType<typeof postedCash>>,
  amountMinor = "50000",
) {
  return post(
    context.book,
    "/commerce/allocation-plans",
    {
      voucherId: cash.posted.voucherId,
      lineId: cash.clearingLineId,
      evidenceId: context.source.id,
      rationale: "Allocate retained cash, not caller evidence",
      allocations: [{ invoiceId: context.invoice.id, amountMinor }],
    },
    Commerce.AllocationPlan,
  );
}

export async function paymentSnapshot(book: BookFixture) {
  const admin = await database();

  try {
    const rows = await admin.query(
      `select committed_sequence::text as sequence,
      (select coalesce(sum(last_number),0)::text from openerp.series_counters where book_id=$1) as counter,
      (select count(*)::text from openerp.vouchers where book_id=$1) as vouchers,
      (select count(*)::text from openerp.execution_receipts where book_id=$1) as postings,
      (select count(*)::text from openerp.approvals where book_id=$1 and consumed_at is not null) as approvals,
      (select count(*)::text from openerp.commerce_allocation_receipts where book_id=$1) as allocations,
      (select count(*)::text from openerp.commerce_allocation_legs where book_id=$1) as legs,
      (select count(*)::text from openerp.cash_method_recognitions where book_id=$1) as recognitions,
      (select count(*)::text from openerp.vat_fact_components where book_id=$1) as facts,
      (select coalesce(jsonb_agg(jsonb_build_array(id,paid_gross_minor,recognized_gross_minor,version) order by id),'[]'::jsonb) from openerp.cash_method_lines where book_id=$1) as coverage
      from openerp.books where id=$1`,
      [book.bookId],
    );

    return rows.rows[0];
  } finally {
    await admin.end();
  }
}
