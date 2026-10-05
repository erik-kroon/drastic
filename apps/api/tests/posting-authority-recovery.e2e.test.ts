import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import {
  approve,
  createSession,
  database,
  decoded,
  emptyPosting,
  environment,
  execution,
  failure,
  fixture,
  persisted,
  prepare,
  request,
} from "./support/fixtures";

test("disabled approver is unavailable in recovery and cannot authorize an agent posting", async () => {
  const book = await fixture();
  await createSession(book);
  const plan = await prepare(book);
  const approval = await approve(book, plan);
  const admin = await database();

  try {
    const disabled = await admin.query(
      "UPDATE openerp.identity_admissions SET enabled = false WHERE actor_id = $1",
      [book.actorId],
    );

    expect(disabled.rowCount).toBe(1);
  } finally {
    await admin.end();
  }

  const agent = { authorization: `Bearer ${book.agentToken}` };

  const recovery = await decoded(
    await request(book, `/posting-recovery/${plan.id}`, { headers: agent }),
    Recovery.PostingRecovery,
  );

  expect(recovery.availableApproval).toBeNull();
  expect(recovery.requests.find((entry) => entry.resultId === approval.id)?.approvalState).toBe(
    "authority_lost",
  );
  await failure(
    await request(book, `/change-sets/${plan.id}/execute`, {
      method: "POST",
      headers: agent,
      body: JSON.stringify(execution(plan, approval)),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await persisted(book)).toEqual(emptyPosting);
  await writeFile(
    join(environment().artifacts, "posting-disabled-approver-recovery.json"),
    JSON.stringify({ plan, approval, recovery, persisted: await persisted(book) }, null, 2),
  );
});

test("expired unused approval refuses execution and remains visible in recovery", async () => {
  const book = await fixture();
  const plan = await prepare(book);
  const approval = await approve(book, plan);
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

  const recovery = await decoded(
    await request(book, `/posting-recovery/${plan.id}`),
    Recovery.PostingRecovery,
  );

  expect(recovery.availableApproval).toBeNull();
  expect(recovery.requests.find((entry) => entry.resultId === approval.id)?.approvalState).toBe(
    "expired",
  );
  await failure(
    await request(book, `/change-sets/${plan.id}/execute`, {
      method: "POST",
      headers: { authorization: `Bearer ${book.agentToken}` },
      body: JSON.stringify(execution(plan, approval)),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await persisted(book)).toEqual(emptyPosting);
  await writeFile(
    join(environment().artifacts, "posting-expired-unused-approval.json"),
    JSON.stringify({ plan, approval, recovery, persisted: await persisted(book) }, null, 2),
  );
});

test("public approval revocation prevents execution and retains its exact reason", async () => {
  const book = await fixture();
  const plan = await prepare(book);
  const approval = await approve(book, plan);

  const saved = await decoded(
    await request(book, "/saved-posting-authority-requests", {
      method: "POST",
      body: JSON.stringify({
        operation: "revoke_approval",
        id: approval.id,
        input: { reason: "Synthetic review withdrawn" },
      }),
    }),
    Recovery.SavedPostingRequest,
  );

  const revoked = await decoded(
    await request(book, `/saved-posting-authority-requests/${saved.request.key}/run`, {
      method: "POST",
    }),
    Recovery.SavedPostingRequest,
  );

  expect(revoked.outcome).toMatchObject({
    state: "committed",
    result: { approvalId: approval.id, reason: "Synthetic review withdrawn" },
  });

  const recovery = await decoded(
    await request(book, `/posting-recovery/${plan.id}`),
    Recovery.PostingRecovery,
  );

  expect(recovery.availableApproval).toBeNull();
  expect(recovery.requests.find((entry) => entry.resultId === approval.id)?.approvalState).toBe(
    "revoked",
  );
  await failure(
    await request(book, `/change-sets/${plan.id}/execute`, {
      method: "POST",
      headers: { authorization: `Bearer ${book.agentToken}` },
      body: JSON.stringify(execution(plan, approval)),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await persisted(book)).toEqual(emptyPosting);
  await writeFile(
    join(environment().artifacts, "posting-public-revocation-recovery.json"),
    JSON.stringify(
      { plan, approval, revoked, recovery, persisted: await persisted(book) },
      null,
      2,
    ),
  );
});
