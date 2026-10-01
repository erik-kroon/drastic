import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { Client } from "pg";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import { createDraft } from "./support/supplier-review";
import {
  database,
  decoded,
  environment,
  evidence,
  failure,
  fixture,
  key,
  persisted,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";

const plans = "/purchases/supplier-settlement-plans";

const cancellations = "/purchases/supplier-settlement-cancellation-plans";

const Identity = Schema.Struct({ id: Accounting.Identifier, digest: Accounting.Digest });

const Prepared = Schema.Struct({
  ...Identity.fields,
  version: Schema.Literal(1),
  amountMinor: Accounting.MinorUnits,
  paymentPlan: Accounting.ChangeSet,
  pendingAllocation: Commerce.AllocationPlan,
  reservedVoucherId: Accounting.Identifier,
  controlLineId: Accounting.Identifier,
  bankLineId: Accounting.Identifier,
});

const Approved = Schema.Struct({
  ...Identity.fields,
  paymentApprovalId: Accounting.Identifier,
  allocationApprovalId: Accounting.Identifier,
});

const Committed = Schema.Struct({
  ...Identity.fields,
  planId: Accounting.Identifier,
  amountMinor: Accounting.MinorUnits,
  outstandingAfterMinor: Accounting.MinorUnits,
  postingReceipt: Accounting.ExecutionReceipt,
  allocationReceipt: Commerce.AllocationReceipt,
});

const Cancellation = Schema.Struct({
  ...Identity.fields,
  version: Schema.Literal(1),
  paymentPlan: Accounting.ChangeSet,
});

const Cancelled = Schema.Struct({
  ...Identity.fields,
  settlementReceiptId: Accounting.Identifier,
  postingReceipt: Accounting.ExecutionReceipt,
  outstandingAfterMinor: Accounting.MinorUnits,
});

const ReceiptView = Schema.Struct({
  receipt: Committed,
  state: Schema.Literals(["settled", "cancelled_unresolved_original_movement"]),
  sourceReusable: Schema.Literal(false),
  cancellation: Schema.NullOr(Cancelled),
});

const Discovery = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      kind: Schema.Literals(["settlement", "cancellation"]),
      receiptId: Schema.NullOr(Accounting.Identifier),
    }),
  ),
  next: Schema.NullOr(Accounting.Identifier),
});

const CancellationView = Schema.Struct({
  plan: Cancellation,
  receipt: Schema.NullOr(Cancelled),
});

const Rpc = Schema.Struct({
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.JsonObject),
});

const RpcReceipt = Schema.Struct({
  isError: Schema.Literal(false),
  structuredContent: Schema.Struct({ result: Committed }),
});

async function setup(
  amounts = ["-4000"],
  invoiceMinor = "10000",
  providerId: string | null = null,
) {
  const book = await fixture([{ id: "account_expense", code: "4010", name: "Synthetic expense" }]);
  const independent = await fixture();
  const reviewer = { ...book, actorId: independent.actorId, token: independent.token };
  const source = await evidence(book);
  const admin = await database();
  const releaseId = "synthetic_supplier_settlement_accrual_v1";

  const release = {
    id: releaseId,
    jurisdiction: "ZZ",
    family: "posting_eligibility",
    version: 1,
    checksum: `sha256:${"b".repeat(64)}`,
    applicability: {
      legalForms: [],
      accountingMethods: ["accrual"],
      vatRegistrations: [],
      payrollRegistrations: [],
    },
    requiredFactKinds: ["accounting_method"],
    requiredRoleKinds: ["bank", "commerce"],
    calculatorVersion: "synthetic-supplier-settlement-accrual-v1",
    rounding: { mode: "half_up", scale: 2 },
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    sourceManifest:
      "Independent synthetic accrual settlement oracle, no company or statutory claim",
    qualificationStatus: "reviewed",
    recordClasses: ["synthetic"],
  };

  try {
    await admin.query(
      "insert into openerp_auth.\"user\"(id,name,email) values($1,'Synthetic reviewer',$2) on conflict(id) do nothing",
      [reviewer.actorId, `${reviewer.actorId}@e2e.invalid`],
    );
    await admin.query(
      "insert into openerp.identity_admissions(actor_id,provider_id,subject,enabled) values($1,'e2e-supplier',$1,true)",
      [reviewer.actorId],
    );
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, reviewer.actorId],
    );
    await admin.query(
      "insert into openerp.rule_releases(id,jurisdiction,family,version,checksum,body) values($1,'ZZ','posting_eligibility',1,$2,$3) on conflict(id) do nothing",
      [releaseId, release.checksum, release],
    );
  } finally {
    await admin.end();
  }

  const facts: Array<typeof Profiles.FactRevision.Type> = [];

  for (const declaration of [
    { factKind: "jurisdiction", value: { state: "known", value: "ZZ" } },
    { factKind: "accounting_method", value: { state: "known", value: "accrual" } },
  ]) {
    const fact = await post(
      book,
      "/company-facts",
      {
        ...declaration,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        supersedesId: null,
        evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
        note: "Synthetic confirmed fact",
      },
      Profiles.FactRevision,
    );

    facts.push(fact);

    await post(
      reviewer,
      `/company-facts/${fact.id}/reviews`,
      {
        factRevisionId: fact.id,
        expectedDigest: fact.digest,
        result: "confirmed",
        rationale: "Independent synthetic review",
      },
      Profiles.FactReview,
    );
  }

  for (const [roleKind, accountId] of [
    ["bank", "account_bank"],
    ["commerce", "account_clearing"],
  ]) {
    await post(
      book,
      "/company-role-bindings",
      {
        roleKind,
        accountId,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        supersedesId: null,
        reviewer: reviewer.actorId,
        evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
        note: "Synthetic reviewed role",
      },
      Profiles.RoleBinding,
    );
  }

  const supplier = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "supplier",
      displayName: "Synthetic settlement supplier",
      evidenceId: source.id,
      reason: "Independent settlement fixture",
    },
    Commerce.CounterpartyRevision,
  );

  const identity = {
    legalName: "Synthetic identity",
    registrationId: "5560000000",
    taxId: null,
    address: "Synthetic street 1",
    countryCode: "SE",
    evidenceId: source.id,
  };

  const draft = await createDraft(book, {
    title: "Synthetic accrued purchase",
    counterpartyId: supplier.id,
    counterpartyRevision: supplier.revision,
    supplier: identity,
    buyer: identity,
    sourceEvidenceId: source.id,
    supplierDocumentNumber: `SETTLEMENT-${key()}`,
    currency: "SEK",
    currencyScale: 2,
    documentDate: "2026-09-22",
    supplyDate: "2026-09-22",
    dueDate: "2026-10-22",
    paymentTerms: "30 days",
    sourceTotalMinor: invoiceMinor,
    lines: [
      {
        id: "line_purchase",
        description: "Synthetic service",
        quantity: "1",
        unitPriceMinor: invoiceMinor,
        baseMinor: invoiceMinor,
        discountMinor: "0",
        chargeMinor: "0",
        taxMinor: "0",
        taxDescription: "Synthetic zero tax",
        taxEvidenceId: source.id,
        sourceGrossMinor: invoiceMinor,
      },
    ],
  });

  const review = await post(
    book,
    "/commerce/supplier-acceptance-reviews",
    {
      profile: "synthetic-gross-cost-supplier-v1",
      draftId: draft.id,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      controlAccountId: "account_clearing",
      debitAccountId: "account_expense",
      accountingPeriodId: "period_2026",
      series: "A",
      reason: "Synthetic already accrued invoice",
      acknowledgeSyntheticOnly: true,
    },
    Acceptance.SupplierAcceptanceReview,
  );

  const acceptanceInput = { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true };

  const approval = await post(
    book,
    `/commerce/supplier-acceptance-reviews/${review.id}/approvals`,
    acceptanceInput,
    Acceptance.SupplierAcceptanceApproval,
  );

  const acceptance = await post(
    book,
    `/commerce/supplier-acceptance-reviews/${review.id}/execute`,
    { ...acceptanceInput, approvalId: approval.id },
    Acceptance.SupplierAcceptanceReceipt,
  );

  const declaration = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "synthetic_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    openingMinor: "0",
    closingMinor: amounts.reduce((sum, value) => sum + BigInt(value), 0n).toString(),
    completeness: { declaredComplete: true, basis: "Complete synthetic September source" },
    rows: amounts.map((amountMinor, index) => ({
      rowOrdinal: index + 1,
      providerId,
      date: "2026-09-23",
      description: "Synthetic supplier payment",
      amountMinor,
    })),
  };

  const bankEvidence = await post(
    book,
    "/evidence",
    {
      title: "Synthetic original bank source",
      content: JSON.stringify(declaration),
      mediaType: "application/json",
      origin: "Independent settlement fixture",
    },
    Accounting.Evidence,
  );

  const statementInput = { ...declaration, evidenceId: bankEvidence.id, existingMatches: [] };

  const statement = await post(
    book,
    "/bank-statements",
    statementInput,
    Bank.StatementImportReceipt,
  );

  const input = {
    invoiceId: acceptance.registerInvoiceId,
    statementId: statement.statement.id,
    rowOrdinal: 1,
    rationale: "Observed whole synthetic supplier debit",
    evidence: { evidenceId: bankEvidence.id, sha256: bankEvidence.sha256 },
  };

  return { book, reviewer, acceptance, bankEvidence, statement, statementInput, input, facts };
}

