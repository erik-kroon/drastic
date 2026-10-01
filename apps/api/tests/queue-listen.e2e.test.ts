import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as PgClient from "@effect/sql-pg/PgClient";
import { JobStore } from "effect-mq";
import { DrizzleJobStore } from "effect-mq/drizzle-postgres";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { expect, test } from "vitest";
import {
  jobAttempts,
  jobDedupe,
  jobFlowChildren,
  jobFlowOutbox,
  jobQueues,
  jobs,
  jobSchedules,
} from "../src/db/schema";
import { database, environment } from "./support/fixtures";

test("queue notifications wake the store and recover after its LISTEN connection is lost", async () => {
  const admin = await database();
  const applicationName = `e2e_queue_listen_${randomUUID()}`;
  const queue = JobStore.QueueName("preparation");
  const channel = "effect_mq_wake_effect_mq_jobs";
  const observations: Array<{ phase: string; pid: number }> = [];

  async function listener(excludedPid = 0) {
    const result = await admin.query<{ pid: number }>(
      "SELECT pid FROM pg_stat_activity WHERE application_name = $1 AND query LIKE 'LISTEN %' AND pid <> $2",
      [applicationName, excludedPid],
    );

    return result.rows[0]?.pid ?? 0;
  }

  const postgres = PgClient.layer({
    url: Redacted.make(environment().runtimeUrl),
    applicationName,
    maxConnections: 4,
    connectTimeout: "5 seconds",
  });

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* DrizzleJobStore.make({
          jobs,
          attempts: jobAttempts,
          schedules: jobSchedules,
          queues: jobQueues,
          dedupe: jobDedupe,
          flowChildren: jobFlowChildren,
          flowOutbox: jobFlowOutbox,
        });

        yield* Effect.promise(() => expect.poll(listener, { timeout: 4000 }).not.toBe(0));
        const firstPid = yield* Effect.promise(() => listener());
        observations.push({ phase: "subscribed", pid: firstPid });

        const claim = yield* store.claim({
          queue,
          names: [applicationName],
          token: randomUUID(),
          lockDurationMs: 10000,
        });

        expect(claim._tag).toBe("Empty");

        if (claim._tag !== "Empty") throw new Error("Unexpected job in isolated notification test");

        yield* Effect.promise(() => admin.query("SELECT pg_notify($1, $2)", [channel, "other"]));

        const unrelated = yield* store
          .awaitWake([queue], claim.wakeToken)
          .pipe(Effect.timeoutOption("200 millis"));

        expect(Option.isNone(unrelated)).toBe(true);

        yield* Effect.all(
          [
            store.awaitWake([queue], claim.wakeToken).pipe(Effect.timeout("3 seconds")),
            Effect.promise(() => admin.query("SELECT pg_notify($1, $2)", [channel, "preparation"])),
          ],
          { concurrency: 2 },
        );
        observations.push({ phase: "matching_notification", pid: firstPid });

        const nextClaim = yield* store.claim({
          queue,
          names: [applicationName],
          token: randomUUID(),
          lockDurationMs: 10000,
        });

        expect(nextClaim._tag).toBe("Empty");

        if (nextClaim._tag !== "Empty") throw new Error("Unexpected job before listener recovery");

        const terminated = yield* Effect.promise(() =>
          admin.query<{ terminated: boolean }>("SELECT pg_terminate_backend($1) AS terminated", [
            firstPid,
          ]),
        );

        expect(terminated.rows).toEqual([{ terminated: true }]);
        yield* Effect.promise(() =>
          expect.poll(() => listener(firstPid), { timeout: 8000 }).not.toBe(0),
        );
        const recoveredPid = yield* Effect.promise(() => listener(firstPid));
        expect(recoveredPid).not.toBe(firstPid);

        yield* Effect.all(
          [
            store.awaitWake([queue], nextClaim.wakeToken).pipe(Effect.timeout("3 seconds")),
            Effect.promise(() => admin.query("SELECT pg_notify($1, $2)", [channel, "*"])),
          ],
          { concurrency: 2 },
        );
        observations.push({ phase: "wildcard_after_reconnect", pid: recoveredPid });
      }).pipe(Effect.scoped, Effect.provide(postgres)),
    );
    expect(observations.map((entry) => entry.phase)).toEqual([
      "subscribed",
      "matching_notification",
      "wildcard_after_reconnect",
    ]);
  } finally {
    await writeFile(
      join(environment().artifacts, "queue-listen.json"),
      JSON.stringify(observations, null, 2),
    );
    await admin.end();
  }
});
