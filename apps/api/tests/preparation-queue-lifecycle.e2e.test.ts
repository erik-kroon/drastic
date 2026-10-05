import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as PeriodWork from "@open-erp/contracts/period-work";
import { expect, test } from "vitest";
import {
  database,
  decoded,
  emptyPosting,
  environment,
  key,
  ledger,
  persisted,
  request,
  type BookFixture,
} from "./support/fixtures";
import {
  approvalCount,
  crashRunner,
  pendingManifest,
  queueRecord,
  startRunner,
  stopRunner,
  type Runner,
} from "./support/preparation-runner";

async function progress(book: BookFixture, manifestId: string) {
  return decoded(
    await request(book, `/period-work/manifests/${manifestId}/progress`),
    PeriodWork.PeriodWorkRunProgress,
  );
}

async function deliveryBarrier(
  bookId: string,
  queueId: string,
  target: "handler" | "acknowledgement",
) {
  if (!/^book_[a-f0-9]+$/.test(bookId) || !/^[a-zA-Z0-9_/-]+$/.test(queueId))
    throw new Error("Unsafe synthetic barrier scope");

  const admin = await database();
  const suffix = key().replaceAll("-", "");
  const name = `queue_barrier_${suffix}`;
  const lock = Number.parseInt(suffix.slice(0, 7), 16);
  const table = target === "handler" ? "openerp.period_work_children" : "public.effect_mq_jobs";

  const condition =
    target === "handler"
      ? `new.book_id = '${bookId}'`
      : `new.id = '${queueId}' and old.state = 'active' and new.state = 'completed'`;

  let installed = false;

  try {
    await admin.query("select pg_advisory_lock(940, $1::integer)", [lock]);
    await admin.query(`create function openerp.${name}() returns trigger language plpgsql as $$
      begin if ${condition} then perform pg_advisory_xact_lock(940, ${lock});
      end if; return new; end $$`);
    await admin.query(
      `create trigger ${name} before update on ${table}
        for each row execute function openerp.${name}()`,
    );
    installed = true;
  } catch (error) {
    await admin.query(`drop function if exists openerp.${name}()`);
    await admin.end();

    throw error;
  }

  return {
    async waiter() {
      const observed = await admin.query<{
        pid: number;
        applicationName: string;
        state: string;
        waitEventType: string;
        waitEvent: string;
      }>(
        `select a.pid, a.application_name as "applicationName", a.state,
          a.wait_event_type as "waitEventType", a.wait_event as "waitEvent"
          from pg_stat_activity a join pg_locks l on l.pid = a.pid
          where l.locktype = 'advisory' and l.classid = 940 and l.objid = $1
            and l.objsubid = 2 and not l.granted
            and a.application_name = $2`,
        [
          lock,
          target === "handler" ? "open-erp-preparation-application" : "open-erp-preparation-runner",
        ],
      );

      return observed.rows[0];
    },
    async backendExists(pid: number) {
      const observed = await admin.query<{ present: boolean }>(
        "select exists(select 1 from pg_stat_activity where pid = $1) as present",
        [pid],
      );

      return observed.rows[0]?.present;
    },
    async release() {
      await admin.query("select pg_advisory_unlock(940, $1::integer)", [lock]);

      if (installed) {
        await admin.query(`drop trigger ${name} on ${table}`);
        installed = false;
      }
    },
    async close() {
      try {
        await admin.query("select pg_advisory_unlock(940, $1::integer)", [lock]);

        if (installed) await admin.query(`drop trigger ${name} on ${table}`);

        await admin.query(`drop function if exists openerp.${name}()`);
      } finally {
        await admin.end();
      }
    },
  };
}

async function queueCount(queueId: string) {
  const admin = await database();

  try {
    const result = await admin.query<{ count: number }>(
      "select count(*)::integer as count from public.effect_mq_jobs where id = $1",
      [queueId],
    );

    return result.rows[0]?.count;
  } finally {
    await admin.end();
  }
}