async function financial(book: BookFixture) {
  const admin = await database();

  try {
    const result = await admin.query(
      `select
      (select coalesce(sum(debit_minor-credit_minor),0)::text from openerp.journal_lines where book_id=$1 and account_id='account_bank') as bank,
      (select coalesce(sum(debit_minor-credit_minor),0)::text from openerp.journal_lines where book_id=$1 and account_id='account_expense') as expense,
      (select coalesce(sum(credit_minor-debit_minor),0)::text from openerp.journal_lines where book_id=$1 and account_id='account_clearing') as payable,
      (select count(*)::int from openerp.vouchers where book_id=$1) as vouchers,
      (select count(*)::int from openerp.journal_lines where book_id=$1) as lines,
      (select count(*)::int from openerp.bank_matches where book_id=$1) as raw_matches,
      (select count(*)::int from openerp.bank_active_matches where book_id=$1) as active_matches,
      (select count(*)::int from openerp.commerce_allocation_legs where book_id=$1) as legs,
      (select count(*)::int from openerp.commerce_allocation_reversals where book_id=$1) as allocation_reversals,
      (select count(*)::int from openerp.bank_match_reversals where book_id=$1) as match_reversals`,
      [book.bookId],
    );

    return { ...result.rows[0], persisted: await persisted(book) };
  } finally {
    await admin.end();
  }
}

async function owned(book: BookFixture) {
  const admin = await database();

  try {
    const result = await admin.query(
      `select
      (select count(*)::int from openerp.supplier_settlement_source_claims where book_id=$1) as claims,
      (select count(*)::int from openerp.supplier_settlement_receipts where book_id=$1) as receipts,
      (select count(*)::int from openerp.supplier_settlement_cancellation_receipts where book_id=$1) as cancellations`,
      [book.bookId],
    );

    return result.rows[0];
  } finally {
    await admin.end();
  }
}

async function prepared(setupResult: Awaited<ReturnType<typeof setup>>, rowOrdinal = 1) {
  return post(setupResult.book, plans, { ...setupResult.input, rowOrdinal }, Prepared);
}

async function approved(
  setupResult: Awaited<ReturnType<typeof setup>>,
  plan: typeof Prepared.Type,
) {
  return post(
    setupResult.reviewer,
    `${plans}/${plan.id}/approvals`,
    { version: 1, digest: plan.digest },
    Approved,
  );
}

async function executeSettlement(
  book: BookFixture,
  plan: typeof Prepared.Type,
  approval: typeof Approved.Type,
  commandKey = key(),
) {
  return request(book, `${plans}/${plan.id}/execute`, {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify({ version: 1, digest: plan.digest, approvalId: approval.id }),
  });
}

async function mcp(book: BookFixture, name: string, args: Schema.JsonObject) {
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
      params: { name, arguments: args },
    }),
  });

  expect(response.status).toBe(200);

  return Schema.decodeUnknownSync(Rpc)(await response.json());
}

async function cancellation(
  setupResult: Awaited<ReturnType<typeof setup>>,
  receipt: typeof Committed.Type,
) {
  const plan = await post(
    setupResult.book,
    cancellations,
    {
      settlementReceiptId: receipt.id,
      reason: "Full latest open-period cancellation",
      evidence: setupResult.input.evidence,
    },
    Cancellation,
  );

  const approval = await post(
    setupResult.reviewer,
    `${cancellations}/${plan.id}/approvals`,
    { version: 1, digest: plan.digest },
    Identity,
  );

  return { plan, approval, input: { version: 1, digest: plan.digest, approvalId: approval.id } };
}

