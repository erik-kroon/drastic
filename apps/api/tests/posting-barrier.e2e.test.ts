import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import {
  approve,
  database,
  decoded,
  emptyPosting,
  execution,
  failure,
  fixture,
  ledger,
  onePosting,
  persisted,
  prepare,
  request,
  type BookFixture,
} from "./support/fixtures";
import {
  cleanupOwned,
  freshCommandCount,
  rawVoucherRows,
  saveSanitizedJourney,
  waitForBlockedExecutors,
} from "./assurance/database-support";

async function orderedBookRace(
  book: BookFixture,
  commands: readonly [
    (signal: AbortSignal) => Promise<Response>,
    (signal: AbortSignal) => Promise<Response>,
  ],
) {
  const blocker = await database();
  const observer = await database();
  const abort = new AbortController();
  const pending: Array<Promise<Response>> = [];

  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM openerp.books WHERE id=$1 FOR UPDATE", [book.bookId]);

    const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
      ?.pid;

    if (pid === undefined) throw new Error("No book blocker PID");

    const first = commands[0](abort.signal);

    pending.push(first);
    void first.catch(() => undefined);

    const firstWaiters = await waitForBlockedExecutors(observer, pid, 1);
    const second = commands[1](abort.signal);

    pending.push(second);
    void second.catch(() => undefined);

    const bothWaiters = await waitForBlockedExecutors(observer, pid, 2);

    await blocker.query("COMMIT");

    const retainResponse = async (pendingResponse: Promise<Response>) => {
      const response = await pendingResponse;

      return new Response(await response.arrayBuffer(), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };

    const responses = await Promise.all([retainResponse(first), retainResponse(second)]);

    return { responses, firstWaiters, bothWaiters };
  } finally {
    abort.abort();
    await cleanupOwned([
      () => blocker.query("ROLLBACK"),
      () => Promise.allSettled(pending),
      () => blocker.end(),
      () => observer.end(),
    ]);
  }
}

test("different first execution keys contend for one approved effect", async () => {
  const book = await fixture();
  const plan = await prepare(book);
  const approval = await approve(book, plan);
  const keys = [randomUUID(), randomUUID()] as const;

  expect(await freshCommandCount(book, keys[0])).toBe(0);
  expect(await freshCommandCount(book, keys[1])).toBe(0);

  const race = await orderedBookRace(book, [
    (signal) =>
      request(book, `/change-sets/${plan.id}/execute`, {
        method: "POST",
        headers: { authorization: `Bearer ${book.agentToken}`, "idempotency-key": keys[0] },
        body: JSON.stringify(execution(plan, approval)),
        signal,
      }),
    (signal) =>
      request(book, `/change-sets/${plan.id}/execute`, {
        method: "POST",
        headers: { authorization: `Bearer ${book.agentToken}`, "idempotency-key": keys[1] },
        body: JSON.stringify(execution(plan, approval)),
        signal,
      }),
  ]);

  const receipt = await decoded(race.responses[0], Accounting.ExecutionReceipt);

  await failure(race.responses[1], 409, "AlreadyPosted");
  expect(await persisted(book)).toEqual(onePosting);
  expect(await freshCommandCount(book, keys[0])).toBe(1);
  expect(await freshCommandCount(book, keys[1])).toBe(0);

  const recovery = await decoded(
    await request(book, `/posting-recovery/${plan.id}`),
    Recovery.PostingRecovery,
  );

  expect(recovery.availableApproval).toBeNull();
  expect(recovery.approvalObservation.state).toBe("consumed");
  expect(recovery.approvalConsumptions).toHaveLength(1);
  expect(recovery.approvalConsumptions[0]).toMatchObject({
    approvalId: approval.id,
    approverBasis: {
      actorId: book.actorId,
      permission: "approve_change",
      membershipRole: "operator",
      responsibilityRequired: true,
      scope: { entityId: book.entityId, bookId: book.bookId },
    },
    executorBasis: {
      actorId: book.agentId,
      permission: "execute_change",
      membershipRole: "agent",
      scope: { entityId: book.entityId, bookId: book.bookId },
    },
  });
  expect(JSON.stringify(recovery)).not.toContain("credentialHash");
  expect(JSON.stringify(recovery)).not.toContain("sessionId");

  const current = await ledger(book);

  expect(
    current.accounts.find((account) => account.accountId === "account_bank")?.balanceMinor,
  ).toBe("12500");
  expect(
    current.accounts.find((account) => account.accountId === "account_clearing")?.balanceMinor,
  ).toBe("-12500");
  await saveSanitizedJourney("different-first-execution-keys", {
    receipt,
    recovery,
    keys,
    firstWaiters: race.firstWaiters,
    bothWaiters: race.bothWaiters,
    ledger: current,
    persisted: await persisted(book),
    rawLines: await rawVoucherRows(book),
  });
});

