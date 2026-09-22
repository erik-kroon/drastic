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

test("runtime cannot bypass admission and posted records reject owner mutation", async () => {
  const book = await fixture();
  const receipt = await execute(book, await prepare(book));
  const runtime = new Client({ connectionString: environment().runtimeUrl });
  await runtime.connect();
  try {
    await expect(
      runtime.query("UPDATE openerp.books SET committed_sequence = 100 WHERE id = $1", [
        book.bookId,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime.query("DELETE FROM openerp.vouchers WHERE book_id = $1", [book.bookId]),
    ).rejects.toMatchObject({ code: "42501" });
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
  const rerun = await run("bun", ["scripts/migrate.ts"], options);
  expect(rerun.stdout).toContain("0001-accounting.sql: already applied");
  expect(await persisted(book)).toEqual(before);
  const admin = await database();
  const original = await admin.query<{ sha256: string }>(
    "SELECT sha256 FROM public.openerp_migrations WHERE name = '0001-accounting.sql'",
  );
  const checksum = original.rows[0]?.sha256;
  if (!checksum) throw new Error("Initial migration receipt missing");
  try {
    await admin.query(
      "UPDATE public.openerp_migrations SET sha256 = repeat('0', 64) WHERE name = '0001-accounting.sql'",
    );
    await expect(run("bun", ["scripts/migrate.ts"], options)).rejects.toMatchObject({
      stderr: expect.stringContaining("Add a forward migration instead"),
    });
  } finally {
    await admin.query(
      "UPDATE public.openerp_migrations SET sha256 = $1 WHERE name = '0001-accounting.sql'",
      [checksum],
    );
    await admin.end();
  }
  expect(await persisted(book)).toEqual(before);
});
