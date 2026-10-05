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
} from "./support/fixtures";
import {
  approvalCount,
  pendingManifest,
  queueRecord,
  startRunner,
  stopRunner,
  type Runner,
} from "./support/preparation-runner";

test("native period-work delivery retries Unavailable and retains one public checkpoint", async () => {
  const { book, manifest, workIdentity } = await pendingManifest();
  const foreign = await pendingManifest();
  const originalKey = `${book.bookId}/${manifest.id}/1`;
  const queueId = `period-work/${originalKey}`;
  const foreignQueueId = `period-work/${foreign.book.bookId}/${foreign.manifest.id}/1`;
  const before = await persisted(book);
  const ledgerBefore = await ledger(book);
  const admin = await database();
  const faultName = `queue_retry_${key().replaceAll("-", "")}`;
  let runner: Runner | undefined;

  if (!/^book_[a-f0-9]+$/.test(book.bookId)) throw new Error("Unsafe synthetic fault scope");

  try {
    await admin.query(`create function openerp.${faultName}() returns trigger language plpgsql as $$
      begin if new.book_id = '${book.bookId}' then
        raise exception using errcode = '08006', message = 'synthetic queue connection refusal';
      end if; return new; end $$`);
    await admin.query(
      `create trigger ${faultName} before update on openerp.period_work_children
        for each row execute function openerp.${faultName}()`,
    );

    const running = startRunner(book.token);

    runner = running;
    await expect
      .poll(() => queueRecord(queueId, running), { timeout: 15000, interval: 100 })
      .toMatchObject({
        state: "delayed",
        attemptsMade: 1,
        codes: ["Unavailable"],
        outcomes: ["retried"],
      });

    const refusedAttempt = await queueRecord(queueId, running);

    expect(await queueRecord(foreignQueueId, running)).toBeUndefined();

    expect(await persisted(book)).toEqual(before);
    expect(await ledger(book)).toEqual(ledgerBefore);
    await admin.query(`drop trigger ${faultName} on openerp.period_work_children`);
    await expect
      .poll(() => queueRecord(queueId, running), { timeout: 20000, interval: 100 })
      .toMatchObject({ state: "completed", attemptsMade: 2 });

    const recovered = await decoded(
      await request(book, `/period-work/manifests/${manifest.id}/progress`),
      PeriodWork.PeriodWorkRunProgress,
    );

    const after = await persisted(book);
    const ledgerAfter = await ledger(book);
    const queue = await queueRecord(queueId, running);

    const foreignProgress = await decoded(
      await request(foreign.book, `/period-work/manifests/${foreign.manifest.id}/progress`),
      PeriodWork.PeriodWorkRunProgress,
    );

    expect(await queueRecord(foreignQueueId, running)).toBeUndefined();
    expect(foreignProgress.children).toEqual([
      { workIdentity: foreign.workIdentity, state: "pending", revision: "1", cancelVersion: "0" },
    ]);
    expect(await persisted(foreign.book)).toEqual(emptyPosting);

    expect(recovered).toMatchObject({
      scope: { entityId: book.entityId, bookId: book.bookId },
      manifestId: manifest.id,
      reconciled: false,
      children: [{ workIdentity, state: "needs_review", revision: "2", cancelVersion: "0" }],
    });
    expect(queue).toMatchObject({
      attemptsMade: 2,
      codes: ["Unavailable", null],
      outcomes: ["retried", "completed"],
    });
    expect(before).toEqual(emptyPosting);
    expect(after).toEqual(before);
    expect(ledgerAfter).toEqual(ledgerBefore);
    expect(await approvalCount(book)).toBe(0);
    await writeFile(
      join(environment().artifacts, "period-work-unavailable-native-retry.json"),
      JSON.stringify(
        {
          originalKey,
          queueId,
          refusedAttempt,
          queue,
          recovered,
          foreign: { queueId: foreignQueueId, progress: foreignProgress },
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
      if (runner) await stopRunner(runner);
    } finally {
      try {
        await admin.query(`drop trigger if exists ${faultName} on openerp.period_work_children`);
        await admin.query(`drop function if exists openerp.${faultName}()`);
      } finally {
        await admin.end();
      }
    }
  }
}, 60000);

test("native period-work delivery stops permission retries and projects review after authority returns", async () => {
  const { book, manifest, workIdentity } = await pendingManifest();
  const originalKey = `${book.bookId}/${manifest.id}/1`;
  const queueId = `period-work/${originalKey}`;
  const before = await persisted(book);
  const ledgerBefore = await ledger(book);
  const admin = await database();
  const faultName = `queue_permission_${key().replaceAll("-", "")}`;
  let runner: Runner | undefined;

  if (!/^book_[a-f0-9]+$/.test(book.bookId)) throw new Error("Unsafe synthetic fault scope");

  try {
    await admin.query(`create function openerp.${faultName}() returns trigger language plpgsql as $$
      begin if new.book_id = '${book.bookId}' then
        raise exception using errcode = '08006', message = 'synthetic queue connection refusal';
      end if; return new; end $$`);
    await admin.query(
      `create trigger ${faultName} before update on openerp.period_work_children
        for each row execute function openerp.${faultName}()`,
    );

    const running = startRunner(book.token);

    runner = running;
    await expect
      .poll(() => queueRecord(queueId, running), { timeout: 15000, interval: 100 })
      .toMatchObject({ state: "delayed", attemptsMade: 1, codes: ["Unavailable"] });
    await admin.query(
      "update openerp.memberships set role = 'agent' where book_id = $1 and actor_id = $2",
      [book.bookId, book.actorId],
    );
    await admin.query(`drop trigger ${faultName} on openerp.period_work_children`);
    await expect
      .poll(() => queueRecord(queueId, running), { timeout: 20000, interval: 100 })
      .toMatchObject({
        state: "failed",
        attemptsMade: 2,
        codes: ["Unavailable", "Forbidden"],
        outcomes: ["retried", "failed"],
      });

    const refusedProgress = await decoded(
      await request(book, `/period-work/manifests/${manifest.id}/progress`),
      PeriodWork.PeriodWorkRunProgress,
    );

    expect(refusedProgress.children).toEqual([
      { workIdentity, state: "pending", revision: "1", cancelVersion: "0" },
    ]);
    await admin.query(
      "update openerp.memberships set role = 'operator' where book_id = $1 and actor_id = $2",
      [book.bookId, book.actorId],
    );
    await expect
      .poll(
        async () =>
          decoded(
            await request(book, `/period-work/manifests/${manifest.id}/progress`),
            PeriodWork.PeriodWorkRunProgress,
          ),
        { timeout: 35000, interval: 250 },
      )
      .toMatchObject({
        children: [
          {
            workIdentity,
            state: "needs_review",
            missingFacts: ["delivery_exhausted"],
            revision: "2",
            cancelVersion: "0",
          },
        ],
      });

    const recovered = await decoded(
      await request(book, `/period-work/manifests/${manifest.id}/progress`),
      PeriodWork.PeriodWorkRunProgress,
    );

    const after = await persisted(book);
    const ledgerAfter = await ledger(book);
    const queue = await queueRecord(queueId, running);

    expect(recovered).toMatchObject({
      scope: { entityId: book.entityId, bookId: book.bookId },
      manifestId: manifest.id,
      reconciled: false,
      children: [{ workIdentity, state: "needs_review", revision: "2", cancelVersion: "0" }],
    });
    expect(queue).toMatchObject({
      state: "failed",
      attemptsMade: 2,
      codes: ["Unavailable", "Forbidden"],
      outcomes: ["retried", "failed"],
    });
    expect(before).toEqual(emptyPosting);
    expect(after).toEqual(before);
    expect(ledgerAfter).toEqual(ledgerBefore);
    expect(await approvalCount(book)).toBe(0);
    await writeFile(
      join(environment().artifacts, "period-work-forbidden-native-no-retry.json"),
      JSON.stringify(
        {
          originalKey,
          queueId,
          queue,
          refusedProgress,
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
      if (runner) await stopRunner(runner);
    } finally {
      try {
        await admin.query(
          "update openerp.memberships set role = 'operator' where book_id = $1 and actor_id = $2",
          [book.bookId, book.actorId],
        );
        await admin.query(`drop trigger if exists ${faultName} on openerp.period_work_children`);
        await admin.query(`drop function if exists openerp.${faultName}()`);
      } finally {
        await admin.end();
      }
    }
  }
}, 75000);
