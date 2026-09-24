import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import {
  approve,
  database,
  emptyPosting,
  evidence,
  execution,
  failure,
  fixture,
  journal,
  persisted,
  prepare,
  request,
} from "./support/fixtures";

test("cross-book reads and agent approval cannot cross authority boundaries", async () => {
  const owner = await fixture();
  const outsider = await fixture();
  const plan = await prepare(owner);
  await failure(
    await request(owner, `/change-sets/${plan.id}`, {
      headers: { authorization: `Bearer ${outsider.token}` },
    }),
    403,
    "Forbidden",
  );
  await failure(await request(outsider, `/change-sets/${plan.id}`), 404, "NotFound");
  await failure(
    await request(owner, `/change-sets/${plan.id}/approvals`, {
      method: "POST",
      headers: { authorization: `Bearer ${owner.agentToken}` },
      body: JSON.stringify({ planDigest: plan.planDigest, version: 1 }),
    }),
    403,
    "Forbidden",
  );
  expect(await persisted(owner)).toEqual(emptyPosting);
  expect(await persisted(outsider)).toEqual(emptyPosting);
});

test.each([
  [
    "locked period",
    "UPDATE openerp.periods SET locked = true WHERE book_id = $1",
    "StaleDependency",
  ],
  [
    "changed account",
    "UPDATE openerp.accounts SET version = version + 1 WHERE book_id = $1 AND id = 'account_bank'",
    "StaleDependency",
  ],
] satisfies [string, string, typeof Accounting.FailureCode.Type][])(
  "%s rejects execution without consuming approval or counters",
  async (_name, sql, code) => {
    const book = await fixture();
    const plan = await prepare(book);
    const approval = await approve(book, plan);
    const admin = await database();
    try {
      await admin.query(sql, [book.bookId]);
    } finally {
      await admin.end();
    }
    await failure(
      await request(book, `/change-sets/${plan.id}/execute`, {
        method: "POST",
        body: JSON.stringify(execution(plan, approval)),
      }),
      409,
      code,
    );
    expect(await persisted(book)).toEqual(emptyPosting);
  },
);

test("an approval for another plan or a tampered digest cannot post", async () => {
  const book = await fixture();
  const plan = await prepare(book);
  const other = await prepare(book);
  const approval = await approve(book, other);
  await failure(
    await request(book, `/change-sets/${plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify(execution(plan, approval)),
    }),
    403,
    "ApprovalRequired",
  );
  await failure(
    await request(book, `/change-sets/${plan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ planDigest: `sha256:${"0".repeat(64)}`, version: 1 }),
    }),
    409,
    "StaleDependency",
  );
  expect(await persisted(book)).toEqual(emptyPosting);
});

test.each(["-1", "1.5", "01", "1e3", "100000000000000000000000000000000000000"])(
  "wire amount %s is rejected before journaling",
  async (amount) => {
    const book = await fixture();
    const source = await evidence(book);
    const response = await request(book, "/change-sets", {
      method: "POST",
      body: JSON.stringify(journal(source.id, amount)),
    });
    expect(response.status, await response.text()).toBe(400);
    expect(await persisted(book)).toEqual(emptyPosting);
  },
);

test("unbalanced lines and missing evidence reject without journaling", async () => {
  const book = await fixture();
  const source = await evidence(book);
  const input = journal(source.id);
  await failure(
    await request(book, "/change-sets", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        lines: input.lines.map((line) =>
          line.creditMinor === "0" ? line : { ...line, creditMinor: "12499" },
        ),
      }),
    }),
    422,
    "InvalidJournal",
  );
  await failure(
    await request(book, "/change-sets", {
      method: "POST",
      body: JSON.stringify(journal("evidence_missing")),
    }),
    422,
    "MissingEvidence",
  );
  expect(await persisted(book)).toEqual(emptyPosting);
});