test.each(["revoke_first", "execute_first"] as const)(
  "public approval revocation and execution serialize under the book barrier: %s",
  async (order) => {
    const book = await fixture();
    const plan = await prepare(book);
    const approval = await approve(book, plan);
    const executeKey = randomUUID();

    const saved = await decoded(
      await request(book, "/saved-posting-authority-requests", {
        method: "POST",
        body: JSON.stringify({
          operation: "revoke_approval",
          id: approval.id,
          input: { reason: "Synthetic ordered withdrawal" },
        }),
      }),
      Recovery.SavedPostingRequest,
    );

    expect(await freshCommandCount(book, executeKey)).toBe(0);

    const revoke = (signal: AbortSignal) =>
      request(book, `/saved-posting-authority-requests/${saved.request.key}/run`, {
        method: "POST",
        signal,
      });

    const execute = (signal: AbortSignal) =>
      request(book, `/change-sets/${plan.id}/execute`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${book.agentToken}`,
          "idempotency-key": executeKey,
        },
        body: JSON.stringify(execution(plan, approval)),
        signal,
      });

    const race = await orderedBookRace(
      book,
      order === "revoke_first" ? [revoke, execute] : [execute, revoke],
    );

    if (order === "revoke_first") {
      const revoked = await decoded(race.responses[0], Recovery.SavedPostingRequest);

      expect(revoked.outcome).toMatchObject({
        state: "committed",
        result: { approvalId: approval.id, reason: "Synthetic ordered withdrawal" },
      });
      await failure(race.responses[1], 403, "ApprovalRequired");
      expect(await persisted(book)).toEqual(emptyPosting);
      expect(await freshCommandCount(book, executeKey)).toBe(0);
    } else {
      await decoded(race.responses[0], Accounting.ExecutionReceipt);

      const revoked = await decoded(race.responses[1], Recovery.SavedPostingRequest);

      expect(revoked.outcome).toMatchObject({
        state: "refused",
        refusal: { code: "AlreadyPosted" },
      });
      expect(await persisted(book)).toEqual(onePosting);
      expect(await freshCommandCount(book, executeKey)).toBe(1);
    }

    await saveSanitizedJourney(`public-revocation-${order}`, {
      approval,
      executeKey,
      savedKey: saved.request.key,
      firstWaiters: race.firstWaiters,
      bothWaiters: race.bothWaiters,
      persisted: await persisted(book),
      ledger: await ledger(book),
      rawLines: await rawVoucherRows(book),
    });
  },
);

test("approval expiry while execution waits is checked after the book barrier", async () => {
  const book = await fixture();
  const plan = await prepare(book);
  const approval = await approve(book, plan);
  const executeKey = randomUUID();
  const blocker = await database();
  const observer = await database();
  const abort = new AbortController();
  const pending: Array<Promise<Response>> = [];

  try {
    await blocker.query("ALTER TABLE openerp.approvals DISABLE TRIGGER ALL");

    try {
      await blocker.query(
        "UPDATE openerp.approvals SET expires_at = clock_timestamp() + interval '5 seconds' WHERE book_id = $1 AND id = $2",
        [book.bookId, approval.id],
      );
    } finally {
      await blocker.query("ALTER TABLE openerp.approvals ENABLE TRIGGER ALL");
    }

    expect(await freshCommandCount(book, executeKey)).toBe(0);
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM openerp.books WHERE id=$1 FOR UPDATE", [book.bookId]);

    const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
      ?.pid;

    if (pid === undefined) throw new Error("No expiry blocker PID");

    const response = request(book, `/change-sets/${plan.id}/execute`, {
      method: "POST",
      headers: { authorization: `Bearer ${book.agentToken}`, "idempotency-key": executeKey },
      body: JSON.stringify(execution(plan, approval)),
      signal: abort.signal,
    });

    pending.push(response);
    void response.catch(() => undefined);

    const waiters = await waitForBlockedExecutors(observer, pid, 1);

    const clock = () =>
      observer.query<{ checked_at: string; expires_at: string; expired: boolean }>(
        "SELECT clock_timestamp()::text AS checked_at, expires_at::text, clock_timestamp() >= expires_at AS expired FROM openerp.approvals WHERE book_id = $1 AND id = $2",
        [book.bookId, approval.id],
      );

    const before = (await clock()).rows[0];

    expect(before?.expired).toBe(false);

    let after = before;
    const deadline = Date.now() + 8_000;

    while (after?.expired === false && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      after = (await clock()).rows[0];
    }

    expect(after?.expired).toBe(true);
    await blocker.query("COMMIT");
    await failure(await response, 403, "ApprovalRequired");
    expect(await persisted(book)).toEqual(emptyPosting);
    expect(await freshCommandCount(book, executeKey)).toBe(0);

    const recovery = await decoded(
      await request(book, `/posting-recovery/${plan.id}`),
      Recovery.PostingRecovery,
    );

    expect(recovery.approvalObservation.state).toBe("expired");
    expect(recovery.approvalConsumptions).toEqual([]);
    await saveSanitizedJourney("expiry-during-book-wait", {
      executeKey,
      waiters,
      before,
      after,
      recovery,
      persisted: await persisted(book),
      ledger: await ledger(book),
    });
  } finally {
    abort.abort();
    await cleanupOwned([
      () => blocker.query("ROLLBACK"),
      () => Promise.allSettled(pending),
      () => blocker.end(),
      () => observer.end(),
    ]);
  }
});
