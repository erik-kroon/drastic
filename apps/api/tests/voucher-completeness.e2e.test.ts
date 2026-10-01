import { Client } from "pg";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  approve,
  database,
  decoded,
  environment,
  execute,
  execution,
  fixture,
  key,
  persisted,
  prepare,
  request,
} from "./support/fixtures";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Schema from "effect/Schema";

test("DF-01 committed voucher slots are exhausted and neither count nor lines can be reopened", async () => {
  const book = await fixture();
  const receipt = await execute(book, await prepare(book));
  const before = await persisted(book);
  const runtime = new Client({ connectionString: environment().runtimeUrl });
  await runtime.connect();
  const refusals = [];

  try {
    for (const [ordinal, code] of [
      [0, "23514"],
      [1, "23505"],
      [2, "23505"],
      [3, "P0001"],
    ] as const) {
      const rejected = runtime.query(
        "insert into openerp.journal_lines(book_id,voucher_id,id,ordinal,account_id,debit_minor,credit_minor,description) values($1,$2,$3,$4,'account_bank',1,0,'Synthetic late append')",
        [book.bookId, receipt.voucherId, `line_${key().replaceAll("-", "")}`, ordinal],
      );

      await expect(rejected).rejects.toMatchObject({ code });
      refusals.push({ ordinal, code });
    }

    await expect(
      runtime.query(
        "update openerp.vouchers set expected_line_count=3 where book_id=$1 and id=$2",
        [book.bookId, receipt.voucherId],
      ),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      runtime.query("delete from openerp.journal_lines where book_id=$1 and voucher_id=$2", [
        book.bookId,
        receipt.voucherId,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await runtime.end();
  }

  expect(await persisted(book)).toEqual(before);
  const admin = await database();

  try {
    await expect(
      admin.query("update openerp.vouchers set expected_line_count=3 where book_id=$1 and id=$2", [
        book.bookId,
        receipt.voucherId,
      ]),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      admin.query("delete from openerp.journal_lines where book_id=$1 and voucher_id=$2", [
        book.bookId,
        receipt.voucherId,
      ]),
    ).rejects.toMatchObject({ code: "P0001" });
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "df-01-late-append.json"),
    JSON.stringify({ receipt, before, refusals, unchanged: true }, null, 2),
  );
});

test.each(["missing_line", "unbalanced"])(
  "DF-01 deferred commit rejects %s after otherwise valid application writes",
  async (mode) => {
    const book = await fixture();
    const plan = await prepare(book);
    const approval = await approve(book, plan);
    const before = await persisted(book);
    const requestKey = key();

    const command = {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body: JSON.stringify(execution(plan, approval)),
    };

    const admin = await database();

    try {
      const fault =
        mode === "missing_line"
          ? "if new.debit_minor > 0 then return null; end if;"
          : "if new.credit_minor > 0 then new.credit_minor := new.credit_minor + 1; end if;";

      await admin.query(
        `create function openerp.e2e_df01_fault() returns trigger language plpgsql as $$ begin if new.book_id = '${book.bookId}' then ${fault} end if; return new; end $$`,
      );
      await admin.query(
        "create trigger e2e_df01_fault before insert on openerp.journal_lines for each row execute function openerp.e2e_df01_fault()",
      );
      const rejected = await request(book, `/change-sets/${plan.id}/execute`, command);
      const responseText = await rejected.text();
      expect(rejected.status, responseText).toBe(422);

      const refusal = Schema.decodeSync(Schema.fromJsonString(Accounting.AccountingError))(
        responseText,
      );

      expect(refusal.code).toBe("InvalidJournal");
      expect(await persisted(book)).toEqual(before);

      const commands = await admin.query(
        "select count(*)::int as count from openerp.command_receipts where book_id=$1 and key=$2",
        [book.bookId, requestKey],
      );

      expect(commands.rows).toEqual([{ count: 0 }]);
    } finally {
      await admin.query("drop trigger if exists e2e_df01_fault on openerp.journal_lines");
      await admin.query("drop function if exists openerp.e2e_df01_fault()");
      await admin.end();
    }

    const receipt = await decoded(
      await request(book, `/change-sets/${plan.id}/execute`, command),
      Accounting.ExecutionReceipt,
    );

    expect((await persisted(book))?.vouchers).toBe(1);
    await writeFile(
      join(environment().artifacts, `df-01-${mode}.json`),
      JSON.stringify({ before, receipt, sameKeyRecovered: true }, null, 2),
    );
  },
);
