import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import {
  approve,
  database,
  decoded,
  emptyPosting,
  execute,
  execution,
  failure,
  fixture,
  key,
  ledger,
  onePosting,
  persisted,
  prepare,
  request,
  saveEvidence,
} from "./support/fixtures";

test("review is read-only; posting preserves exact money beyond Number.MAX_SAFE_INTEGER", async () => {
  const book = await fixture();
  const plan = await prepare(book, "9007199254740993");
  const validation = await decoded(
    await request(book, `/change-sets/${plan.id}/validate`, { method: "POST" }),
    Accounting.ValidationReport,
  );
  expect(validation).toMatchObject({
    changeSetId: plan.id,
    planDigest: plan.planDigest,
    status: "valid",
  });
  const approval = await approve(book, plan);
  expect(await persisted(book)).toEqual(emptyPosting);
  const receipt = await decoded(
    await request(book, `/change-sets/${plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify(execution(plan, approval)),
    }),
    Accounting.ExecutionReceipt,
  );
  expect(receipt).toMatchObject({
    changeSetId: plan.id,
    planDigest: plan.planDigest,
    sequence: "1",
    voucherNumber: "1",
  });
  expect((await ledger(book)).accounts).toEqual([
    {
      accountId: "account_bank",
      code: "1930",
      name: "Bank",
      debitMinor: "9007199254740993",
      creditMinor: "0",
      balanceMinor: "9007199254740993",
    },
    {
      accountId: "account_clearing",
      code: "2999",
      name: "Clearing",
      debitMinor: "0",
      creditMinor: "9007199254740993",
      balanceMinor: "-9007199254740993",
    },
  ]);
  expect(await persisted(book)).toEqual(onePosting);
  await saveEvidence("exact-money", book);
});

test("same-key replay after approval consumption and concurrent retries returns one committed posting", async () => {
  const book = await fixture();
  const plan = await prepare(book);
  const approval = await approve(book, plan);
  const idempotencyKey = key();
  const command = {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: JSON.stringify(execution(plan, approval)),
  };
  const receipts = await Promise.all(
    Array.from({ length: 6 }, async () =>
      decoded(
        await request(book, `/change-sets/${plan.id}/execute`, command),
        Accounting.ExecutionReceipt,
      ),
    ),
  );
  for (const receipt of receipts) expect(receipt).toEqual(receipts[0]);
  expect(await persisted(book)).toEqual(onePosting);
  expect(
    await decoded(await request(book, `/receipts/${idempotencyKey}`), Accounting.ExecutionReceipt),
  ).toEqual(receipts[0]);
  expect(
    await decoded(
      await request(book, `/change-sets/${plan.id}/execute`, command),
      Accounting.ExecutionReceipt,
    ),
  ).toEqual(receipts[0]);
  await failure(
    await request(book, `/change-sets/${plan.id}/execute`, {
      ...command,
      body: JSON.stringify({
        ...execution(plan, approval),
        planDigest: `sha256:${"0".repeat(64)}`,
      }),
    }),
    409,
    "IdempotencyConflict",
  );
  expect(await persisted(book)).toEqual(onePosting);
  await saveEvidence("retry", book);
});

test("same-key replay after approval expiry returns the original receipt", async () => {
  const book = await fixture();
  const plan = await prepare(book);
  const approval = await approve(book, plan);
  const idempotencyKey = key();
  const command = {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: JSON.stringify(execution(plan, approval)),
  };
  const receipt = await decoded(
    await request(book, `/change-sets/${plan.id}/execute`, command),
    Accounting.ExecutionReceipt,
  );
  const admin = await database();
  try {
    await admin.query("ALTER TABLE openerp.approvals DISABLE TRIGGER ALL");
    try {
      const expired = await admin.query(
        "UPDATE openerp.approvals SET expires_at = clock_timestamp() - interval '1 second' WHERE book_id = $1 AND id = $2",
        [book.bookId, approval.id],
      );
      expect(expired.rowCount).toBe(1);
    } finally {
      await admin.query("ALTER TABLE openerp.approvals ENABLE TRIGGER ALL");
    }
  } finally {
    await admin.end();
  }
  expect(
    await decoded(
      await request(book, `/change-sets/${plan.id}/execute`, command),
      Accounting.ExecutionReceipt,
    ),
  ).toEqual(receipt);
  expect(await persisted(book)).toEqual(onePosting);
});

test("linked reversal cancels balances and preserves the original voucher", async () => {
  const book = await fixture();
  const original = await execute(book, await prepare(book));
  const before = await decoded(
    await request(book, `/vouchers/${original.voucherId}`),
    Accounting.Voucher,
  );
  const correction = await decoded(
    await request(book, `/vouchers/${original.voucherId}/correction-proposals`, {
      method: "POST",
      body: JSON.stringify({
        accountingPeriodId: "period_2026",
        postingDate: "2026-09-23",
        rationale: "Reverse synthetic transfer",
      }),
    }),
    Accounting.ChangeSet,
  );
  const receipt = await execute(book, correction);
  const reversed = await decoded(
    await request(book, `/vouchers/${receipt.voucherId}`),
    Accounting.Voucher,
  );
  expect(reversed.action).toMatchObject({
    correctsVoucherId: original.voucherId,
    postingPurpose: "reversal",
  });
  expect(
    reversed.action.lines.map((line) => [line.accountId, line.debitMinor, line.creditMinor]),
  ).toEqual([
    ["account_bank", "0", "12500"],
    ["account_clearing", "12500", "0"],
  ]);
  expect(
    await decoded(await request(book, `/vouchers/${original.voucherId}`), Accounting.Voucher),
  ).toEqual(before);
  expect((await ledger(book)).accounts.map((account) => account.balanceMinor)).toEqual(["0", "0"]);
  expect(await persisted(book)).toEqual({
    sequence: "2",
    vouchers: 2,
    lines: 4,
    receipts: 2,
    outbox: 2,
    consumed: 2,
    counter: "2",
  });
  await saveEvidence("reversal", book);
});
