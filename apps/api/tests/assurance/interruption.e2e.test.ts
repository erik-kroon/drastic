import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import {
  approve,
  database,
  decoded,
  emptyPosting,
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
  waitForBlockedExecutors,
  saveSanitizedJourney,
} from "./database-support";

test("[ASR-DB-KILL] terminating the blocked posting backend rolls back a late in-flight transaction", async () => {
  const book = await fixture();

  if (!/^[a-z][a-z0-9_-]{2,127}$/.test(book.bookId)) throw new Error("Unsafe fixture ID");
  const plan = await prepare(book);
  const approval = await approve(book, plan);
  const commandKey = randomUUID();

  const command = {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify(execution(plan, approval)),
  };

  const marker = `assurance_barrier_${randomBytes(8).toString("hex")}`;
  const setup = await database();
  const blocker = await database();
  const observer = await database();
  const abort = new AbortController();
  let pending: Promise<Response> | undefined;
  let victim: number | undefined;

  try {
    // Disposable test-only instrumentation. No advisory lock or production hook.
    await setup.query(`CREATE TABLE openerp.${marker}(id integer PRIMARY KEY)`);
    await setup.query(`INSERT INTO openerp.${marker} VALUES (1)`);
    await setup.query(`GRANT SELECT, UPDATE ON openerp.${marker} TO openerp_runtime`);
    await setup.query(`CREATE FUNCTION openerp.${marker}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.book_id='${book.bookId}' THEN
        PERFORM id FROM openerp.${marker} WHERE id=1 FOR UPDATE;
      END IF; RETURN NEW; END $$`);
    await setup.query(
      `CREATE TRIGGER ${marker} BEFORE INSERT ON openerp.outbox FOR EACH ROW EXECUTE FUNCTION openerp.${marker}()`,
    );
    await blocker.query("BEGIN");
    await blocker.query(`SELECT id FROM openerp.${marker} WHERE id=1 FOR UPDATE`);

    const blockerPid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
      .rows[0]?.pid;

    if (blockerPid === undefined) throw new Error("No blocker PID");
    pending = request(book, `/change-sets/${plan.id}/execute`, {
      ...command,
      signal: abort.signal,
    });
    void pending.catch(() => undefined);
    const blocked = await waitForBlockedExecutors(observer, blockerPid, 1);
    expect(blocked).toHaveLength(1);
    victim = blocked[0];

    if (victim === undefined) throw new Error("No exact test runtime victim");

    const killed = await observer.query<{ terminated: boolean }>(
      "SELECT pg_terminate_backend($1) AS terminated",
      [victim],
    );

    expect(killed.rows).toEqual([{ terminated: true }]);
    const response = await pending;
    expect([500, 503], await response.text()).toContain(response.status);
    expect(await persisted(book)).toEqual(emptyPosting);
    expect(await freshCommandCount(book, commandKey)).toBe(0);
  } finally {
    abort.abort();
    await cleanupOwned([
      () => blocker.query("ROLLBACK"),
      async () => {
        if (pending) await Promise.allSettled([pending]);
      },
      () => setup.query(`DROP TRIGGER IF EXISTS ${marker} ON openerp.outbox`),
      () => setup.query(`DROP FUNCTION IF EXISTS openerp.${marker}()`),
      () => setup.query(`DROP TABLE IF EXISTS openerp.${marker}`),
      () => blocker.end(),
      () => observer.end(),
      () => setup.end(),
    ]);
  }

  const receipt = await decoded(
    await request(book, `/change-sets/${plan.id}/execute`, command),
    Accounting.ExecutionReceipt,
  );

  expect(await persisted(book)).toEqual(onePosting);
  await saveSanitizedJourney("terminated-posting-backend", {
    bookId: book.bookId,
    commandKey,
    victim,
    receipt,
    after: await persisted(book),
  });
});

test("[ASR-REVOKE-ORDER] an already exclusive membership revocation wins against new admission", async () => {
  const book = await fixture();
  const plan = await prepare(book);
  const approval = await approve(book, plan);
  const blocker = await database();
  const observer = await database();
  const abort = new AbortController();
  let pending: Promise<Response> | undefined;

  try {
    await blocker.query("BEGIN");
    await blocker.query("DELETE FROM openerp.memberships WHERE book_id=$1 AND actor_id=$2", [
      book.bookId,
      book.actorId,
    ]);

    const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
      ?.pid;

    if (pid === undefined) throw new Error("No authority blocker PID");
    pending = request(book, `/change-sets/${plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify(execution(plan, approval)),
      signal: abort.signal,
    });
    void pending.catch(() => undefined);
    const blocked = await waitForBlockedExecutors(observer, pid, 1);
    expect(blocked).toHaveLength(1);
    await blocker.query("COMMIT");
    const response = await pending;
    expect(response.status, await response.text()).toBe(403);
    expect(await persisted(book)).toEqual(emptyPosting);
    await saveSanitizedJourney("revocation-wins-admission", {
      bookId: book.bookId,
      observedBlockedRuntimePids: blocked,
      after: await persisted(book),
    });
  } finally {
    abort.abort();
    await cleanupOwned([
      () => blocker.query("ROLLBACK"),
      async () => {
        if (pending) await Promise.allSettled([pending]);
      },
      () => blocker.end(),
      () => observer.end(),
    ]);
  }
});
