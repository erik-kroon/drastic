import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Tax from "@open-erp/contracts/corporate-tax";
import * as Vat from "@open-erp/contracts/vat-returns";
import {
  database,
  decoded,
  environment,
  evidence,
  execute,
  fixture,
  key,
  ledger,
  persisted,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";
import { closeFixture, taxBridge } from "./support/financial-close";

async function retainedBasis(book: BookFixture, approvalId: string) {
  const admin = await database();

  try {
    const rows = await admin.query(
      `select a.authority_basis as "approvalBasis", c.approver_basis as "approverBasis",
        c.executor_basis as "executorBasis", c.receipt_id as "receiptId"
       from openerp.approvals a join openerp.approval_consumptions c
         on c.book_id=a.book_id and c.approval_id=a.id
       where a.book_id=$1 and a.id=$2`,
      [book.bookId, approvalId],
    );

    expect(rows.rows).toHaveLength(1);

    const basis = rows.rows[0];

    if (basis === undefined) throw new Error("Missing retained approval consumption");

    return basis;
  } finally {
    await admin.end();
  }
}

function assertBasis(
  basis: Awaited<ReturnType<typeof retainedBasis>>,
  book: BookFixture,
  approverId: string,
) {
  expect(basis.approvalBasis).toMatchObject({
    version: 1,
    policy: "generic-posting-authority-v1",
    actorId: approverId,
    scope: { entityId: book.entityId, bookId: book.bookId },
    permission: "approve_change",
    authentication: { kind: "apiCredential" },
  });
  expect(basis.approverBasis).toMatchObject({ actorId: approverId, permission: "approve_change" });
  expect(basis.executorBasis).toMatchObject({
    actorId: book.actorId,
    permission: "execute_change",
  });
  expect(basis.approverBasis.authentication).toBeUndefined();
}

test("zero current tax consumes real authority and replays without any journal effect", async () => {
  const context = await closeFixture("0");
  const { book, reviewer } = context;
  const { bridge } = await taxBridge(context);

  expect(bridge.currentTaxTargetMinor).toBe("0");

  const approval = await post(
    reviewer,
    `/change-sets/${bridge.changeSetId}/approvals`,
    { version: 1, planDigest: bridge.planDigest },
    Accounting.Approval,
  );

  const before = await persisted(book);

  if (before === undefined) throw new Error("Missing synthetic posting state");

  const command = {
    method: "POST",
    headers: { "idempotency-key": key() },
    body: JSON.stringify({ bridgeDigest: bridge.digest, approvalId: approval.id }),
  };

  const path = `/corporate-tax/bridges/${bridge.id}/effects`;
  const effect = await decoded(await request(book, path, command), Tax.CorporateTaxEffect);

  expect(effect).toMatchObject({
    yearTaxTargetMinor: "0",
    deltaMinor: "0",
    recognizedAfterMinor: "0",
    voucherId: null,
    postingReceipt: null,
    noFinancialEffect: true,
    approvalId: approval.id,
  });
  expect(await persisted(book)).toEqual({ ...before, consumed: before.consumed + 1 });
  const basis = await retainedBasis(book, approval.id);

  assertBasis(basis, book, reviewer.actorId);
  expect(basis.receiptId).toBe(effect.groupReceiptId);
  expect(await decoded(await request(book, path, command), Tax.CorporateTaxEffect)).toEqual(effect);
  expect(await persisted(book)).toEqual({ ...before, consumed: before.consumed + 1 });
  await writeFile(
    join(environment().artifacts, "posting-corporate-zero-authority.json"),
    JSON.stringify(
      {
        expected: { deltaMinor: "0", financialEffects: 0 },
        effect,
        basis,
        before,
        after: await persisted(book),
      },
      null,
      2,
    ),
  );
}, 120_000);

test("VAT direct kernel approval and consumption retain actual authority and replay one exact reclassification", async () => {
  const book = await fixture([
    { id: "account_vat", code: "2611", name: "Synthetic output VAT" },
    { id: "account_input_vat", code: "2641", name: "Synthetic input VAT" },
    { id: "account_vat_settlement", code: "2650", name: "Synthetic VAT settlement" },
    { id: "account_income", code: "3000", name: "Synthetic income" },
  ]);

  const second = await fixture();
  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, second.actorId],
    );
  } finally {
    await admin.end();
  }

  const reviewer = { ...book, actorId: second.actorId, token: second.token };
  const source = await evidence(book);

  const sale = await post(
    book,
    "/change-sets",
    {
      kind: "manual_journal",
      evidenceId: source.id,
      eventKey: key(),
      accountingPeriodId: "period_2026",
      postingDate: "2026-09-28",
      series: "VAT",
      description: "Synthetic sale",
      rationale: "Exact synthetic net400 tax100 gross500",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "account_clearing",
          debitMinor: "500",
          creditMinor: "0",
          description: "Receivable",
        },
        { accountId: "account_income", debitMinor: "0", creditMinor: "400", description: "Income" },
        {
          accountId: "account_vat",
          debitMinor: "0",
          creditMinor: "100",
          description: "Output VAT",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const saleReceipt = await execute(book, sale);

  const voucher = await decoded(
    await request(book, `/vouchers/${saleReceipt.voucherId}`),
    Accounting.Voucher,
  );

  const taxLine = voucher.action.lines.find((line) => line.accountId === "account_vat");

  if (!taxLine) throw new Error("Missing synthetic output VAT line");

  await post(
    book,
    "/vat-returns/facts",
    {
      sourceKey: "special_authority_sale",
      expectedDigest: null,
      recordClass: "synthetic",
      evidenceId: source.id,
      sourceLocator: "synthetic_sale",
      description: "Synthetic sale",
      reviewEvidenceId: source.id,
      reviewRationale: "Exact synthetic tax100",
      treatment: "domestic_sale",
      netMinor: "400",
      vatMinor: "100",
      grossMinor: "500",
      currency: "SEK",
      issuedOn: "2026-09-28",
      receivedOn: null,
      suppliedOn: "2026-09-28",
      taxPointOn: "2026-09-28",
      dateBasis: "Same-day synthetic supply",
      periodEvidenceId: source.id,
      registration: "registered",
      registrationEvidenceId: source.id,
      method: "accrual",
      methodEvidenceId: source.id,
      domesticEligibility: "confirmed",
      treatmentEvidenceId: source.id,
      fullDeduction: "confirmed",
      deductionEvidenceId: source.id,
      voucherId: voucher.id,
      taxLineIds: [taxLine.lineId],
      expenseLink: null,
    },
    Vat.VatFact,
  );

  const draft = await post(
    book,
    "/vat-returns/drafts",
    {
      mode: "synthetic_demonstration",
      startsOn: "2026-09-01",
      endsOn: "2026-09-30",
      periodEvidenceId: source.id,
      otherBoxes: "absent_in_synthetic_example",
    },
    Vat.VatDraft,
  );

  const review = await post(
    book,
    "/vat-returns/reclassifications",
    {
      profile: "vat_control_reclassification_v1",
      draftId: draft.id,
      expectedDraftDigest: draft.digest,
      outputAccountId: "account_vat",
      inputAccountId: "account_input_vat",
      settlementAccountId: "account_vat_settlement",
      roleEvidenceId: source.id,
      reviewEvidenceId: source.id,
      accountingPeriodId: "period_2026",
      postingDate: "2026-09-28",
      series: "VAT",
      rationale: "Move exact synthetic control100",
      acknowledgeSyntheticOnly: true,
    },
    Vat.VatControlReclassificationReview,
  );

  expect(review.basis.amounts).toMatchObject({
    outputTaxMinor: "100",
    deductibleInputTaxMinor: "0",
    accountingNetMinor: "100",
  });
  expect(review.postingPlan).not.toBeNull();

  const approval = await post(
    reviewer,
    `/vat-returns/reclassifications/${review.id}/approval`,
    {
      expectedReviewDigest: review.digest,
      acknowledgeSyntheticOnly: true,
    },
    Vat.VatControlReclassificationApproval,
  );

  if (!approval.kernelApproval) throw new Error("Missing direct kernel approval");

  const before = await persisted(book);

  if (before === undefined) throw new Error("Missing synthetic posting state");
  const path = `/vat-returns/reclassifications/${review.id}/execution`;

  const command = {
    method: "POST",
    headers: { "idempotency-key": key() },
    body: JSON.stringify({
      expectedReviewDigest: review.digest,
      acknowledgeSyntheticOnly: true,
      approvalId: approval.id,
    }),
  };

  const effect = await decoded(
    await request(book, path, command),
    Vat.VatControlReclassificationEffect,
  );

  expect(effect.outcome).toBe("posted");
  expect(effect.postingReceipt).not.toBeNull();
  expect(await persisted(book)).toMatchObject({
    vouchers: before.vouchers + 1,
    consumed: before.consumed + 1,
  });
  const afterLedger = await ledger(book);

  expect(
    afterLedger.accounts.find((balance) => balance.accountId === "account_vat")?.balanceMinor,
  ).toBe("0");
  expect(
    afterLedger.accounts.find((balance) => balance.accountId === "account_vat_settlement")
      ?.balanceMinor,
  ).toBe("-100");
  const basis = await retainedBasis(book, approval.kernelApproval.id);

  assertBasis(basis, book, reviewer.actorId);
  expect(
    await decoded(await request(book, path, command), Vat.VatControlReclassificationEffect),
  ).toEqual(effect);
  expect(await persisted(book)).toMatchObject({
    vouchers: before.vouchers + 1,
    consumed: before.consumed + 1,
  });
  await writeFile(
    join(environment().artifacts, "posting-vat-direct-authority.json"),
    JSON.stringify(
      {
        expected: { outputMinor: "0", settlementMinor: "-100", addedVouchers: 1 },
        review,
        approval,
        effect,
        basis,
        afterLedger,
      },
      null,
      2,
    ),
  );
}, 120_000);
