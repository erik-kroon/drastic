import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import {
  approve,
  database,
  decoded,
  execution,
  fixture,
  onePosting,
  persisted,
  prepare,
  request,
} from "../support/fixtures";
import {
  cleanupOwned,
  freshCommandCount,
  saveSanitizedJourney,
  waitForBlockedExecutors,
} from "./database-support";

test("[ASR-RACE] two first executions really block before one commit and return one receipt", async () => {
  const book = await fixture();
  const plan = await prepare(book);
  const approval = await approve(book, plan);
  const commandKey = randomUUID();
  const blocker = await database();
  const observer = await database();
  const abort = new AbortController();
  let requests: Array<Promise<Response>> = [];
  let waiters: number[] = [];

  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM openerp.books WHERE id=$1 FOR UPDATE", [book.bookId]);

    const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
      ?.pid;

    if (pid === undefined) throw new Error("No blocker PID");
    requests = Array.from({ length: 2 }, () =>
      request(book, `/change-sets/${plan.id}/execute`, {
        method: "POST",
        headers: { "idempotency-key": commandKey },
        body: JSON.stringify(execution(plan, approval)),
        signal: abort.signal,
      }),
    );

    // Attach rejection handlers immediately; cleanup still observes both results.
    for (const pending of requests) void pending.catch(() => undefined);
    waiters = await waitForBlockedExecutors(observer, pid, 2);
    await blocker.query("COMMIT");

    const receipts = await Promise.all(
      requests.map(async (p) => decoded(await p, Accounting.ExecutionReceipt)),
    );

    expect(receipts[0]).toEqual(receipts[1]);
    expect(await persisted(book)).toEqual(onePosting);
    expect(await freshCommandCount(book, commandKey)).toBe(1);
    await saveSanitizedJourney("competing-first-execution", {
      bookId: book.bookId,
      commandKey,
      observedBlockedRuntimePids: waiters,
      receipts,
      persisted: await persisted(book),
    });
  } finally {
    abort.abort();
    await cleanupOwned([
      () => blocker.query("ROLLBACK"),
      () => Promise.allSettled(requests),
      () => blocker.end(),
      () => observer.end(),
    ]);
  }
});

test("[ASR-SCOPE-FRESHNESS] an unrelated book mutation does not stale this approved plan", async () => {
  const book = await fixture();
  const unrelated = await fixture();
  const plan = await prepare(book);
  const approval = await approve(book, plan);
  const otherPlan = await prepare(unrelated);
  const otherApproval = await approve(unrelated, otherPlan);
  await decoded(
    await request(unrelated, `/change-sets/${otherPlan.id}/execute`, {
      method: "POST",
      body: JSON.stringify(execution(otherPlan, otherApproval)),
    }),
    Accounting.ExecutionReceipt,
  );
  await decoded(
    await request(book, `/change-sets/${plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify(execution(plan, approval)),
    }),
    Accounting.ExecutionReceipt,
  );
  expect(await persisted(book)).toEqual(onePosting);
  expect(await persisted(unrelated)).toEqual(onePosting);
});
