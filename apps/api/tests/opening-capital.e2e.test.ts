import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Historical from "@open-erp/contracts/historical-migration";
import * as Corrections from "@open-erp/contracts/corrections";
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
        expected: controls,
      },
      null,
      2,
    ),
  );
});
