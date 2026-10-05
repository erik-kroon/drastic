import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import {
  approve,
  createSession,
  database,
  decoded,
  deleteSession,
  emptyPosting,
  environment,
  execution,
  failure,
  onePosting,
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
  expect(recovery.approvalObservation).toMatchObject({
    state: "authority_lost",
    approval: { id: approval.id, actorId: book.actorId },
    basis: {
      version: 1,
      policy: "generic-posting-authority-v1",
      actorId: book.actorId,
      permission: "approve_change",
      responsibilityRequired: true,
    },
  });
  expect(recovery.approvalConsumptions).toEqual([]);
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
  expect(recovery.approvalObservation).toMatchObject({
    state: "expired",
    approval: { id: approval.id, actorId: book.actorId },
    basis: {
      version: 1,
      policy: "generic-posting-authority-v1",
      actorId: book.actorId,
      permission: "approve_change",
      responsibilityRequired: true,
    },
  });
  expect(recovery.approvalConsumptions).toEqual([]);
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
  expect(recovery.approvalObservation).toMatchObject({
    state: "revoked",
    approval: { id: approval.id, actorId: book.actorId },
    basis: {
      version: 1,
      policy: "generic-posting-authority-v1",
      actorId: book.actorId,
      permission: "approve_change",
      responsibilityRequired: true,
    },
  });
  expect(recovery.approvalConsumptions).toEqual([]);
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

test("ending the approver session preserves a live approval and records current execution authority", async () => {
  const book = await fixture();
  const session = await createSession(book);
  const sessionBook = { ...book, token: session.token };
  const plan = await prepare(sessionBook);
  const approval = await approve(sessionBook, plan);

  expect(await deleteSession(session.id)).toBe(1);

  const receipt = await decoded(
    await request(book, `/change-sets/${plan.id}/execute`, {
      method: "POST",
      headers: { authorization: `Bearer ${book.agentToken}` },
      body: JSON.stringify(execution(plan, approval)),
    }),
    Accounting.ExecutionReceipt,
  );

  expect(await persisted(book)).toEqual(onePosting);

  const recovery = await decoded(
    await request(book, `/posting-recovery/${plan.id}`),
    Recovery.PostingRecovery,
  );

  expect(recovery.summary.executionReceipt).toEqual(receipt);
  expect(recovery.approvalObservation.state).toBe("consumed");
  expect(recovery.approvalConsumptions).toHaveLength(1);
  expect(recovery.approvalConsumptions[0]).toMatchObject({
    approvalId: approval.id,
    receiptId: receipt.id,
    approverBasis: { actorId: book.actorId, permission: "approve_change" },
    executorBasis: { actorId: book.agentId, permission: "execute_change" },
  });
  expect(JSON.stringify(recovery)).not.toContain(session.id);
  expect(JSON.stringify(recovery)).not.toContain("credentialHash");

  const admin = await database();

  try {
    const retained = await admin.query<{
      authority_basis: { authentication: { kind: string; sessionId: string } };
      approver_basis: { actorId: string };
      executor_basis: { actorId: string; authentication: { kind: string } };
    }>(
      `SELECT a.authority_basis, c.approver_basis, c.executor_basis
       FROM openerp.approvals a JOIN openerp.approval_consumptions c
         ON c.book_id = a.book_id AND c.approval_id = a.id
       WHERE a.book_id = $1 AND a.id = $2`,
      [book.bookId, approval.id],
    );

    expect(retained.rows).toHaveLength(1);
    expect(retained.rows[0]).toMatchObject({
      authority_basis: { authentication: { kind: "betterAuthSession", sessionId: session.id } },
      approver_basis: { actorId: book.actorId },
      executor_basis: { actorId: book.agentId, authentication: { kind: "apiCredential" } },
    });
    await expect(
      admin.query(
        "UPDATE openerp.approvals SET authority_basis = jsonb_set(authority_basis, '{checkedAt}', $3::jsonb) WHERE book_id = $1 AND id = $2",
        [book.bookId, approval.id, JSON.stringify("rewritten")],
      ),
    ).rejects.toMatchObject({ code: "P0001", detail: "Forbidden" });
    await expect(
      admin.query(
        "UPDATE openerp.approval_consumptions SET executor_basis = jsonb_set(executor_basis, '{checkedAt}', $3::jsonb) WHERE book_id = $1 AND approval_id = $2",
        [book.bookId, approval.id, JSON.stringify("rewritten")],
      ),
    ).rejects.toMatchObject({ code: "P0001", detail: "Forbidden" });
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "posting-ended-approver-session.json"),
    JSON.stringify(
      { plan, approval, receipt, recovery, persisted: await persisted(book) },
      null,
      2,
    ),
  );
});

test.each(["approver", "executor"] as const)(
  "expired current %s credential cannot grant or consume posting authority",
  async (role) => {
    const book = await fixture();
    const plan = await prepare(book);
    const approval = role === "executor" ? await approve(book, plan) : undefined;
    const admin = await database();

    try {
      const expired = await admin.query(
        "UPDATE openerp.credentials SET expires_at = clock_timestamp() - interval '1 second' WHERE actor_id = $1",
        [role === "approver" ? book.actorId : book.agentId],
      );

      expect(expired.rowCount).toBe(1);
    } finally {
      await admin.end();
    }

    if (approval === undefined) {
      await failure(
        await request(book, `/change-sets/${plan.id}/approvals`, {
          method: "POST",
          body: JSON.stringify({ planDigest: plan.planDigest, version: plan.version }),
        }),
        401,
        "Unauthorized",
      );
    } else {
      await failure(
        await request(book, `/change-sets/${plan.id}/execute`, {
          method: "POST",
          headers: { authorization: `Bearer ${book.agentToken}` },
          body: JSON.stringify(execution(plan, approval)),
        }),
        401,
        "Unauthorized",
      );
    }

    expect(await persisted(book)).toEqual(emptyPosting);
    await writeFile(
      join(environment().artifacts, `posting-expired-${role}-credential.json`),
      JSON.stringify({ role, plan, approval, persisted: await persisted(book) }, null, 2),
    );
  },
);
