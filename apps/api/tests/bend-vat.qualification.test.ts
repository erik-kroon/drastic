import { expect, test } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as Accounting from "@open-erp/contracts/accounting";
import {
  database,
  decoded,
  environment,
  evidence,
  execute,
  fixture,
  journal,
  request,
  run,
} from "./support/fixtures";

test("qualified Bend arithmetic survives actual capture, sealing, replay and posting", async () => {
  const book = await fixture();
  const source = await evidence(book);
  const admin = await database();

  try {
    for (const [id, code] of [
      ["vat_output", "2611"],
      ["vat_input", "2641"],
      ["vat_settlement", "2650"],
    ]) {
      await admin.query("INSERT INTO openerp.accounts(book_id,id,code,name) VALUES($1,$2,$3,$2)", [
        book.bookId,
        id,
        code,
      ]);
    }
  } finally {
    await admin.end();
  }

  const vouchers: string[] = [];

  for (const lines of [
    [
      { accountId: "account_bank", debitMinor: "995", creditMinor: "0" },
      { accountId: "account_clearing", debitMinor: "0", creditMinor: "796" },
      { accountId: "vat_output", debitMinor: "0", creditMinor: "199" },
    ],
    [
      { accountId: "account_clearing", debitMinor: "404", creditMinor: "0" },
      { accountId: "vat_input", debitMinor: "101", creditMinor: "0" },
      { accountId: "account_bank", debitMinor: "0", creditMinor: "505" },
    ],
  ]) {
    const plan = await decoded(
      await request(book, "/change-sets", {
        method: "POST",
        body: JSON.stringify({
          ...journal(source.id),
          lines: lines.map((line) => ({ ...line, description: "Synthetic VAT source" })),
        }),
      }),
      Accounting.ChangeSet,
    );

    const receipt = await execute(book, plan);
    vouchers.push(receipt.voucherId);
  }

  const reportPath = join(environment().artifacts, "bend-host.json");
  await run("bun", ["apps/api/tests/support/bend-vat-host.mjs"], {
    cwd: resolve(import.meta.dirname, "../../.."),
    env: {
      ...process.env,
      OPENERP_HOST_INPUT: JSON.stringify({
        ...environment(),
        book,
        evidenceId: source.id,
        vouchers,
        reportPath,
      }),
    },
  });

  const report = JSON.parse(await readFile(reportPath, "utf8"));
  expect(report.status).toBe("passed");
  expect(report.checks.every((check: { status: string }) => check.status === "passed")).toBe(true);

  // A deliberately synthetic journal drives the existing approval/execution owner.
  const retainedEvidence = await decoded(
    await request(book, "/evidence", {
      method: "POST",
      body: JSON.stringify({
        title: "Retained calculation",
        content: JSON.stringify(report.saved),
        mediaType: "application/json",
        origin: "Bend host qualification",
      }),
    }),
    Accounting.Evidence,
  );

  const approvedAmount = report.saved.calculation.boxes.find(
    (row: { box: string }) => row.box === "10",
  ).reportedMinor;

  const plan = await decoded(
    await request(book, "/change-sets", {
      method: "POST",
      body: JSON.stringify(journal(retainedEvidence.id, approvedAmount)),
    }),
    Accounting.ChangeSet,
  );

  const receipt = await execute(book, plan);
  const observed = await database();

  try {
    const rows = await observed.query<{ debit: string }>(
      "SELECT sum(debit_minor)::text AS debit FROM openerp.journal_lines WHERE book_id=$1 AND voucher_id=$2",
      [book.bookId, receipt.voucherId],
    );

    expect(rows.rows[0]?.debit).toBe(approvedAmount);
  } finally {
    await observed.end();
  }

  report.assertions += 4;
  report.checks.push({ name: "approved-output-not-recomputed", status: "passed" });
  report.approvedJournal = {
    planId: plan.id,
    planDigest: plan.planDigest,
    voucherId: receipt.voucherId,
    amountMinor: approvedAmount,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
});