test("supplier accrual owner posts4000 once, cancels exactly and retains unresolved original cash through REST and MCP", async () => {
  const data = await setup();
  const trace: Array<Schema.JsonObject> = [];

  try {
    const baseline = await financial(data.book);
    expect(baseline).toMatchObject({
      bank: "0",
      expense: "10000",
      payable: "10000",
      vouchers: 1,
      lines: 2,
    });
    const plan = await prepared(data);
    trace.push({ stage: "prepared", planId: plan.id, digest: plan.digest });
    expect(plan.amountMinor).toBe("4000");
    expect(plan.pendingAllocation.payment).toMatchObject({
      voucherId: plan.reservedVoucherId,
      lineId: plan.controlLineId,
      amountMinor: "4000",
      allocatedMinor: "0",
      remainingMinor: "4000",
      capacityVersion: "0",
    });
    expect(plan.pendingAllocation.cashEffect).toBeUndefined();
    expect(plan.pendingAllocation.legs).toHaveLength(1);
    expect(plan.pendingAllocation.legs[0]).toMatchObject({
      outstandingBeforeMinor: "10000",
      amountMinor: "4000",
      outstandingAfterMinor: "6000",
    });
    expect(await financial(data.book)).toEqual(baseline);
    const approval = await approved(data, plan);
    expect(await financial(data.book)).toEqual(baseline);
    const commandKey = key();

    const args = {
      scope: { entityId: data.book.entityId, bookId: data.book.bookId },
      planId: plan.id,
      idempotencyKey: commandKey,
      input: { version: 1, digest: plan.digest, approvalId: approval.id },
    };

    const receipt = Schema.decodeUnknownSync(RpcReceipt)(
      (await mcp(data.book, "purchases_execute_supplier_settlement", args)).result,
    ).structuredContent.result;

    expect(receipt).toMatchObject({
      amountMinor: "4000",
      outstandingAfterMinor: "6000",
      planId: plan.id,
    });
    expect(receipt.postingReceipt.voucherId).toBe(plan.reservedVoucherId);
    expect(receipt.allocationReceipt).toMatchObject({
      planId: plan.pendingAllocation.id,
      totalMinor: "4000",
      paymentRemainingMinor: "0",
    });
    const paid = await financial(data.book);
    expect(paid).toMatchObject({
      bank: "-4000",
      expense: "10000",
      payable: "6000",
      vouchers: 2,
      lines: 4,
      raw_matches: 1,
      active_matches: 1,
      legs: 1,
      allocation_reversals: 0,
      match_reversals: 0,
    });
    expect(await owned(data.book)).toEqual({ claims: 1, receipts: 1, cancellations: 0 });

    for (const [endpoint, input] of [
      [
        `/vouchers/${receipt.postingReceipt.voucherId}/correction-proposals`,
        {
          accountingPeriodId: "period_2026",
          postingDate: "2026-09-23",
          rationale: "Generic inverse forbidden",
        },
      ],
      [
        "/commerce/allocation-reversal-plans",
        { receiptId: receipt.allocationReceipt.id, reason: "Generic unallocation forbidden" },
      ],
      [
        "/bank-match-reversal-plans",
        {
          target: { kind: "exact_match", statementId: data.input.statementId, rowOrdinal: 1 },
          reason: "Generic unmatch forbidden",
        },
      ],
    ] as const) {
      await failure(
        await request(data.book, endpoint, { method: "POST", body: JSON.stringify(input) }),
        403,
        "ApprovalRequired",
      );
    }

    expect(
      Schema.decodeUnknownSync(RpcReceipt)(
        (await mcp(data.book, "purchases_execute_supplier_settlement", args)).result,
      ).structuredContent.result,
    ).toEqual(receipt);
    expect(await financial(data.book)).toEqual(paid);
    await failure(await executeSettlement(data.book, plan, approval), 409, "AlreadyPosted");

    const importedAgain = await post(
      data.book,
      "/bank-statements",
      data.statementInput,
      Bank.StatementImportReceipt,
    );

    expect(importedAgain.statement.id).toBe(data.statement.statement.id);
    const corrected = await cancellation(data, receipt);
    const cancelKey = key();

    const cancelRequest = {
      method: "POST",
      headers: { "idempotency-key": cancelKey },
      body: JSON.stringify(corrected.input),
    };

    const inverse = await decoded(
      await request(data.book, `${cancellations}/${corrected.plan.id}/execute`, cancelRequest),
      Cancelled,
    );

    expect(inverse.outstandingAfterMinor).toBe("10000");
    expect(inverse.settlementReceiptId).toBe(receipt.id);

    expect(
      await decoded(
        await request(data.book, `${cancellations}/${corrected.plan.id}`),
        CancellationView,
      ),
    ).toMatchObject({ plan: { id: corrected.plan.id }, receipt: inverse });

    const discovery = await decoded(
      await request(data.book, "/purchases/supplier-settlements"),
      Discovery,
    );

    expect(discovery.items).toEqual([
      { id: corrected.plan.id, kind: "cancellation", receiptId: inverse.id },
      { id: plan.id, kind: "settlement", receiptId: receipt.id },
    ]);
    expect(discovery.next).toBeNull();

    const after = await financial(data.book);
    expect(after).toMatchObject({
      bank: "0",
      expense: "10000",
      payable: "10000",
      vouchers: 3,
      lines: 6,
      raw_matches: 1,
      active_matches: 0,
      legs: 1,
      allocation_reversals: 1,
      match_reversals: 1,
    });
    expect(await owned(data.book)).toEqual({ claims: 1, receipts: 1, cancellations: 1 });
    expect(
      await decoded(
        await request(data.book, `${cancellations}/${corrected.plan.id}/execute`, cancelRequest),
        Cancelled,
      ),
    ).toEqual(inverse);
    expect(await financial(data.book)).toEqual(after);

    const view = await decoded(
      await request(data.book, `/purchases/supplier-settlement-receipts/${receipt.id}`),
      ReceiptView,
    );

    expect(view).toMatchObject({
      state: "cancelled_unresolved_original_movement",
      sourceReusable: false,
      cancellation: inverse,
    });

    const report = await post(
      data.book,
      "/bank-reconciliations",
      { accountId: "account_bank", startsOn: "2026-09-01", endsOn: "2026-09-30" },
      Bank.BankReconciliation,
    );

    expect(report).toMatchObject({
      status: "differences",
      bankClosingMinor: "-4000",
      ledgerClosingMinor: "0",
      closingDifferenceMinor: "-4000",
    });
    expect(report.unmatchedSource).toHaveLength(1);

    const claimedTarget = {
      statementId: data.input.statementId,
      rowOrdinal: 1,
      voucherId: receipt.postingReceipt.voucherId,
      lineId: plan.bankLineId,
    };

    for (const [endpoint, input] of [
      ["/bank-matches", claimedTarget],
      [
        "/bank-allocation-plans",
        {
          accountId: "account_bank",
          reason: "Claimed source cannot be reused",
          ambiguityAcknowledged: true,
          legs: [{ ...claimedTarget, amountMinor: "-4000" }],
        },
      ],
    ] as const) {
      await failure(
        await request(data.book, endpoint, { method: "POST", body: JSON.stringify(input) }),
        403,
        "ApprovalRequired",
      );
    }

    await failure(
      await request(data.book, plans, { method: "POST", body: JSON.stringify(data.input) }),
      409,
      "AlreadyPosted",
    );
    trace.push({
      stage: "complete",
      originalReceiptId: receipt.id,
      correctionReceiptId: inverse.id,
      bank: "0",
      expense: "10000",
      payable: "10000",
      reconciliationDifference: "-4000",
    });
  } finally {
    await writeFile(
      join(environment().artifacts, "supplier-settlement-accrual.json"),
      JSON.stringify(
        {
          literalOracle: {
            original: "10000",
            payment: "4000",
            residual: "6000",
            restored: "10000",
            unresolvedSource: "-4000",
            newVAT: "0",
          },
          bookId: data.book.bookId,
          trace,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
});

test("supplier owner refuses authority, strict input, stale basis and independently mutated native children", async () => {
  const data = await setup();
  const before = await financial(data.book);

  const extra = await request(data.book, plans, {
    method: "POST",
    body: JSON.stringify({ ...data.input, amountMinor: "1", voucherId: "invented" }),
  });

  expect(extra.status).toBe(400);
  const foreign = await fixture();

  await failure(
    await request(foreign, plans, { method: "POST", body: JSON.stringify(data.input) }),
    404,
    "NotFound",
  );
  const plan = await prepared(data);
  await failure(
    await request(data.book, `${plans}/${plan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: plan.digest }),
    }),
    403,
    "Forbidden",
  );
  await failure(
    await request({ ...data.book, token: data.book.agentToken }, `${plans}/${plan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: plan.digest }),
    }),
    403,
    "Forbidden",
  );
  await failure(
    await request(data.book, `/change-sets/${plan.paymentPlan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: plan.paymentPlan.planDigest }),
    }),
    403,
    "ApprovalRequired",
  );
  await failure(
    await request(data.book, `/commerce/allocation-plans/${plan.pendingAllocation.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: plan.pendingAllocation.digest }),
    }),
    403,
    "ApprovalRequired",
  );
  const approval = await approved(data, plan);
  const admin = await database();

  try {
    await admin.query("update openerp.identity_admissions set enabled=false where actor_id=$1", [
      data.reviewer.actorId,
    ]);
  } finally {
    await admin.end();
  }

  await failure(await executeSettlement(data.book, plan, approval), 403, "ApprovalRequired");
  expect(await financial(data.book)).toEqual(before);
});

