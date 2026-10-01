import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Schema from "effect/Schema";
import {
  approve,
  database,
  decoded,
  environment,
  execution,
  fixture,
  key,
  persisted,
  prepare,
  request,
} from "./support/fixtures";

test.each(["2025-12-31", "2027-01-01"])(
  "DF-11 rejects an otherwise valid posting outside its period: %s",
  async (postingDate) => {
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
      await admin.query(
        `create function openerp.e2e_df11_fault() returns trigger language plpgsql as $$ begin if new.book_id = '${book.bookId}' then new.posting_date := '${postingDate}'::date; end if; return new; end $$`,
      );
      await admin.query(
        "create trigger a_e2e_df11_fault before insert on openerp.vouchers for each row execute function openerp.e2e_df11_fault()",
      );
      const rejected = await request(book, `/change-sets/${plan.id}/execute`, command);
      const responseText = await rejected.text();
      expect(rejected.status, responseText).toBe(422);

      const refusal = Schema.decodeSync(Schema.fromJsonString(Accounting.AccountingError))(
        responseText,
      );

      expect(refusal.code).toBe("InvalidJournal");
      expect(await persisted(book)).toEqual(before);
    } finally {
      await admin.query("drop trigger if exists a_e2e_df11_fault on openerp.vouchers");
      await admin.query("drop function if exists openerp.e2e_df11_fault()");
      await admin.end();
    }

    const receipt = await decoded(
      await request(book, `/change-sets/${plan.id}/execute`, command),
      Accounting.ExecutionReceipt,
    );

    expect((await persisted(book))?.vouchers).toBe(1);
    await writeFile(
      join(environment().artifacts, `df-11-${postingDate}.json`),
      JSON.stringify({ postingDate, before, receipt, sameKeyRecovered: true }, null, 2),
    );
  },
);

test.each(["2026-01-01", "2026-12-31"])(
  "DF-11 admits the inclusive endpoint %s and refuses to move the period past it",
  async (postingDate) => {
    const book = await fixture();
    const plan = await prepare(book);
    const approval = await approve(book, plan);
    const admin = await database();

    try {
      await admin.query(
        `create function openerp.e2e_df11_endpoint() returns trigger language plpgsql as $$ begin if new.book_id = '${book.bookId}' then new.posting_date := '${postingDate}'::date; end if; return new; end $$`,
      );
      await admin.query(
        "create trigger a_e2e_df11_endpoint before insert on openerp.vouchers for each row execute function openerp.e2e_df11_endpoint()",
      );

      const receipt = await decoded(
        await request(book, `/change-sets/${plan.id}/execute`, {
          method: "POST",
          body: JSON.stringify(execution(plan, approval)),
        }),
        Accounting.ExecutionReceipt,
      );

      const boundaryChange =
        postingDate === "2026-01-01" ? "starts_on='2026-01-02'" : "ends_on='2026-12-30'";

      await expect(
        admin.query(
          `update openerp.periods set ${boundaryChange} where book_id=$1 and id='period_2026'`,
          [book.bookId],
        ),
      ).rejects.toMatchObject({ code: "P0001", detail: "InvalidJournal" });

      const retained = await admin.query(
        "select posting_date::text from openerp.vouchers where book_id=$1 and id=$2",
        [book.bookId, receipt.voucherId],
      );

      expect(retained.rows).toEqual([{ posting_date: postingDate }]);
      await writeFile(
        join(environment().artifacts, `df-11-endpoint-${postingDate}.json`),
        JSON.stringify({ postingDate, receipt, periodChangeRefused: true }, null, 2),
      );
    } finally {
      await admin.query("drop trigger if exists a_e2e_df11_endpoint on openerp.vouchers");
      await admin.query("drop function if exists openerp.e2e_df11_endpoint()");
      await admin.end();
    }
  },
);
