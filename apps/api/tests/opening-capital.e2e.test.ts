import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Historical from "@open-erp/contracts/historical-migration";
import * as Corrections from "@open-erp/contracts/corrections";
import * as Owners from "@open-erp/contracts/owner-register";
import * as Operations from "@open-erp/contracts/owner-operations";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Intake from "@open-erp/contracts/source-intake";
import * as Import from "@open-erp/contracts/sie-import";
import { expect, test } from "vitest";
import {
  database,
  decoded,
  environment,
  failure,
  fixture,
  key,
  post,
  request,
} from "./support/fixtures";

// Independent prior-ledger opening: bank 12500000, capital -2500000,
// shareholder loan -10000000. This transfers recorded balances, not share rights.
test("retained opening capital transfers once and preserves source controls on recovery", async () => {
  const book = await fixture([
    { id: "account_capital", code: "2081", name: "Recorded share capital" },
    { id: "account_owner", code: "2893", name: "Recorded shareholder loan" },
  ]);

  const bytes = Buffer.from(
    `#FLAGGA 0\n#FORMAT UTF8\n#SIETYP 4\n#RAR 0 20260101 20261231\n#KONTO 1930 "Bank"\n#KONTO 2081 "Capital"\n#KONTO 2893 "Loan"\n#IB 0 1930 125000.00\n#UB 0 1930 125010.00\n#IB 0 2081 -25000.00\n#UB 0 2081 -25000.00\n#IB 0 2893 -100000.00\n#UB 0 2893 -100010.00\n#VER "A" "1" 20260102 "Prior movement, not part of opening"\n{\n#TRANS 1930 {} 10.00\n#TRANS 2893 {} -10.00\n}\n`,
  );

  const source = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "synthetic_prior_ledger",
      sourceAccountId: "Independent prior book",
      occurrenceKey: key(),
      sourceRevision: "1",
      filename: "opening-capital.SE",
      mediaType: "application/octet-stream",
      contentBase64: bytes.toString("base64"),
    },
    Intake.SourceOccurrence,
  );

  const preview = await post(
    book,
    `/source-occurrences/${source.id}/sie-previews`,
    { encoding: "utf-8" },
    Import.SiePreview,
  );

  expect(preview.ready, JSON.stringify(preview.diagnostics)).toBe(true);

  const controls = [
    { sourceAccount: "1930", accountId: "account_bank", amount: "12500000" },
    { sourceAccount: "2081", accountId: "account_capital", amount: "-2500000" },
    { sourceAccount: "2893", accountId: "account_owner", amount: "-10000000" },
  ];

  const plan = await post(
    book,
    `/sie-previews/${preview.id}/plans`,
    {
      digest: preview.digest,
      mappings: controls.map(({ sourceAccount, accountId }) => ({ sourceAccount, accountId })),
      openingControls: controls.map(({ sourceAccount, amount }) => ({
        sourceAccount,
        year: "0",
        independentOpeningMinor: amount,
        independentClosingMinor:
          sourceAccount === "1930" ? "12501000" : sourceAccount === "2893" ? "-10001000" : amount,
        basis: "Independent retained opening control",
      })),
      openItems: [],
      openItemControls: [],
      rationale: "Opening balances only; no duplicate history",
      openingPolicy: "unreconstructable_detail",
      sourceKind: "synthetic",
    },
    Import.SiePlan,
  );

  const run = await post(
    book,
    `/sie-plans/${plan.id}/runs`,
    { digest: plan.digest },
    Import.SieRunStart,
  );

  await post(
    book,
    `/sie-runs/${run.id}/chunks`,
    { fence: run.fence, planDigest: plan.digest, firstOrdinal: 1 },
    Import.SieChunk,
  );

  const input = {
    fiscalYearId: "fy_2026",
    cutoverOn: "2026-01-01",
    sourcePlanId: plan.id,
    sourceDigest: plan.digest,
    controls: controls.map(({ accountId, amount }) => ({
      accountId,
      signedMinor: amount,
      basis: "Independent prior-ledger balance",
    })),
    rationale: "Qualified opening transfer",
    accountingPeriodId: "period_2026",
    series: "A",
  };

  await failure(
    await request(book, "/historical-openings", {
      method: "POST",
      body: JSON.stringify({ ...input, sourceDigest: `sha256:${"0".repeat(64)}` }),
    }),
    409,
    "StaleDependency",
  );

  const foreign = await fixture([
    { id: "account_capital", code: "2081", name: "Foreign capital" },
    { id: "account_owner", code: "2893", name: "Foreign loan" },
  ]);

  await failure(
    await request(foreign, "/historical-openings", { method: "POST", body: JSON.stringify(input) }),
    404,
    "NotFound",
  );

  const original = await post(book, "/historical-openings", input, Historical.OpeningPreparation);

  const originalApproval = await post(
    book,
    `/change-sets/${original.proposal.id}/approvals`,
    { version: 1, planDigest: original.proposal.planDigest },
    Accounting.Approval,
  );

  const opening = await post(
    book,
    "/historical-bases/fy_2026/proposals",
    {
      expectedChangeSetId: original.proposal.id,
      accountingPeriodId: "period_2026",
      series: "A",
      rationale: "Refresh retained opening after review without changing its controls",
    },
    Historical.OpeningPreparation,
  );

  expect(opening.proposal.id).not.toBe(original.proposal.id);
  await failure(
    await request(book, `/change-sets/${original.proposal.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        planDigest: original.proposal.planDigest,
        approvalId: originalApproval.id,
      }),
    }),
    409,
    "StaleDependency",
  );

  const approval = await post(
    book,
    `/change-sets/${opening.proposal.id}/approvals`,
    { version: 1, planDigest: opening.proposal.planDigest },
    Accounting.Approval,
  );

  const command = {
    method: "POST",
    headers: { "idempotency-key": key() },
    body: JSON.stringify({ planDigest: opening.proposal.planDigest, approvalId: approval.id }),
  };

  const fault = await database();

  try {
    await fault.query(`create function openerp.synthetic_opening_checkpoint_failure() returns trigger
      language plpgsql as $$begin raise exception 'synthetic opening checkpoint failure'; end$$`);
    await fault.query(`create trigger synthetic_opening_checkpoint_failure before update of opening_voucher_id
      on openerp.historical_bases for each row execute function openerp.synthetic_opening_checkpoint_failure()`);
    await failure(
      await request(book, "/historical-bases/fy_2026/post", command),
      500,
      "InternalError",
    );
    expect(
      (
        await fault.query("select count(*)::int as count from openerp.vouchers where book_id=$1", [
          book.bookId,
        ])
      ).rows,
    ).toEqual([{ count: 0 }]);
  } finally {
    await fault.query(
      "drop trigger if exists synthetic_opening_checkpoint_failure on openerp.historical_bases",
    );
    await fault.query("drop function if exists openerp.synthetic_opening_checkpoint_failure()");
    await fault.end();
  }

  const result = await decoded(
    await request(book, "/historical-bases/fy_2026/post", command),
    Historical.Basis,
  );

  expect(result.voucherId).toBeDefined();
  expect(
    await decoded(await request(book, "/historical-bases/fy_2026/post", command), Historical.Basis),
  ).toEqual(result);

  const recovered = await decoded(
    await request(book, "/historical-bases/fy_2026"),
    Historical.Basis,
  );

  expect(recovered.voucherId).toBe(result.voucherId);
  expect(recovered.sourcePlanId).toBe(plan.id);
  expect(recovered.sourceDigest).toBe(plan.digest);
  expect(recovered.controls).toEqual(input.controls);
  await failure(
    await request(book, "/historical-bases", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        mode: "full_history",
        changeSetId: null,
      }),
    }),
    409,
    "AlreadyPosted",
  );
  await failure(
    await request(book, "/historical-openings", { method: "POST", body: JSON.stringify(input) }),
    409,
    "AlreadyPosted",
  );
  const admin = await database();

  try {
    expect(
      (
        await admin.query(
          "select account_id,(sum(debit_minor)-sum(credit_minor))::text as balance from openerp.journal_lines where book_id=$1 group by account_id order by account_id",
          [book.bookId],
        )
      ).rows,
    ).toEqual([
      { account_id: "account_bank", balance: "12500000" },
      { account_id: "account_capital", balance: "-2500000" },
      { account_id: "account_owner", balance: "-10000000" },
    ]);
    expect(
      (
        await admin.query("select count(*)::int as count from openerp.vouchers where book_id=$1", [
          book.bookId,
        ])
      ).rows,
    ).toEqual([{ count: 1 }]);
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "opening-capital-before-correction.json"),
    JSON.stringify(
      { source, preview, plan, run, original, opening, result, expected: controls },
      null,
      2,
    ),
  );

  const intent = {
    datePolicy: "explicit_open_period",
    accountingPeriodId: "period_2026",
    postingDate: "2026-01-03",
    rationale:
      "Independent revised opening allocation: capital3000000, loan9500000; cash unchanged",
    replacement: {
      description: "Correct recorded opening capital allocation",
      lines: [
        {
          accountId: "account_bank",
          debitMinor: "12500000",
          creditMinor: "0",
          description: "Retained bank opening",
        },
        {
          accountId: "account_capital",
          debitMinor: "0",
          creditMinor: "3000000",
          description: "Revised opening capital",
        },
        {
          accountId: "account_owner",
          debitMinor: "0",
          creditMinor: "9500000",
          description: "Revised opening loan",
        },
      ],
    },
  };

  const impact = await post(
    book,
    `/vouchers/${result.voucherId}/correction-impact-reviews`,
    intent,
    Corrections.CorrectionImpact,
  );

  expect(impact.basis.blockers).toEqual([]);

  const correction = await post(
    book,
    `/vouchers/${result.voucherId}/correction-bundles`,
    {
      ...intent,
      impactReview: { id: impact.id, digest: impact.digest },
    },
    Corrections.CorrectionBundle,
  );

  const correctionApproval = await post(
    book,
    `/correction-bundles/${correction.id}/approvals`,
    { version: 1, bundleDigest: correction.bundleDigest },
    Corrections.CorrectionBundleApproval,
  );

  const correctionCommand = {
    method: "POST",
    headers: { "idempotency-key": key() },
    body: JSON.stringify({
      version: 1,
      bundleDigest: correction.bundleDigest,
      approvalId: correctionApproval.id,
    }),
  };

  const corrected = await decoded(
    await request(book, `/correction-bundles/${correction.id}/execute`, correctionCommand),
    Corrections.CorrectionBundleReceipt,
  );

  expect(corrected.originalVoucherId).toBe(result.voucherId);
  expect(
    await decoded(
      await request(book, `/correction-bundles/${correction.id}/execute`, correctionCommand),
      Corrections.CorrectionBundleReceipt,
    ),
  ).toEqual(corrected);

  const correctionRead = await decoded(
    await request(book, `/correction-bundles/${correction.id}`),
    Corrections.CorrectionBundleView,
  );

  expect(correctionRead.receipt).toEqual(corrected);
  const final = await database();

  try {
    expect(
      (
        await final.query(
          "select account_id,(sum(debit_minor)-sum(credit_minor))::text as balance from openerp.journal_lines where book_id=$1 group by account_id order by account_id",
          [book.bookId],
        )
      ).rows,
    ).toEqual([
      { account_id: "account_bank", balance: "12500000" },
      { account_id: "account_capital", balance: "-3000000" },
      { account_id: "account_owner", balance: "-9500000" },
    ]);
    expect(
      (
        await final.query("select count(*)::int as count from openerp.vouchers where book_id=$1", [
          book.bookId,
        ])
      ).rows,
    ).toEqual([{ count: 3 }]);
  } finally {
    await final.end();
  }

  const owner = await post(
    book,
    "/owner-register/owners",
    {
      sourceKey: key(),
      displayName: "Synthetic opening lender",
      dataNature: "synthetic_example",
      evidenceId: opening.proposal.groups[0]?.actions[0]?.evidenceRefs[0]?.evidenceId,
      reason: "Retained opening loan identity",
    },
    Owners.Owner,
  );

  const evidenceId = opening.proposal.groups[0]?.actions[0]?.evidenceRefs[0]?.evidenceId;

  const record = await post(
    book,
    "/owner-register/records",
    {
      ownerId: owner.id,
      dataNature: "synthetic_example",
      sourceKey: key(),
      sourceKind: "funding",
      evidenceId,
      locator: "opening_fy_2026",
      occurredOn: "2026-01-01",
      currency: "SEK",
      currencyScale: 2,
      amountMinor: "9500000",
      counterparty: null,
      description: "Corrected retained opening loan",
      classification: "shareholder_loan",
      origin: "opening",
      reason: "Exact replacement opening liability",
    },
    Owners.RecordView,
  );

  const reviewed = await post(
    book,
    `/owner-register/records/${record.source.id}/reviews`,
    {
      expectedRevision: record.currentRevision.revision,
      revisionDigest: record.currentRevision.digest,
      controlAccountId: "account_owner",
      syntheticNoTaxConfirmed: true,
      evidenceId,
      reason: "Link corrected opening loan without posting cash again",
    },
    Owners.Review,
  );

  const loanLine = correction.replacement.groups[0]?.actions[0]?.lines.find(
    (line) => line.accountId === "account_owner",
  );

  const link = {
    reviewId: reviewed.id,
    voucherId: corrected.replacement.voucherId,
    lineId: loanLine?.lineId,
  };

  const originalLoanLine = opening.proposal.groups[0]?.actions[0]?.lines.find(
    (line) => line.accountId === "account_owner",
  );

  await failure(
    await request(book, `/owner-register/records/${record.source.id}/posted-lines`, {
      method: "POST",
      body: JSON.stringify({
        reviewId: reviewed.id,
        voucherId: result.voucherId,
        lineId: originalLoanLine?.lineId,
      }),
    }),
    409,
    "StaleDependency",
  );

  const linkCommand = {
    method: "POST",
    headers: { "idempotency-key": key() },
    body: JSON.stringify(link),
  };

  const effect = await decoded(
    await request(book, `/owner-register/records/${record.source.id}/posted-lines`, linkCommand),
    Owners.PostedEffect,
  );

  expect(effect.amountMinor).toBe("9500000");
  expect(effect.origin).toBe("opening");
  expect(
    await decoded(
      await request(book, `/owner-register/records/${record.source.id}/posted-lines`, linkCommand),
      Owners.PostedEffect,
    ),
  ).toEqual(effect);

  const control = await post(
    book,
    "/owner-register/controls",
    { ownerId: owner.id, startsOn: "2026-01-01", endsOn: "2026-12-31" },
    Owners.Control,
  );

  expect(control.ownerBalances[0]?.openLoanMinor).toBe("9500000");
  expect(control.accountControls[0]?.unexplainedMinor).toBe("0");
  const verify = await database();

  try {
    expect(
      (
        await verify.query("select count(*)::int as count from openerp.vouchers where book_id=$1", [
          book.bookId,
        ])
      ).rows,
    ).toEqual([{ count: 3 }]);
  } finally {
    await verify.end();
  }

  const declaration = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "synthetic_opening_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-02-01",
    endsOn: "2026-02-28",
    openingMinor: "12500000",
    closingMinor: "12000000",
    completeness: { declaredComplete: true, basis: "Independent synthetic repayment statement" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: key(),
        date: "2026-02-22",
        description: "Repay adopted opening loan",
        amountMinor: "-500000",
      },
    ],
  };

  const cash = await post(
    book,
    "/evidence",
    {
      title: "Original opening-loan repayment",
      content: JSON.stringify(declaration),
      mediaType: "application/json",
      origin: "Independent synthetic bank",
    },
    Accounting.Evidence,
  );

  const statement = await post(
    book,
    "/bank-statements",
    { ...declaration, evidenceId: cash.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );

  const repayment = await post(
    book,
    "/owner-operations/reviews",
    {
      mode: "repay_owner_loan",
      ownerId: owner.id,
      controlAccountId: "account_owner",
      cashAccountId: "account_bank",
      accountingPeriodId: "period_2026",
      postingDate: "2026-02-22",
      series: "A",
      reason: "Repay500000 of adopted9500000 opening capacity",
      evidence: {
        cashEvidenceId: cash.id,
        statementId: statement.statement.id,
        rowOrdinal: 1,
        loanEffectId: effect.id,
        reason: "Exact retained original loan",
      },
    },
    Operations.OwnerOperationReview,
  );

  const independent = await fixture();
  const reviewer = { ...book, token: independent.token, actorId: independent.actorId };
  const membership = await database();

  try {
    await membership.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, reviewer.actorId],
    );
  } finally {
    await membership.end();
  }

  const approved = await post(
    reviewer,
    `/owner-operations/reviews/${repayment.id}/approvals`,
    { version: 1, digest: repayment.digest },
    Operations.OwnerOperationApproval,
  );

  const repaid = await post(
    book,
    `/owner-operations/reviews/${repayment.id}/execute`,
    { version: 1, digest: repayment.digest, approvalId: approved.id },
    Operations.OwnerOperationReceipt,
  );

  expect(repaid.reimburses).toEqual([{ claimId: effect.id, amountMinor: "500000" }]);

  const remaining = await post(
    book,
    "/owner-register/controls",
    { ownerId: owner.id, startsOn: "2026-01-01", endsOn: "2026-12-31" },
    Owners.Control,
  );

  expect(remaining.ownerBalances[0]?.openLoanMinor).toBe("9000000");
  expect(remaining.accountControls[0]?.unexplainedMinor).toBe("0");
  const balances = await database();

  try {
    expect(
      (
        await balances.query(
          "select account_id,(sum(debit_minor)-sum(credit_minor))::text as balance from openerp.journal_lines where book_id=$1 group by account_id order by account_id",
          [book.bookId],
        )
      ).rows,
    ).toEqual([
      { account_id: "account_bank", balance: "12000000" },
      { account_id: "account_capital", balance: "-3000000" },
      { account_id: "account_owner", balance: "-9000000" },
    ]);
  } finally {
    await balances.end();
  }

  await writeFile(
    join(environment().artifacts, "opening-capital-lineage.json"),
    JSON.stringify(
      {
        source,
        preview,
        plan,
        run,
        original,
        opening,
        result,
        correction,
        corrected,
        record,
        effect,
        control,
        repayment,
        repaid,
        remaining,
        expected: controls,
      },
      null,
      2,
    ),
  );
});