test("supplier missing reviewer admission fails closed without effects", async () => {
  const data = await setup();
  const plan = await prepared(data);
  const approval = await approved(data, plan);
  const before = await financial(data.book);
  const admin = await database();

  try {
    const removed = await admin.query("delete from openerp.identity_admissions where actor_id=$1", [
      data.reviewer.actorId,
    ]);

    expect(removed.rowCount).toBe(1);
  } finally {
    await admin.end();
  }

  await failure(await executeSettlement(data.book, plan, approval), 403, "ApprovalRequired");
  expect(await financial(data.book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "supplier-missing-authority.json"),
    JSON.stringify(
      { reviewer: data.reviewer.actorId, before, after: await financial(data.book) },
      null,
      2,
    ),
  );
});

test("supplier preparation refuses invalid oversized and unsupported retained observations", async () => {
  const observations = [];

  for (const [amount, providerId, status, code] of [
    ["4000", null, 422, "InvalidJournal"],
    ["-11000", null, 409, "StaleDependency"],
    ["-4000", "synthetic_provider_transaction", 422, "UnsupportedProfile"],
  ] as const) {
    const data = await setup([amount], "10000", providerId);
    const before = await financial(data.book);

    await failure(
      await request(data.book, plans, { method: "POST", body: JSON.stringify(data.input) }),
      status,
      code,
    );
    const after = await financial(data.book);

    expect(after).toEqual(before);
    expect(await owned(data.book)).toEqual({ claims: 0, receipts: 0, cancellations: 0 });
    observations.push({ amount, providerId, status, code, before, after });
  }

  await writeFile(
    join(environment().artifacts, "supplier-source-refusals.json"),
    JSON.stringify(observations, null, 2),
  );
});

test("supplier sealed approval becomes stale when reviewed accounting qualification changes", async () => {
  const data = await setup();
  const plan = await prepared(data);
  const approval = await approved(data, plan);
  const original = data.facts.find((fact) => fact.factKind === "accounting_method");

  if (!original) throw new Error("Synthetic accounting method missing");

  const replacement = await post(
    data.book,
    "/company-facts",
    {
      factKind: "accounting_method",
      value: { state: "known", value: "cash" },
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      supersedesId: original.id,
      evidence: [{ evidenceId: data.bankEvidence.id, sha256: data.bankEvidence.sha256 }],
      note: "Independent qualification change",
    },
    Profiles.FactRevision,
  );

  await post(
    data.reviewer,
    `/company-facts/${replacement.id}/reviews`,
    {
      factRevisionId: replacement.id,
      expectedDigest: replacement.digest,
      result: "confirmed",
      rationale: "Independent method change review",
    },
    Profiles.FactReview,
  );
  const before = await financial(data.book);

  await failure(await executeSettlement(data.book, plan, approval), 409, "StaleDependency");
  await failure(
    await request(data.book, plans, { method: "POST", body: JSON.stringify(data.input) }),
    422,
    "UnsupportedProfile",
  );
  expect(await financial(data.book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "supplier-qualification-change.json"),
    JSON.stringify(
      {
        originalFactId: original.id,
        replacementFactId: replacement.id,
        before,
        after: await financial(data.book),
      },
      null,
      2,
    ),
  );
});

