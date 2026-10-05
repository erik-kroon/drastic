import { spawn } from "node:child_process";
import { once } from "node:events";
import * as Domain from "@open-erp/domain/period-work";
import { expect } from "vitest";
import {
  apiDirectory,
  database,
  environment,
  fixture,
  key,
  post,
  type BookFixture,
} from "./fixtures";

export async function pendingManifest(existing?: BookFixture) {
  const book = existing ?? (await fixture());

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

export function startRunner(token: string, restoredDatabaseUrl?: string) {
  if (restoredDatabaseUrl) {
    const restored = new URL(restoredDatabaseUrl);

    if (restored.hostname !== "127.0.0.1" || !/^\/exc_restore_[a-f0-9]+$/.test(restored.pathname))
      throw new Error("Non-fixture preparation runner restore refused");
  }

  const diagnostics = { stdoutEvents: 0, stderrEvents: 0, failures: [] as string[] };

  const child = spawn("bun", ["scripts/preparation-runner.ts"], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      DATABASE_URL: restoredDatabaseUrl ?? environment().runtimeUrl,
      OPENERP_PREPARATION_TOKEN: token,
      OPENERP_DOCUMENT_READER: "disabled",
      OPENERP_REMINDER_DELIVERY: "disabled",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const classify = (chunk: Buffer) => {
    const output = chunk.toString();

    const classes = [
      ["module_load", /Cannot find module|ModuleNotFound/],
      ["syntax", /SyntaxError|ParseError/],
      ["type", /TypeError/],
      ["connection", /ECONNREFUSED|Connection refused|connection timeout/],
      ["permission", /permission denied/],
      ["runner_stopped", /Preparation runner stopped/],
    ] as const;

    for (const [name, pattern] of classes)
      if (pattern.test(output) && !diagnostics.failures.includes(name))
        diagnostics.failures.push(name);
  };

  child.stdout.on("data", (chunk: Buffer) => {
    diagnostics.stdoutEvents++;
    classify(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    diagnostics.stderrEvents++;
    classify(chunk);
  });
  child.on("error", () => diagnostics.failures.push("process_start"));

  return { child, diagnostics };
}

export type Runner = ReturnType<typeof startRunner>;

export async function stopRunner({ child: runner }: Runner) {
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

export async function queueRecord(id: string, runner?: Runner) {
  if (runner && (runner.child.exitCode !== null || runner.child.signalCode !== null))
    throw new Error(
      `Preparation runner exited before queue observation: ${JSON.stringify({
        exitCode: runner.child.exitCode,
        signal: runner.child.signalCode,
        diagnostics: runner.diagnostics,
      })}`,
    );

  const admin = await database();

  try {
    const result = await admin.query<{
      state: string;
      attemptsMade: number;
      stalledCount: number;
      leaseExpired: boolean | null;
      locked: boolean;
      codes: (string | null)[];
      outcomes: string[];
    }>(
      `select j.state, j.attempts_made as "attemptsMade",
        j.stalled_count as "stalledCount", j.lock_expires_at <= clock_timestamp() as "leaseExpired",
        j.lock_token is not null as locked,
        array(select jsonb_path_query_first(a.exit, '$.**.code') #>> '{}'
          from public.effect_mq_job_attempts a where a.job_id = j.id order by a.attempt) as codes,
        array(select a.outcome from public.effect_mq_job_attempts a
          where a.job_id = j.id order by a.attempt) as outcomes
        from public.effect_mq_jobs j where j.id = $1`,
      [id],
    );

    return result.rows[0];
  } finally {
    await admin.end();
  }
}

export async function crashRunner({ child: runner }: Runner) {
  if (runner.exitCode !== null || runner.signalCode !== null)
    throw new Error("Preparation runner exited before the deliberate crash");

  const stopped = once(runner, "exit");

  runner.kill("SIGKILL");

  const [, signal] = await stopped;

  expect(signal).toBe("SIGKILL");
}

export async function approvalCount(book: BookFixture) {
  const admin = await database();

  try {
    const result = await admin.query<{ count: number }>(
      "select count(*)::integer as count from openerp.approvals where book_id = $1",
      [book.bookId],
    );

    return result.rows[0]?.count;
  } finally {
    await admin.end();
  }
}
