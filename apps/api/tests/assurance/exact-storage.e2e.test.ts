import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import {
  decoded,
  evidence,
  execute,
  fixture,
  journal,
  ledger,
  persisted,
  prepare,
  request,
} from "../support/fixtures";
import { rawVoucherRows, saveSanitizedJourney } from "./database-support";

const maximumLine = "9".repeat(38);

test.each(["1", "9007199254740993", maximumLine])(
  "[ASR-STORAGE-EXACT] %s survives actual request, SQL and ledger read",
  async (amount) => {
    const book = await fixture();
    const receipt = await execute(book, await prepare(book, amount));
    const rows = await rawVoucherRows(book);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.account_id, row.debit, row.credit])).toEqual([
      ["account_bank", amount, "0"],
      ["account_clearing", "0", amount],
    ]);
    const snapshot = await ledger(book);
    expect(snapshot.accounts.find((row) => row.accountId === "account_bank")?.balanceMinor).toBe(
      amount,
    );
    expect(
      snapshot.accounts.find((row) => row.accountId === "account_clearing")?.balanceMinor,
    ).toBe(`-${amount}`);
    expect(receipt.voucherNumber).toBe("1");
  },
);

test("[ASR-AGGREGATE] totals can exceed a line's 38-digit bound without float conversion", async () => {
  const book = await fixture();
  await execute(book, await prepare(book, maximumLine));
  await execute(book, await prepare(book, maximumLine));
  const expected = "199999999999999999999999999999999999998";
  const snapshot = await ledger(book);
  expect(snapshot.accounts.find((row) => row.accountId === "account_bank")?.balanceMinor).toBe(
    expected,
  );
  expect(snapshot.accounts.find((row) => row.accountId === "account_clearing")?.balanceMinor).toBe(
    `-${expected}`,
  );
  expect((await persisted(book))?.sequence).toBe("2");
  await saveSanitizedJourney("aggregate-over-line-bound", {
    bookId: book.bookId,
    expected,
    accounts: snapshot.accounts,
  });
});

test("[ASR-ECONOMIC-MULTIPLICITY] equal money and reused evidence can represent distinct reviewed events", async () => {
  const book = await fixture();
  const source = await evidence(book);
  const firstInput = journal(source.id, "5000");

  const first = await decoded(
    await request(book, "/change-sets", { method: "POST", body: JSON.stringify(firstInput) }),
    Accounting.ChangeSet,
  );

  await execute(book, first);
  const secondInput = journal(source.id, "5000");
  expect(secondInput.eventKey).not.toBe(firstInput.eventKey);

  const second = await decoded(
    await request(book, "/change-sets", { method: "POST", body: JSON.stringify(secondInput) }),
    Accounting.ChangeSet,
  );

  await execute(book, second);
  expect((await persisted(book))?.vouchers).toBe(2);
  expect(
    (await ledger(book)).accounts.find((row) => row.accountId === "account_bank")?.balanceMinor,
  ).toBe("10000");
});