test("supplier execution refuses changed account writer source and locked period bases", async () => {
  const observations = [];

  for (const [kind, sql, code] of [
    [
      "account",
      "update openerp.accounts set version=version+1 where book_id=$1 and id='account_bank'",
      "StaleDependency",
    ],
    [
      "writer",
      "update openerp.books set writer_epoch=writer_epoch+1 where id=$1",
      "StaleDependency",
    ],
    [
      "source",
      "update openerp.bank_sources set revision=revision+1 where book_id=$1",
      "StaleDependency",
    ],
    [
      "period",
      "update openerp.periods set locked=true,version=version+1 where book_id=$1 and id='period_2026'",
      "PeriodLocked",
    ],
  ] as const) {
    const data = await setup();
    const plan = await prepared(data);
    const approval = await approved(data, plan);
    const admin = await database();

    try {
      const mutation = await admin.query(sql, [data.book.bookId]);

      expect(mutation.rowCount).toBe(1);
    } finally {
      await admin.end();
    }

    const before = await financial(data.book);

    await failure(await executeSettlement(data.book, plan, approval), 409, code);
    const after = await financial(data.book);

    expect(after).toEqual(before);
    observations.push({ kind, code, before, after });
  }

  await writeFile(
    join(environment().artifacts, "supplier-stale-bases.json"),
    JSON.stringify(observations, null, 2),
  );
});

test("supplier execution locks reviewer authority before the book and observes committed disable", async () => {
  const data = await setup();
  const plan = await prepared(data);
  const approval = await approved(data, plan);
  const before = await financial(data.book);
  const holder = await database();
  const observer = await database();
  let executing: Promise<Response> | undefined;

  try {
    await holder.query("begin");
    const held = await holder.query<{ pid: number }>("select pg_backend_pid() as pid");
    const holderPid = held.rows[0]?.pid;

    expect(holderPid).toBeDefined();
    await holder.query("update openerp.identity_admissions set enabled=false where actor_id=$1", [
      data.reviewer.actorId,
    ]);
    executing = executeSettlement(data.book, plan, approval);
    const deadline = Date.now() + 5000;
    let blocked: Array<{ pid: number; query: string }> = [];

    while (blocked.length === 0 && Date.now() < deadline) {
      blocked = (
        await observer.query<{ pid: number; query: string }>(
          "select pid,query from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and query like '%identity_admissions%'",
          [holderPid],
        )
      ).rows;
    }

    expect(blocked).toHaveLength(1);
    await observer.query("begin");

    const book = await observer.query(
      "select id from openerp.books where id=$1 for update nowait",
      [data.book.bookId],
    );

    expect(book.rowCount).toBe(1);
    await observer.query("rollback");
    await holder.query("commit");
    await failure(await executing, 403, "ApprovalRequired");
    expect(await financial(data.book)).toEqual(before);
    await writeFile(
      join(environment().artifacts, "supplier-authority-lock-order.json"),
      JSON.stringify(
        {
          holderPid,
          blocked,
          bookLockAvailableWhileReviewerBlocked: true,
          before,
          after: await financial(data.book),
        },
        null,
        2,
      ),
    );
  } finally {
    await observer.query("rollback");
    await holder.query("rollback");
    await executing;
    await observer.end();
    await holder.end();
  }
});

test("supplier source and invoice capacity races have one financial winner and preserve distinct equal rows", async () => {
  const data = await setup(["-4000", "-4000"], "6000");
  const first = await prepared(data);
  const same = await prepared(data);
  const other = await prepared(data, 2);
  const firstApproval = await approved(data, first);
  const sameApproval = await approved(data, same);
  const otherApproval = await approved(data, other);

  const responses = await Promise.all([
    executeSettlement(data.book, first, firstApproval),
    executeSettlement(data.book, same, sameApproval),
    executeSettlement(data.book, other, otherApproval),
  ]);

  expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
  expect(responses.filter((response) => response.status === 409)).toHaveLength(2);
  expect(await financial(data.book)).toMatchObject({
    bank: "-4000",
    expense: "6000",
    payable: "2000",
    vouchers: 2,
    active_matches: 1,
    legs: 1,
  });
  expect(await owned(data.book)).toEqual({ claims: 1, receipts: 1, cancellations: 0 });
  const capacity = await setup(["-4000", "-4000"], "10000");

  for (const row of [1, 2]) {
    const plan = await prepared(capacity, row);
    const approval = await approved(capacity, plan);
    await decoded(await executeSettlement(capacity.book, plan, approval), Committed);
  }

  expect(await financial(capacity.book)).toMatchObject({
    bank: "-8000",
    expense: "10000",
    payable: "2000",
    vouchers: 3,
    active_matches: 2,
    legs: 2,
  });
  expect(await owned(capacity.book)).toEqual({ claims: 2, receipts: 2, cancellations: 0 });
});

test("supplier owner rolls back native posting, matching, allocation and cancellation before retaining parent receipts", async () => {
  const data = await setup();
  const plan = await prepared(data);
  const approval = await approved(data, plan);
  const before = await financial(data.book);
  const admin = await database();
  const suffix = createHash("sha256").update(data.book.bookId).digest("hex").slice(0, 12);
  const functionName = `supplier_fault_${suffix}`;

  async function install(table: string) {
    await admin.query(
      `create function openerp.${functionName}() returns trigger language plpgsql as $$ begin if new.book_id = '${data.book.bookId}' then raise exception 'Independent E2E financial boundary rejection'; end if; return new; end $$`,
    );
    await admin.query(
      `create trigger ${functionName} before insert on openerp.${table} for each row execute function openerp.${functionName}()`,
    );
  }

  async function remove(table: string) {
    await admin.query(`drop trigger ${functionName} on openerp.${table}`);
    await admin.query(`drop function openerp.${functionName}()`);
  }

  try {
    for (const table of [
      "bank_matches",
      "commerce_allocation_legs",
      "supplier_settlement_receipts",
    ]) {
      await install(table);

      try {
        expect((await executeSettlement(data.book, plan, approval)).status).toBe(500);
        expect(await financial(data.book)).toEqual(before);
        expect(await owned(data.book)).toEqual({ claims: 0, receipts: 0, cancellations: 0 });
      } finally {
        await remove(table);
      }
    }

    const receipt = await decoded(await executeSettlement(data.book, plan, approval), Committed);
    const corrected = await cancellation(data, receipt);
    const paid = await financial(data.book);

    for (const table of ["bank_match_reversals", "supplier_settlement_cancellation_receipts"]) {
      await install(table);

      try {
        const response = await request(data.book, `${cancellations}/${corrected.plan.id}/execute`, {
          method: "POST",
          body: JSON.stringify(corrected.input),
        });

        expect(response.status).toBe(500);
        expect(await financial(data.book)).toEqual(paid);
        expect(await owned(data.book)).toEqual({ claims: 1, receipts: 1, cancellations: 0 });
      } finally {
        await remove(table);
      }
    }

    const recovered = await decoded(
      await request(data.book, `${cancellations}/${corrected.plan.id}/execute`, {
        method: "POST",
        body: JSON.stringify(corrected.input),
      }),
      Cancelled,
    );

    expect(recovered.outstandingAfterMinor).toBe("10000");
    expect(await owned(data.book)).toEqual({ claims: 1, receipts: 1, cancellations: 1 });
  } finally {
    await admin.end();
  }
});

