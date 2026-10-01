import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import {
  approve,
  database,
  decoded,
  environment,
  evidence,
  execute,
  execution,
  failure,
  fixture,
  journal,
  key,
  persisted,
  post,
  request,
} from "./support/fixtures";

test.each(["vouchers", "commerce_invoices"])(
  "DF-08 refuses a final write after its period becomes locked: %s",
  async (table) => {
    const book = await fixture([{ id: "account_receivable", code: "1510", name: "Synthetic AR" }]);
    const source = await evidence(book);
    const input = journal(source.id);

    const plan = await post(
      book,
      "/change-sets",
      {
        ...input,
        lines: input.lines.map((line) =>
          line.accountId === "account_bank" ? { ...line, accountId: "account_receivable" } : line,
        ),
      },
      Accounting.ChangeSet,
    );

    const approval = await approve(book, plan);
    let path = `/change-sets/${plan.id}/execute`;
    let body: unknown = execution(plan, approval);

    if (table === "commerce_invoices") {
      const receipt = await execute(book, plan);

      const line = plan.groups[0]?.actions[0]?.lines.find(
        (item) => item.accountId === "account_receivable",
      );

      if (!line) throw new Error("Synthetic invoice requires its retained control line.");

      const party = await post(
        book,
        "/commerce/counterparties",
        {
          kind: "synthetic_counterparty_v1",
          externalKey: key(),
          role: "customer",
          displayName: "Synthetic lock customer",
          evidenceId: source.id,
          reason: "DF-08 synthetic anchor",
        },
        Commerce.CounterpartyRevision,
      );

      path = "/commerce/invoices";
      body = {
        kind: "synthetic_invoice_v1",
        direction: "customer",
        counterpartyId: party.id,
        counterpartyRevision: party.revision,
        documentNumber: "DF08-SYNTHETIC",
        issuedOn: "2026-09-22",
        dueOn: "2026-10-22",
        currency: "SEK",
        amountMinor: "12500",
        controlAccountId: "account_receivable",
        recognitionVoucherId: receipt.voucherId,
        recognitionLineId: line.lineId,
        evidenceId: source.id,
        description: "Synthetic document anchor",
      };
    }

    const before = await persisted(book);
    const requestKey = key();

    const command = {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body: JSON.stringify(body),
    };

    const admin = await database();

    try {
      await admin.query(
        `create function openerp.e2e_df08_fault() returns trigger language plpgsql as $$ begin if new.book_id = '${book.bookId}' then update openerp.periods set locked=true where book_id=new.book_id and id='period_2026'; end if; return new; end $$`,
      );
      await admin.query(
        `create trigger a_e2e_df08_fault before insert on openerp.${table} for each row execute function openerp.e2e_df08_fault()`,
      );
      await failure(await request(book, path, command), 409, "PeriodLocked");
      expect(await persisted(book)).toEqual(before);

      const periods = await admin.query(
        "select locked from openerp.periods where book_id=$1 and id='period_2026'",
        [book.bookId],
      );

      expect(periods.rows).toEqual([{ locked: false }]);

      const commands = await admin.query(
        "select count(*)::int as count from openerp.command_receipts where book_id=$1 and key=$2",
        [book.bookId, requestKey],
      );

      expect(commands.rows).toEqual([{ count: 0 }]);

      const invoices = await admin.query(
        "select count(*)::int as count from openerp.commerce_invoices where book_id=$1",
        [book.bookId],
      );

      expect(invoices.rows).toEqual([{ count: 0 }]);
    } finally {
      await admin.query(`drop trigger if exists a_e2e_df08_fault on openerp.${table}`);
      await admin.query("drop function if exists openerp.e2e_df08_fault()");
      await admin.end();
    }

    const receipt =
      table === "vouchers"
        ? await decoded(await request(book, path, command), Accounting.ExecutionReceipt)
        : await decoded(await request(book, path, command), Commerce.Invoice);

    expect((await persisted(book))?.vouchers).toBe(1);

    const observer = await database();

    try {
      await observer.query(
        "update openerp.periods set locked=true where book_id=$1 and id='period_2026'",
        [book.bookId],
      );
    } finally {
      await observer.end();
    }

    const committed = await persisted(book);

    const replayed =
      table === "vouchers"
        ? await decoded(await request(book, path, command), Accounting.ExecutionReceipt)
        : await decoded(await request(book, path, command), Commerce.Invoice);

    expect(replayed).toEqual(receipt);
    expect(await persisted(book)).toEqual(committed);
    await writeFile(
      join(environment().artifacts, `df-08-${table}.json`),
      JSON.stringify(
        { table, before, receipt, sameKeyRecovered: true, lockedReplayPreserved: true },
        null,
        2,
      ),
    );
  },
);