test("native runner abrupt death rolls back a handler and recovers its actual expired lease", async () => {
  const { book, manifest, workIdentity } = await pendingManifest();
  const originalKey = `${book.bookId}/${manifest.id}/1`;
  const queueId = `period-work/${originalKey}`;
  const before = await persisted(book);
  const ledgerBefore = await ledger(book);
  const initial = await progress(book, manifest.id);
  const barrier = await deliveryBarrier(book.bookId, queueId, "handler");
  let runner: Runner | undefined;

  try {
    const first = startRunner(book.token);

    runner = first;
    await expect
      .poll(() => barrier.waiter(), { timeout: 15000, interval: 100 })
      .toMatchObject({
        state: "active",
        waitEventType: "Lock",
        waitEvent: "advisory",
      });

    const waiting = await barrier.waiter();
    const claimed = await queueRecord(queueId, first);

    if (!waiting) throw new Error("Handler barrier waiter disappeared before crash");

    expect(claimed).toMatchObject({
      state: "active",
      attemptsMade: 0,
      stalledCount: 0,
      locked: true,
    });
    expect(await queueCount(queueId)).toBe(1);
    await crashRunner(first);
    await barrier.release();
    await expect
      .poll(() => barrier.backendExists(waiting.pid), { timeout: 10000, interval: 100 })
      .toBe(false);
    expect(await progress(book, manifest.id)).toEqual(initial);
    expect(await queueRecord(queueId)).toMatchObject({ state: "active", attemptsMade: 0 });

    const restarted = startRunner(book.token);

    runner = restarted;
    await expect
      .poll(() => queueRecord(queueId, restarted), { timeout: 65000, interval: 250 })
      .toMatchObject({ state: "completed", attemptsMade: 1, stalledCount: 1, locked: false });

    const recovered = await progress(book, manifest.id);
    const queue = await queueRecord(queueId, restarted);
    const after = await persisted(book);
    const ledgerAfter = await ledger(book);

    expect(recovered.children).toMatchObject([
      { workIdentity, state: "needs_review", revision: "2", cancelVersion: "0" },
    ]);
    expect(queue?.outcomes).toEqual(["stalled", "completed"]);
    expect(await queueCount(queueId)).toBe(1);
    expect(before).toEqual(emptyPosting);
    expect(after).toEqual(before);
    expect(ledgerAfter).toEqual(ledgerBefore);
    expect(await approvalCount(book)).toBe(0);
    await writeFile(
      join(environment().artifacts, "period-work-native-kill-lease-recovery.json"),
      JSON.stringify(
        {
          originalKey,
          queueId,
          waiting,
          claimed,
          initial,
          queue,
          recovered,
          before,
          after,
          ledgerBefore,
          ledgerAfter,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await barrier.release();

      if (runner) await stopRunner(runner);
    } finally {
      await barrier.close();
    }
  }
}, 90000);

test("native runner recreates pruned delivery history from unchanged pending application work", async () => {
  const { book, manifest, workIdentity } = await pendingManifest();
  const originalKey = `${book.bookId}/${manifest.id}/1`;
  const queueId = `period-work/${originalKey}`;
  const before = await persisted(book);
  const ledgerBefore = await ledger(book);
  const pending = await progress(book, manifest.id);
  const barrier = await deliveryBarrier(book.bookId, queueId, "handler");
  const admin = await database();
  let runner: Runner | undefined;

  try {
    const first = startRunner(book.token);

    runner = first;
    await expect
      .poll(() => barrier.waiter(), { timeout: 15000, interval: 100 })
      .toMatchObject({ waitEventType: "Lock", waitEvent: "advisory" });

    const waiting = await barrier.waiter();
    const claimed = await queueRecord(queueId, first);

    if (!waiting) throw new Error("Pruning barrier waiter disappeared before crash");

    expect(claimed).toMatchObject({ state: "active", attemptsMade: 0, stalledCount: 0 });
    await crashRunner(first);
    await barrier.release();
    await expect
      .poll(() => barrier.backendExists(waiting.pid), { timeout: 10000, interval: 100 })
      .toBe(false);
    expect(await queueRecord(queueId)).toMatchObject({ state: "active", attemptsMade: 0 });
    expect(await progress(book, manifest.id)).toEqual(pending);
    await admin.query("begin");

    try {
      await admin.query("delete from public.effect_mq_job_attempts where job_id = $1", [queueId]);

      const removed = await admin.query("delete from public.effect_mq_jobs where id = $1", [
        queueId,
      ]);

      expect(removed.rowCount).toBe(1);
      await admin.query("commit");
    } catch (error) {
      await admin.query("rollback");

      throw error;
    }

    expect(await queueRecord(queueId)).toBeUndefined();
    expect(await progress(book, manifest.id)).toEqual(pending);

    const restarted = startRunner(book.token);

    runner = restarted;
    await expect
      .poll(() => queueRecord(queueId, restarted), { timeout: 15000, interval: 100 })
      .toMatchObject({ state: "completed", attemptsMade: 1, stalledCount: 0 });

    const recovered = await progress(book, manifest.id);
    const queue = await queueRecord(queueId, restarted);
    const after = await persisted(book);
    const ledgerAfter = await ledger(book);

    expect(recovered.children).toMatchObject([
      { workIdentity, state: "needs_review", revision: "2", cancelVersion: "0" },
    ]);
    expect(queue?.outcomes).toEqual(["completed"]);
    expect(await queueCount(queueId)).toBe(1);
    expect(before).toEqual(emptyPosting);
    expect(after).toEqual(before);
    expect(ledgerAfter).toEqual(ledgerBefore);
    expect(await approvalCount(book)).toBe(0);
    await writeFile(
      join(environment().artifacts, "period-work-native-pruned-pending-rediscovery.json"),
      JSON.stringify(
        {
          originalKey,
          queueId,
          waiting,
          claimed,
          pending,
          queue,
          recovered,
          before,
          after,
          ledgerBefore,
          ledgerAfter,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await barrier.release();

      if (runner) await stopRunner(runner);
    } finally {
      try {
        await barrier.close();
      } finally {
        await admin.end();
      }
    }
  }
}, 90000);

test("native runner lost acknowledgement redelivery retains one committed public checkpoint", async () => {
  const { book, manifest } = await pendingManifest();
  const originalKey = `${book.bookId}/${manifest.id}/1`;
  const queueId = `period-work/${originalKey}`;
  const before = await persisted(book);
  const ledgerBefore = await ledger(book);
  const barrier = await deliveryBarrier(book.bookId, queueId, "acknowledgement");
  let runner: Runner | undefined;

  try {
    const first = startRunner(book.token);

    runner = first;
    await expect
      .poll(() => barrier.waiter(), { timeout: 15000, interval: 100 })
      .toMatchObject({
        state: "active",
        waitEventType: "Lock",
        waitEvent: "advisory",
      });

    const waiting = await barrier.waiter();
    const committed = await progress(book, manifest.id);
    const unacknowledged = await queueRecord(queueId, first);

    expect(committed.children).toMatchObject([
      { state: "needs_review", revision: "2", cancelVersion: "0" },
    ]);
    expect(unacknowledged).toMatchObject({ state: "active", attemptsMade: 0, locked: true });

    if (!waiting) throw new Error("Acknowledgement barrier waiter disappeared before crash");

    await crashRunner(first);
    await barrier.release();
    await expect
      .poll(() => barrier.backendExists(waiting.pid), { timeout: 10000, interval: 100 })
      .toBe(false);
    expect(await queueRecord(queueId)).toMatchObject({ state: "active", attemptsMade: 0 });

    const restarted = startRunner(book.token);

    runner = restarted;
    await expect
      .poll(() => queueRecord(queueId, restarted), { timeout: 65000, interval: 250 })
      .toMatchObject({ state: "completed", attemptsMade: 1, stalledCount: 1 });

    const recovered = await progress(book, manifest.id);
    const queue = await queueRecord(queueId, restarted);
    const after = await persisted(book);
    const ledgerAfter = await ledger(book);

    expect(recovered).toEqual(committed);
    expect(queue?.outcomes).toEqual(["stalled", "completed"]);
    expect(await queueCount(queueId)).toBe(1);
    expect(before).toEqual(emptyPosting);
    expect(after).toEqual(before);
    expect(ledgerAfter).toEqual(ledgerBefore);
    expect(await approvalCount(book)).toBe(0);
    await writeFile(
      join(environment().artifacts, "period-work-native-lost-ack-recovery.json"),
      JSON.stringify(
        {
          originalKey,
          queueId,
          waiting,
          unacknowledged,
          committed,
          queue,
          recovered,
          before,
          after,
          ledgerBefore,
          ledgerAfter,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await barrier.release();

      if (runner) await stopRunner(runner);
    } finally {
      await barrier.close();
    }
  }
}, 90000);

test("native runner restart honors cancellation before its stale delivery resumes", async () => {
  const { book, manifest, workIdentity } = await pendingManifest();
  const originalKey = `${book.bookId}/${manifest.id}/1`;
  const queueId = `period-work/${originalKey}`;
  const cancelKey = key();
  const before = await persisted(book);
  const ledgerBefore = await ledger(book);
  const barrier = await deliveryBarrier(book.bookId, queueId, "handler");
  let runner: Runner | undefined;

  const cancel = async () =>
    decoded(
      await request(book, `/period-work/manifests/${manifest.id}/cancel`, {
        method: "POST",
        headers: { "idempotency-key": cancelKey },
        body: JSON.stringify({ expectedDigest: manifest.digest }),
      }),
      PeriodWork.PeriodWorkRunProgress,
    );

  try {
    const first = startRunner(book.token);

    runner = first;
    await expect
      .poll(() => barrier.waiter(), { timeout: 15000, interval: 100 })
      .toMatchObject({
        waitEventType: "Lock",
        waitEvent: "advisory",
      });

    const waiting = await barrier.waiter();

    if (!waiting) throw new Error("Cancellation barrier waiter disappeared before crash");

    await crashRunner(first);
    await barrier.release();
    await expect
      .poll(() => barrier.backendExists(waiting.pid), { timeout: 10000, interval: 100 })
      .toBe(false);
    expect(await queueRecord(queueId)).toMatchObject({ state: "active", attemptsMade: 0 });

    const cancelled = await cancel();

    expect(cancelled.children).toEqual([
      {
        workIdentity,
        state: "refused",
        refusalReason: "cancelled",
        revision: "2",
        cancelVersion: "1",
      },
    ]);

    const restarted = startRunner(book.token);

    runner = restarted;
    await expect
      .poll(() => queueRecord(queueId, restarted), { timeout: 65000, interval: 250 })
      .toMatchObject({ state: "completed", attemptsMade: 1, stalledCount: 1 });

    const recovered = await progress(book, manifest.id);
    const replayed = await cancel();
    const queue = await queueRecord(queueId, restarted);
    const after = await persisted(book);
    const ledgerAfter = await ledger(book);

    expect(recovered).toEqual(cancelled);
    expect(replayed).toEqual(cancelled);
    expect(queue?.outcomes).toEqual(["stalled", "completed"]);
    expect(await queueCount(queueId)).toBe(1);
    expect(before).toEqual(emptyPosting);
    expect(after).toEqual(before);
    expect(ledgerAfter).toEqual(ledgerBefore);
    expect(await approvalCount(book)).toBe(0);
    await writeFile(
      join(environment().artifacts, "period-work-native-restart-cancellation-fence.json"),
      JSON.stringify(
        {
          originalKey,
          queueId,
          cancelKey,
          waiting,
          cancelled,
          queue,
          recovered,
          replayed,
          before,
          after,
          ledgerBefore,
          ledgerAfter,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await barrier.release();

      if (runner) await stopRunner(runner);
    } finally {
      await barrier.close();
    }
  }
}, 90000);