test("supplier integrity retains immutable scoped claims and denies runtime history mutation", async () => {
  const data = await setup();
  const plan = await prepared(data);
  const approval = await approved(data, plan);
  await decoded(await executeSettlement(data.book, plan, approval), Committed);
  const admin = await database();
  const runtime = new Client({ connectionString: environment().runtimeUrl });
  await runtime.connect();

  try {
    await expect(
      admin.query(
        "insert into openerp.supplier_settlement_source_claims select * from openerp.supplier_settlement_source_claims where book_id=$1",
        [data.book.bookId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      admin.query(
        "update openerp.supplier_settlement_source_claims set book_id=book_id where book_id=$1",
        [data.book.bookId],
      ),
    ).rejects.toMatchObject({ code: "P0001", detail: "Forbidden" });
    await expect(
      runtime.query(
        "update openerp.supplier_settlement_source_claims set book_id=book_id where book_id=$1",
        [data.book.bookId],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime.query("delete from openerp.supplier_settlement_receipts where book_id=$1", [
        data.book.bookId,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime.query("truncate openerp.supplier_settlement_source_claims"),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await owned(data.book)).toEqual({ claims: 1, receipts: 1, cancellations: 0 });
  } finally {
    await runtime.end();
    await admin.end();
  }
});

test("supplier scoped discovery continues beyond one page without losing retained plans", async () => {
  const data = await setup();
  const ids: string[] = [];

  for (let ordinal = 0; ordinal < 26; ordinal += 1) {
    ids.push((await prepared(data)).id);
  }

  const before = await financial(data.book);

  const first = await decoded(
    await request(data.book, "/purchases/supplier-settlements"),
    Discovery,
  );

  expect(first.items).toHaveLength(25);
  expect(first.next).toBe(first.items[24]?.id);

  const second = await decoded(
    await request(data.book, `/purchases/supplier-settlements?after=${first.next}`),
    Discovery,
  );

  expect(second.items).toHaveLength(1);
  expect(second.next).toBeNull();
  expect([...first.items, ...second.items].map((item) => item.id)).toEqual(ids.sort());
  expect([...first.items, ...second.items].every((item) => item.receiptId === null)).toBe(true);
  const foreign = await fixture();
  expect(
    await decoded(await request(foreign, "/purchases/supplier-settlements"), Discovery),
  ).toEqual({ items: [], next: null });

  const rpc = await mcp(data.book, "purchases_list_supplier_settlements", {
    scope: { entityId: data.book.entityId, bookId: data.book.bookId },
    after: first.next,
  });

  expect(
    Schema.decodeUnknownSync(
      Schema.Struct({
        isError: Schema.Literal(false),
        structuredContent: Schema.Struct({ result: Discovery }),
      }),
    )(rpc.result).structuredContent.result,
  ).toEqual(second);
  expect(await financial(data.book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "supplier-settlement-discovery.json"),
    JSON.stringify(
      {
        expectedPlans: 26,
        pages: [first, second],
        financialBefore: before,
        financialAfter: await financial(data.book),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
});

test("supplier cancellation refuses retained report consumption without financial effects", async () => {
  const data = await setup();
  const plan = await prepared(data);
  const approval = await approved(data, plan);
  const receipt = await decoded(await executeSettlement(data.book, plan, approval), Committed);

  await post(
    data.book,
    "/report-snapshots",
    {
      kind: "trial_balance_v1",
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
    },
    Schema.Struct({ id: Accounting.Identifier }),
  );
  const before = await financial(data.book);

  await failure(
    await request(data.book, cancellations, {
      method: "POST",
      body: JSON.stringify({
        settlementReceiptId: receipt.id,
        reason: "Consumed settlement cannot be cancelled",
        evidence: data.input.evidence,
      }),
    }),
    409,
    "StaleDependency",
  );
  expect(await financial(data.book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "supplier-report-consumption.json"),
    JSON.stringify({ receiptId: receipt.id, before, after: await financial(data.book) }, null, 2),
  );
});

test("supplier cancellation revalidates report consumption after approval", async () => {
  const data = await setup();
  const plan = await prepared(data);
  const approval = await approved(data, plan);
  const receipt = await decoded(await executeSettlement(data.book, plan, approval), Committed);
  const corrected = await cancellation(data, receipt);

  await post(
    data.book,
    "/report-snapshots",
    {
      kind: "trial_balance_v1",
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
    },
    Schema.Struct({ id: Accounting.Identifier }),
  );
  const before = await financial(data.book);

  await failure(
    await request(data.book, `${cancellations}/${corrected.plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify(corrected.input),
    }),
    409,
    "StaleDependency",
  );
  expect(await financial(data.book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "supplier-late-report-consumption.json"),
    JSON.stringify(
      { planId: corrected.plan.id, before, after: await financial(data.book) },
      null,
      2,
    ),
  );
});

test("supplier cancellation approval revocation refuses execution and permits fresh review", async () => {
  const data = await setup();
  const plan = await prepared(data);
  const approval = await approved(data, plan);
  const receipt = await decoded(await executeSettlement(data.book, plan, approval), Committed);
  const corrected = await cancellation(data, receipt);
  const before = await financial(data.book);

  const revoked = await post(
    data.reviewer,
    `/purchases/supplier-settlement-cancellation-approvals/${corrected.approval.id}/revoke`,
    { reason: "Withdraw cancellation permission" },
    Schema.Struct({ approvalId: Accounting.Identifier }),
  );

  expect(revoked.approvalId).toBe(corrected.approval.id);
  await failure(
    await request(data.book, `${cancellations}/${corrected.plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify(corrected.input),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await financial(data.book)).toEqual(before);

  const replacement = await post(
    data.reviewer,
    `${cancellations}/${corrected.plan.id}/approvals`,
    { version: 1, digest: corrected.plan.digest },
    Identity,
  );

  const inverse = await decoded(
    await request(data.book, `${cancellations}/${corrected.plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ ...corrected.input, approvalId: replacement.id }),
    }),
    Cancelled,
  );

  expect(inverse.outstandingAfterMinor).toBe("10000");

  const approvalHistory = await decoded(
    await request(data.book, `${cancellations}/${corrected.plan.id}/approvals`),
    Schema.Struct({
      items: Schema.Array(
        Schema.Struct({
          approval: Identity,
          revocation: Schema.NullOr(Schema.Struct({ approvalId: Accounting.Identifier })),
        }),
      ),
      next: Schema.NullOr(Accounting.Identifier),
    }),
  );

  expect(approvalHistory.items).toHaveLength(2);
  expect(
    approvalHistory.items.find((item) => item.approval.id === corrected.approval.id)?.revocation,
  ).toEqual(revoked);
  expect(
    approvalHistory.items.find((item) => item.approval.id === replacement.id)?.revocation,
  ).toBeNull();
  expect(approvalHistory.next).toBeNull();
  const afterCancellation = await financial(data.book);

  await failure(
    await request(data.book, `${cancellations}/${corrected.plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ ...corrected.input, approvalId: replacement.id }),
    }),
    409,
    "AlreadyPosted",
  );
  expect(await financial(data.book)).toEqual(afterCancellation);
  await writeFile(
    join(environment().artifacts, "supplier-cancellation-revocation.json"),
    JSON.stringify(
      { revoked, replacement, inverse, before, after: await financial(data.book) },
      null,
      2,
    ),
  );
});

test("supplier cancellation refuses a parent approval whose actor does not own the native approvals", async () => {
  const data = await setup();
  const plan = await prepared(data);
  const approval = await approved(data, plan);
  const receipt = await decoded(await executeSettlement(data.book, plan, approval), Committed);
  const corrected = await cancellation(data, receipt);
  const forgedId = `supplier_cancel_wrong_actor_${key()}`;
  const before = await financial(data.book);
  const admin = await database();

  try {
    const inserted = await admin.query(
      `insert into openerp.supplier_settlement_cancellation_approvals
      (book_id,id,plan_id,actor_id,payment_approval_id,allocation_approval_id,match_approval_id,body)
      select book_id,$3,plan_id,$4,payment_approval_id,allocation_approval_id,match_approval_id,
        jsonb_set(jsonb_set(body,'{id}',to_jsonb($3::text)),'{actorId}',to_jsonb($4::text))
      from openerp.supplier_settlement_cancellation_approvals where book_id=$1 and id=$2`,
      [data.book.bookId, corrected.approval.id, forgedId, data.book.actorId],
    );

    expect(inserted.rowCount).toBe(1);
  } finally {
    await admin.end();
  }

  await failure(
    await request(data.book, `${cancellations}/${corrected.plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ ...corrected.input, approvalId: forgedId }),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await financial(data.book)).toEqual(before);
  const expiryObservations = [];

  for (const expiresAt of ["2000-01-01T00:00:00Z", "not-a-date"]) {
    const expiredId = `supplier_cancel_expiry_${key()}`;
    const seed = await database();

    try {
      const inserted = await seed.query(
        `insert into openerp.supplier_settlement_cancellation_approvals
        (book_id,id,plan_id,actor_id,payment_approval_id,allocation_approval_id,match_approval_id,body)
        select book_id,$3,plan_id,actor_id,payment_approval_id,allocation_approval_id,match_approval_id,
          jsonb_set(jsonb_set(body,'{id}',to_jsonb($3::text)),'{expiresAt}',to_jsonb($4::text))
        from openerp.supplier_settlement_cancellation_approvals where book_id=$1 and id=$2`,
        [data.book.bookId, corrected.approval.id, expiredId, expiresAt],
      );

      expect(inserted.rowCount).toBe(1);
    } finally {
      await seed.end();
    }

    await failure(
      await request(data.book, `${cancellations}/${corrected.plan.id}/execute`, {
        method: "POST",
        body: JSON.stringify({ ...corrected.input, approvalId: expiredId }),
      }),
      403,
      "ApprovalRequired",
    );
    expect(await financial(data.book)).toEqual(before);
    expiryObservations.push({ expiredId, expiresAt });
  }

  await writeFile(
    join(environment().artifacts, "supplier-cancellation-approval-bindings.json"),
    JSON.stringify(
      { forgedId, expiryObservations, before, after: await financial(data.book) },
      null,
      2,
    ),
  );
});

test("supplier cancellation refuses invoice changes after settlement without financial effects", async () => {
  const data = await setup();
  const plan = await prepared(data);
  const approval = await approved(data, plan);
  const receipt = await decoded(await executeSettlement(data.book, plan, approval), Committed);

  const invoice = await decoded(
    await request(data.book, `/commerce/invoices/${data.input.invoiceId}`),
    Commerce.Invoice,
  );

  await post(
    data.book,
    `/commerce/invoices/${invoice.id}/revisions`,
    {
      expectedRevision: invoice.currentRevision.revision,
      dueOn: "2026-10-23",
      description: "Changed after settlement",
      evidenceId: data.bankEvidence.id,
      reason: "Independent cancellation boundary probe",
    },
    Commerce.Invoice,
  );
  const before = await financial(data.book);

  await failure(
    await request(data.book, cancellations, {
      method: "POST",
      body: JSON.stringify({
        settlementReceiptId: receipt.id,
        reason: "Cannot cancel changed invoice",
        evidence: data.input.evidence,
      }),
    }),
    409,
    "StaleDependency",
  );
  expect(await financial(data.book)).toEqual(before);
});

test("supplier pending owner retains prospective plans and independent approval without financial effects", async () => {
  const data = await setup();

  const PendingView = Schema.Struct({
    plan: Prepared,
    approval: Schema.NullOr(Approved),
    pendingBasisCurrent: Schema.Boolean,
    approvalUsable: Schema.Boolean,
    paymentPosted: Schema.Literal(false),
    executionAvailable: Schema.Boolean,
  });

  const before = await financial(data.book);
  const prepareKey = key();

  const prepareRequest = {
    method: "POST",
    headers: { "idempotency-key": prepareKey },
    body: JSON.stringify(data.input),
  };

  const plan = await decoded(await request(data.book, plans, prepareRequest), Prepared);
  expect(await decoded(await request(data.book, plans, prepareRequest), Prepared)).toEqual(plan);
  expect(plan.pendingAllocation.payment).toMatchObject({
    voucherId: plan.reservedVoucherId,
    lineId: plan.controlLineId,
    direction: "supplier",
    amountMinor: "4000",
    allocatedMinor: "0",
    remainingMinor: "4000",
    capacityVersion: "0",
  });
  expect(plan.pendingAllocation.legs[0]).toMatchObject({
    outstandingBeforeMinor: "10000",
    amountMinor: "4000",
    outstandingAfterMinor: "6000",
  });
  expect(plan.pendingAllocation.cashEffect).toBeUndefined();
  expect(await financial(data.book)).toEqual(before);
  expect(await decoded(await request(data.book, `${plans}/${plan.id}`), PendingView)).toMatchObject(
    {
      approval: null,
      pendingBasisCurrent: true,
      approvalUsable: false,
      paymentPosted: false,
      executionAvailable: false,
    },
  );

  const ordinaryView = await decoded(
    await request(data.book, `/commerce/allocation-plans/${plan.pendingAllocation.id}`),
    Commerce.AllocationView,
  );

  expect(ordinaryView.dependenciesCurrent).toBe(false);
  await failure(
    await request(data.book, `${plans}/${plan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: plan.digest }),
    }),
    403,
    "Forbidden",
  );
  const approveKey = key();

  const approveRequest = {
    method: "POST",
    headers: { "idempotency-key": approveKey },
    body: JSON.stringify({ version: 1, digest: plan.digest }),
  };

  const approval = await decoded(
    await request(data.reviewer, `${plans}/${plan.id}/approvals`, approveRequest),
    Approved,
  );

  expect(
    await decoded(
      await request(data.reviewer, `${plans}/${plan.id}/approvals`, approveRequest),
      Approved,
    ),
  ).toEqual(approval);
  expect(await decoded(await request(data.book, `${plans}/${plan.id}`), PendingView)).toMatchObject(
    { pendingBasisCurrent: true, approvalUsable: true, executionAvailable: true },
  );

  const generic = [
    [
      `/change-sets/${plan.paymentPlan.id}/approvals`,
      { version: 1, planDigest: plan.paymentPlan.planDigest },
    ],
    [
      `/change-sets/${plan.paymentPlan.id}/execute`,
      {
        version: 1,
        planDigest: plan.paymentPlan.planDigest,
        approvalId: approval.paymentApprovalId,
      },
    ],
    [
      `/commerce/allocation-plans/${plan.pendingAllocation.id}/approvals`,
      { version: 1, planDigest: plan.pendingAllocation.digest },
    ],
    [
      `/commerce/allocation-plans/${plan.pendingAllocation.id}/apply`,
      {
        version: 1,
        planDigest: plan.pendingAllocation.digest,
        approvalId: approval.allocationApprovalId,
      },
    ],
    [
      "/commerce/allocation-plans",
      {
        voucherId: plan.reservedVoucherId,
        lineId: plan.controlLineId,
        evidenceId: data.bankEvidence.id,
        rationale: "Cannot adopt reserved payment",
        allocations: [{ invoiceId: data.input.invoiceId, amountMinor: "4000" }],
      },
    ],
  ] as const;

  for (const [endpoint, input] of generic) {
    await failure(
      await request(data.book, endpoint, { method: "POST", body: JSON.stringify(input) }),
      403,
      "ApprovalRequired",
    );
  }

  const revokedKey = key();

  const revokeRequest = {
    method: "POST",
    headers: { "idempotency-key": revokedKey },
    body: JSON.stringify({ reason: "Independent withdrawal of pending approval" }),
  };

  const revoked = await request(
    data.reviewer,
    `/purchases/supplier-settlement-approvals/${approval.id}/revoke`,
    revokeRequest,
  );

  expect(revoked.status).toBe(200);
  const revokedBody = await revoked.text();
  expect(
    await (
      await request(
        data.reviewer,
        `/purchases/supplier-settlement-approvals/${approval.id}/revoke`,
        revokeRequest,
      )
    ).text(),
  ).toBe(revokedBody);
  expect(await decoded(await request(data.book, `${plans}/${plan.id}`), PendingView)).toMatchObject(
    { pendingBasisCurrent: true, approvalUsable: false },
  );
  await failure(await executeSettlement(data.book, plan, approval), 403, "ApprovalRequired");

  const invoice = await decoded(
    await request(data.book, `/commerce/invoices/${data.input.invoiceId}`),
    Commerce.Invoice,
  );

  await post(
    data.book,
    `/commerce/invoices/${invoice.id}/revisions`,
    {
      expectedRevision: invoice.currentRevision.revision,
      dueOn: "2026-10-23",
      description: "Independent stale invoice revision",
      evidenceId: data.bankEvidence.id,
      reason: "Change retained invoice while review open",
    },
    Commerce.Invoice,
  );
  expect(await decoded(await request(data.book, `${plans}/${plan.id}`), PendingView)).toMatchObject(
    { pendingBasisCurrent: false, approvalUsable: false },
  );
  await failure(await executeSettlement(data.book, plan, approval), 409, "StaleDependency");
  await failure(
    await request(data.reviewer, `${plans}/${plan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: plan.digest }),
    }),
    409,
    "StaleDependency",
  );
  expect(await financial(data.book)).toEqual(before);
  const admin = await database();

  try {
    await admin.query(
      "insert into openerp_auth.\"user\"(id,name,email) values($1,'Synthetic reviewer',$2) on conflict(id) do nothing",
      [data.reviewer.actorId, `${data.reviewer.actorId}@e2e.invalid`],
    );
    await admin.query(
      "insert into openerp.identity_admissions(actor_id,provider_id,subject,enabled) values($1,'e2e-pending',$1,false) on conflict(actor_id) do update set enabled=false",
      [data.reviewer.actorId],
    );
  } finally {
    await admin.end();
  }

  await failure(
    await request(data.reviewer, `${plans}/${plan.id}/approvals`, approveRequest),
    401,
    "Unauthorized",
  );
  const foreign = await fixture();
  await failure(await request(foreign, `${plans}/${plan.id}`), 404, "NotFound");

  const tools = await fetch(`${environment().baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${data.book.agentToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });

  const catalog = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
    }),
  )(await tools.json());

  const names = catalog.result.tools.map((tool) => tool.name);
  expect(names).toContain("purchases_prepare_supplier_settlement");
  expect(names).toContain("purchases_get_supplier_settlement");
  expect(names).toContain("purchases_execute_supplier_settlement");
  expect(names).toContain("purchases_prepare_supplier_settlement_cancellation");
  expect(names.filter((name) => /^purchases_(approve|revoke)_/.test(name))).toEqual([]);
  await writeFile(
    join(environment().artifacts, "supplier-settlement-pending.json"),
    JSON.stringify(
      {
        state: "pending_only",
        sourceReusable: false,
        paymentPosted: false,
        executionAvailable: false,
        planId: plan.id,
        reservedVoucherId: plan.reservedVoucherId,
        paymentChildId: plan.paymentPlan.id,
        allocationChildId: plan.pendingAllocation.id,
        approvalId: approval.id,
        literalOracle: {
          accrued: "10000",
          planned: "4000",
          prospectiveResidual: "6000",
          actualResidual: "10000",
          bank: "0",
          newVAT: "0",
        },
        before,
        after: await financial(data.book),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
});
