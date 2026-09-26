import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import {
  apiDirectory,
  approve,
  database,
  decoded,
  emptyPosting,
  environment,
  execute,
  execution,
  fixture,
  onePosting,
  persisted,
  prepare,
  request,
  run,
  saveEvidence,
} from "./support/fixtures";

test("runtime has scoped DML while protected posting history rejects mutation", async () => {
  const book = await fixture();
  const otherBook = await fixture();
  const receipt = await execute(book, await prepare(book));
  const otherReceipt = await execute(otherBook, await prepare(otherBook));
  const runtime = new Client({ connectionString: environment().runtimeUrl });
  await runtime.connect();

  try {
    const evidenceId = `evidence_runtime_${randomBytes(8).toString("hex")}`;
    const content = "Synthetic runtime grant probe";
    await runtime.query(
      `INSERT INTO openerp.evidence(book_id, id, title, content, media_type, origin, sha256, created_by)
      VALUES ($1, $2, 'Runtime grant probe', $3, 'text/plain', 'E2E grant probe',
        encode(sha256(convert_to($3, 'UTF8')), 'hex'), $4)`,
      [book.bookId, evidenceId, content, book.actorId],
    );
    const observer = await database();

    try {
      const observed = await observer.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM openerp.evidence WHERE book_id = $1 AND id = $2 AND sha256 = encode(sha256(convert_to($3, 'UTF8')), 'hex')",
        [book.bookId, evidenceId, content],
      );

      expect(observed.rows).toEqual([{ count: 1 }]);
    } finally {
      await observer.end();
    }

    const lineSuffix = randomBytes(8).toString("hex");
    await expect(
      runtime.query(
        `INSERT INTO openerp.journal_lines(book_id, voucher_id, id, ordinal, account_id, debit_minor, credit_minor, description)
        VALUES
          ($1, $2, $3, 3, 'account_bank', 1, 0, 'Runtime append debit'),
          ($1, $2, $4, 4, 'account_clearing', 0, 1, 'Runtime append credit')`,
        [
          book.bookId,
          receipt.voucherId,
          `line_runtime_debit_${lineSuffix}`,
          `line_runtime_credit_${lineSuffix}`,
        ],
      ),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      runtime.query(
        "UPDATE openerp.vouchers SET number = number + 100 WHERE book_id = $1 AND id = $2",
        [book.bookId, receipt.voucherId],
      ),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      runtime.query("DELETE FROM openerp.vouchers WHERE book_id = $1 AND id = $2", [
        book.bookId,
        receipt.voucherId,
      ]),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      runtime.query(
        "UPDATE openerp.journal_lines SET description = 'Runtime mutation' WHERE book_id = $1 AND voucher_id = $2",
        [book.bookId, receipt.voucherId],
      ),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      runtime.query("DELETE FROM openerp.journal_lines WHERE book_id = $1 AND voucher_id = $2", [
        book.bookId,
        receipt.voucherId,
      ]),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      runtime.query("TRUNCATE TABLE openerp.journal_lines, openerp.vouchers"),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      runtime.query(
        `INSERT INTO openerp.journal_lines(book_id, voucher_id, id, ordinal, account_id, debit_minor, credit_minor, description)
        VALUES ($1, $2, $3, 3, 'account_bank', 1, 0, 'Cross-book runtime append')`,
        [book.bookId, otherReceipt.voucherId, `line_runtime_cross_${lineSuffix}`],
      ),
    ).rejects.toBeInstanceOf(Error);
  } finally {
    await runtime.end();
  }

  const admin = await database();

  try {
    await expect(
      admin.query("UPDATE openerp.vouchers SET number = 2 WHERE book_id = $1 AND id = $2", [
        book.bookId,
        receipt.voucherId,
      ]),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      admin.query("DELETE FROM openerp.journal_lines WHERE book_id = $1", [book.bookId]),
    ).rejects.toMatchObject({ code: "P0001" });
  } finally {
    await admin.end();
  }

  expect(await persisted(book)).toEqual(onePosting);
  expect(await persisted(otherBook)).toEqual(onePosting);
});

test("a late database fault rolls back the complete posting and leaves a retry usable", async () => {
  const book = await fixture();
  const plan = await prepare(book);
  const approval = await approve(book, plan);
  const admin = await database();
  const idempotencyKey = crypto.randomUUID();

  const command = {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: JSON.stringify(execution(plan, approval)),
  };

  try {
    await admin.query(`CREATE FUNCTION openerp.e2e_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.book_id = '${book.bookId}' THEN RAISE EXCEPTION 'E2E injected outbox failure'; END IF; RETURN NEW; END $$`);
    await admin.query(
      "CREATE TRIGGER e2e_outbox_fault BEFORE INSERT ON openerp.outbox FOR EACH ROW EXECUTE FUNCTION openerp.e2e_reject_outbox()",
    );
    const response = await request(book, `/change-sets/${plan.id}/execute`, command);
    expect(response.status, await response.text()).toBe(500);
    expect(await persisted(book)).toEqual(emptyPosting);

    const commands = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM openerp.command_receipts WHERE book_id = $1 AND key = $2",
      [book.bookId, idempotencyKey],
    );

    expect(commands.rows).toEqual([{ count: 0 }]);
  } finally {
    await admin.query("DROP TRIGGER IF EXISTS e2e_outbox_fault ON openerp.outbox");
    await admin.query("DROP FUNCTION IF EXISTS openerp.e2e_reject_outbox()");
    await admin.end();
  }

  await decoded(
    await request(book, `/change-sets/${plan.id}/execute`, command),
    Accounting.ExecutionReceipt,
  );
  expect(await persisted(book)).toEqual(onePosting);
  await saveEvidence("atomic-rollback-and-retry", book);
});

test("migration rerun preserves posted state and checksum drift stops the migrator", async () => {
  const book = await fixture();
  await execute(book, await prepare(book));
  const before = await persisted(book);

  const options = {
    cwd: apiDirectory,
    env: { ...process.env, DATABASE_ADMIN_URL: environment().adminUrl },
  };

  // Name the migration set as it exists, not by a reviewed file number.
  const [applied] = (await readdir(join(apiDirectory, "migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  if (!applied) throw new Error("No applied migration file to rerun");
  const rerun = await run("bun", ["scripts/migrate.ts"], options);
  expect(rerun.stdout).toContain(`${applied}: already applied`);
  expect(await persisted(book)).toEqual(before);
  const admin = await database();

  const original = await admin.query<{ sha256: string }>(
    "SELECT sha256 FROM public.openerp_migrations WHERE name = $1",
    [applied],
  );

  const checksum = original.rows[0]?.sha256;

  if (!checksum) throw new Error("Initial migration receipt missing");

  try {
    await admin.query(
      "UPDATE public.openerp_migrations SET sha256 = repeat('0', 64) WHERE name = $1",
      [applied],
    );
    await expect(run("bun", ["scripts/migrate.ts"], options)).rejects.toMatchObject({
      stderr: expect.stringContaining("Add a forward migration instead"),
    });
  } finally {
    await admin.query("UPDATE public.openerp_migrations SET sha256 = $1 WHERE name = $2", [
      checksum,
      applied,
    ]);
    await admin.end();
  }

  expect(await persisted(book)).toEqual(before);
});
