import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import {
  database,
  decoded,
  environment,
  evidence,
  execute,
  failure,
  fixture,
  journal,
  key,
  persisted,
  post,
  request,
} from "./support/fixtures";

test.each(["wrong_account", "opposite_sign"])(
  "DF-12 rejects a malformed final bank match: %s",
  async (mode) => {
    const book = await fixture([
      { id: "account_revenue", code: "3000", name: "Synthetic revenue" },
    ]);

    const original = await evidence(book);
    const input = journal(original.id);

    const plan = await post(
      book,
      "/change-sets",
      {
        ...input,
        lines: [
          ...input.lines.slice(0, 1),
          {
            accountId: "account_clearing",
            debitMinor: "12500",
            creditMinor: "0",
            description: "Same sign, wrong account",
          },
          {
            accountId: "account_revenue",
            debitMinor: "0",
            creditMinor: "25000",
            description: "Synthetic balance",
          },
        ],
      },
      Accounting.ChangeSet,
    );

    const receipt = await execute(book, plan);

    const opposite = await post(
      book,
      "/change-sets",
      {
        ...journal(original.id),
        lines: [
          {
            accountId: "account_bank",
            debitMinor: "0",
            creditMinor: "12500",
            description: "Opposite bank sign",
          },
          {
            accountId: "account_clearing",
            debitMinor: "12500",
            creditMinor: "0",
            description: "Synthetic balance",
          },
        ],
      },
      Accounting.ChangeSet,
    );

    const oppositeReceipt = await execute(book, opposite);

    const bankLine = plan.groups[0]?.actions[0]?.lines.find(
      (line) => line.accountId === "account_bank",
    );

    const wrongLine =
      mode === "wrong_account"
        ? plan.groups[0]?.actions[0]?.lines.find((line) => line.accountId === "account_clearing")
        : opposite.groups[0]?.actions[0]?.lines.find((line) => line.accountId === "account_bank");

    if (!bankLine || !wrongLine)
      throw new Error("Synthetic match targets must retain line identities.");

    const source = {
      kind: "synthetic_bank_statement_v1",
      statementIdentifier: key(),
      sourceBankAccountId: "synthetic_bank",
      accountId: "account_bank",
      currency: "SEK",
      startsOn: "2026-09-01",
      endsOn: "2026-09-30",
      openingMinor: "0",
      closingMinor: "12500",
      completeness: { declaredComplete: false, basis: "Synthetic integrity probe" },
      rows: [
        {
          rowOrdinal: 1,
          providerId: null,
          date: "2026-09-22",
          description: "Synthetic receipt",
          amountMinor: "12500",
        },
      ],
    };

    const retained = await post(
      book,
      "/evidence",
      {
        title: "DF-12 synthetic statement",
        mediaType: "application/json",
        content: JSON.stringify(source),
        origin: "DF-12 E2E",
      },
      Accounting.Evidence,
    );

    const imported = await post(
      book,
      "/bank-statements",
      {
        ...source,
        evidenceId: retained.id,
        existingMatches: [],
      },
      Bank.StatementImportReceipt,
    );

    const target = {
      statementId: imported.statement.id,
      rowOrdinal: 1,
      voucherId: receipt.voucherId,
      lineId: bankLine.lineId,
    };

    const wrongVoucherId = mode === "wrong_account" ? receipt.voucherId : oppositeReceipt.voucherId;

    const before = await persisted(book);
    const requestKey = key();

    const command = {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body: JSON.stringify(target),
    };

    const admin = await database();

    try {
      const sourceBefore = await admin.query(
        "select revision::text from openerp.bank_sources where book_id=$1 and account_id='account_bank'",
        [book.bookId],
      );

      await admin.query(
        `create function openerp.e2e_df12_fault() returns trigger language plpgsql as $$ begin if new.book_id = '${book.bookId}' then new.voucher_id := '${wrongVoucherId}'; new.line_id := '${wrongLine.lineId}'; end if; return new; end $$`,
      );
      await admin.query(
        "create trigger a_e2e_df12_fault before insert on openerp.bank_matches for each row execute function openerp.e2e_df12_fault()",
      );
      await failure(await request(book, "/bank-matches", command), 422, "InvalidJournal");
      expect(await persisted(book)).toEqual(before);

      const matches = await admin.query(
        "select count(*)::int as count from openerp.bank_matches where book_id=$1",
        [book.bookId],
      );

      expect(matches.rows).toEqual([{ count: 0 }]);

      const sourceAfter = await admin.query(
        "select revision::text from openerp.bank_sources where book_id=$1 and account_id='account_bank'",
        [book.bookId],
      );

      expect(sourceAfter.rows).toEqual(sourceBefore.rows);

      const commands = await admin.query(
        "select count(*)::int as count from openerp.command_receipts where book_id=$1 and key=$2",
        [book.bookId, requestKey],
      );

      expect(commands.rows).toEqual([{ count: 0 }]);
    } finally {
      await admin.query("drop trigger if exists a_e2e_df12_fault on openerp.bank_matches");
      await admin.query("drop function if exists openerp.e2e_df12_fault()");
      await admin.end();
    }

    const matched = await decoded(
      await request(book, "/bank-matches", command),
      Bank.BankMatchReceipt,
    );

    expect(matched.match.lineId).toBe(bankLine.lineId);
    expect(matched.match.voucherId).toBe(receipt.voucherId);
    expect(
      await decoded(await request(book, "/bank-matches", command), Bank.BankMatchReceipt),
    ).toEqual(matched);
    expect(await persisted(book)).toEqual(before);

    const observer = await database();

    try {
      const retainedMatches = await observer.query(
        'select voucher_id as "voucherId", line_id as "lineId" from openerp.bank_matches where book_id=$1',
        [book.bookId],
      );

      expect(retainedMatches.rows).toEqual([
        { voucherId: receipt.voucherId, lineId: bankLine.lineId },
      ]);
    } finally {
      await observer.end();
    }

    await writeFile(
      join(environment().artifacts, `df-12-${mode}.json`),
      JSON.stringify({ mode, target, matched, before, sameKeyRecovered: true }, null, 2),
    );
  },
);
