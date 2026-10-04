import { expect, test } from "vitest";
import * as Corrections from "@open-erp/contracts/corrections";
import {
  decoded,
  execute,
  failure,
  fixture,
  key,
  persisted,
  post,
  prepare,
  request,
} from "../support/fixtures";
import {
  freshCommandCount,
  injectScopedInsertFault,
  rawVoucherRows,
  saveSanitizedJourney,
} from "./database-support";

// Failure contracts: neither sealed child may execute alone; a parent-receipt
// insert fault after both children leaves only the original voucher, its lines,
// consumed approval and counters. The same command then commits one complete
// correction, and replay returns the same receipt without additional postings.
test("a late correction-bundle fault rolls back both children and exact retry recovers once", async () => {
  const book = await fixture();
  const original = await execute(book, await prepare(book));

  const intent = {
    datePolicy: "explicit_open_period" as const,
    accountingPeriodId: "period_2026",
    postingDate: "2026-09-23",
    rationale: "Synthetic independent correction from 12500 to 7000 minor units",
    replacement: {
      description: "Correct synthetic transfer",
      lines: [
        {
          accountId: "account_bank",
          debitMinor: "7000",
          creditMinor: "0",
          description: "Corrected bank debit",
        },
        {
          accountId: "account_clearing",
          debitMinor: "0",
          creditMinor: "7000",
          description: "Corrected clearing credit",
        },
      ],
    },
  };

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

  const before = await persisted(book);
  const beforeRows = await rawVoucherRows(book);

  for (const child of [bundle.reversal, bundle.replacement]) {
    await failure(
      await request(book, `/change-sets/${child.id}/execute`, {
        method: "POST",
        body: JSON.stringify({ version: 1, planDigest: child.planDigest, approvalId: approval.id }),
      }),
      422,
      "UnsupportedProfile",
    );
  }

  expect(await persisted(book)).toEqual(before);

  const commandKey = key();

  const command = {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify({
      version: 1,
      bundleDigest: bundle.bundleDigest,
      approvalId: approval.id,
    }),
  };

  const removeFault = await injectScopedInsertFault(book, "correction_bundle_receipts");

  try {
    const response = await request(book, `/correction-bundles/${bundle.id}/execute`, command);

    expect(response.status, await response.text()).toBe(500);
    expect(await persisted(book)).toEqual(before);
    expect(await rawVoucherRows(book)).toEqual(beforeRows);
    expect(await freshCommandCount(book, commandKey)).toBe(0);
    expect(
      (
        await decoded(
          await request(book, `/correction-bundles/${bundle.id}`),
          Corrections.CorrectionBundleView,
        )
      ).receipt,
    ).toBeNull();
  } finally {
    await removeFault();
  }

  const receipt = await decoded(
    await request(book, `/correction-bundles/${bundle.id}/execute`, command),
    Corrections.CorrectionBundleReceipt,
  );

  expect(receipt.originalVoucherId).toBe(original.voucherId);
  expect(await persisted(book)).toEqual({
    sequence: "3",
    vouchers: 3,
    lines: 6,
    receipts: 3,
    outbox: 3,
    consumed: 3,
    counter: "3",
  });
  expect(await freshCommandCount(book, commandKey)).toBe(1);
  expect(
    await decoded(
      await request(book, `/correction-bundles/${bundle.id}/execute`, command),
      Corrections.CorrectionBundleReceipt,
    ),
  ).toEqual(receipt);
  expect(await persisted(book)).toEqual({
    sequence: "3",
    vouchers: 3,
    lines: 6,
    receipts: 3,
    outbox: 3,
    consumed: 3,
    counter: "3",
  });
  const rows = await rawVoucherRows(book);

  const balance = rows
    .filter((row) => row.account_id === "account_bank")
    .reduce((sum, row) => sum + BigInt(row.debit) - BigInt(row.credit), 0n);

  expect(balance).toBe(7000n);
  await saveSanitizedJourney("correction-bundle-late-fault", {
    before,
    beforeRows,
    receipt,
    rows,
    bankBalanceMinor: balance.toString(),
    persisted: await persisted(book),
  });
});
