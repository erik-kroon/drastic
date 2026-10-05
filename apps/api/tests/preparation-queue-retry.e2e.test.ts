import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as PeriodWork from "@open-erp/contracts/period-work";
import * as Domain from "@open-erp/domain/period-work";
import { expect, test } from "vitest";
import {
  apiDirectory,
  database,
  decoded,
  emptyPosting,
  environment,
  fixture,
  key,
  ledger,
  persisted,
  post,
  request,
} from "./support/fixtures";

async function pendingManifest() {
  const book = await fixture();
  const workIdentity = `period_work_${key().replaceAll("-", "")}`;
  const manifest = await post(
    book,
    "/period-work/manifests",
    {
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      cutoff: "2026-12-31",
      children: [
        {
          workIdentity,
          economicIdentity: `synthetic_${key()}`,
          sourceRevision: "1",
          sourceSystem: "synthetic_queue_retry",
          sourceId: `source_${key()}`,
          documentClass: "domestic_invoice",
          currency: "SEK",
          sourceMinor: "10000",
          isPaymentObservation: false,
          existingMatches: [],
          dependsOn: [],
        },
      ],
      rules: [],
      populationComplete: false,
      excluded: [],
      acknowledgeNotReconciled: true,
    },
    Domain.PeriodWorkManifest,
  );

  return { book, manifest, workIdentity };
}

function startRunner(token: string) {
  return spawn("bun", ["scripts/preparation-runner.ts"], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      DATABASE_URL: environment().runtimeUrl,
      OPENERP_PREPARATION_TOKEN: token,
    },
    stdio: "ignore",
  });
}

async function stopRunner(runner: ChildProcess) {
  if (runner.exitCode !== null || runner.signalCode !== null) return;

  const stopped = once(runner, "exit");

  runner.kill("SIGTERM");

  const deadline = setTimeout(() => runner.kill("SIGKILL"), 10000);

  try {
    const [, signal] = await stopped;

    expect(signal).not.toBe("SIGKILL");
  } finally {
    clearTimeout(deadline);
  }
}

async function queueRecord(id: string) {
  const admin = await database();

  try {
    const result = await admin.query<{
      state: string;
      attemptsMade: number;
      codes: (string | null)[];
      outcomes: string[];
    }>(
      `select j.state, j.attempts_made as "attemptsMade",
        array(select jsonb_path_query_first(a.exit, '$.**.code') #>> '{}'
          from openerp.effect_mq_job_attempts a where a.job_id = j.id order by a.attempt) as codes,
        array(select a.outcome from openerp.effect_mq_job_attempts a
          where a.job_id = j.id order by a.attempt) as outcomes
        from openerp.effect_mq_jobs j where j.id = $1`,
      [id],
    );

    return result.rows[0];
  } finally {
    await admin.end();
  }
}

test("native period-work delivery retries Unavailable and retains one public checkpoint", async () => {
  const { book, manifest, workIdentity } = await pendingManifest();
  const originalKey = `${book.bookId}/${manifest.id}/1`;
  const queueId = `period-work/${originalKey}`;
  const before = await persisted(book);
  const ledgerBefore = await ledger(book);
  const admin = await database();
  const faultName = `queue_retry_${key().replaceAll("-", "")}`;
  let runner: ChildProcess | undefined;

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
    runner = startRunner(book.token);
    await expect
      .poll(() => queueRecord(queueId), { timeout: 15000, interval: 100 })
      .toMatchObject({
        state: "delayed",
        attemptsMade: 1,
        codes: ["Unavailable"],
        outcomes: ["retried"],
      });

    const refusedAttempt = await queueRecord(queueId);

    expect(await persisted(book)).toEqual(before);
    expect(await ledger(book)).toEqual(ledgerBefore);
    await admin.query(`drop trigger ${faultName} on openerp.period_work_children`);
    await expect
      .poll(() => queueRecord(queueId), { timeout: 20000, interval: 100 })
      .toMatchObject({ state: "completed", attemptsMade: 2 });
    await stopRunner(runner);

    const recovered = await decoded(
      await request(book, `/period-work/manifests/${manifest.id}/progress`),
      PeriodWork.PeriodWorkRunProgress,
    );
    const after = await persisted(book);
    const ledgerAfter = await ledger(book);
    const queue = await queueRecord(queueId);

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
    await writeFile(
      join(environment().artifacts, "period-work-unavailable-native-retry.json"),
      JSON.stringify(
        { originalKey, queueId, refusedAttempt, queue, recovered, before, after, ledgerBefore, ledgerAfter },
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

test("native period-work delivery stops retrying current permission refusal", async () => {
  const { book, manifest, workIdentity } = await pendingManifest();
  const originalKey = `${book.bookId}/${manifest.id}/1`;
  const queueId = `period-work/${originalKey}`;
  const before = await persisted(book);
  const ledgerBefore = await ledger(book);
  const runner = startRunner(book.agentToken);

  try {
    await expect
      .poll(() => queueRecord(queueId), { timeout: 15000, interval: 100 })
      .toMatchObject({ state: "failed", attemptsMade: 1, codes: ["Forbidden"], outcomes: ["failed"] });
    await stopRunner(runner);

    const recovered = await decoded(
      await request(book, `/period-work/manifests/${manifest.id}/progress`),
      PeriodWork.PeriodWorkRunProgress,
    );
    const after = await persisted(book);
    const ledgerAfter = await ledger(book);
    const queue = await queueRecord(queueId);

    expect(recovered).toMatchObject({
      scope: { entityId: book.entityId, bookId: book.bookId },
      manifestId: manifest.id,
      reconciled: false,
      children: [{ workIdentity, state: "pending", revision: "1", cancelVersion: "0" }],
    });
    expect(before).toEqual(emptyPosting);
    expect(after).toEqual(before);
    expect(ledgerAfter).toEqual(ledgerBefore);
    await writeFile(
      join(environment().artifacts, "period-work-forbidden-native-no-retry.json"),
      JSON.stringify(
        { originalKey, queueId, queue, recovered, before, after, ledgerBefore, ledgerAfter },
        null,
        2,
      ),
    );
  } finally {
    await stopRunner(runner);
  }
}, 40000);
