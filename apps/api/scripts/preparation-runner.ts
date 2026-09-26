import { runMain } from "@effect/platform-bun/BunRuntime";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Worker } from "effect-mq";
import { DrizzleJobStore } from "effect-mq/drizzle-postgres";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { applicationPostgresTypes, Database } from "../src/db/connection";
import {
  jobAttempts,
  jobDedupe,
  jobFlowChildren,
  jobFlowOutbox,
  jobQueues,
  jobs,
  jobSchedules,
} from "../src/db/schema";
import { RequestEnvironment } from "../src/runtime/environment";
import {
  dispatchPendingPreparations,
  handlePreparation,
  PreparationQueue,
} from "../src/runtime/preparation-queue";

const connectionString = process.env.DATABASE_URL;

const token = process.env.OPENERP_PREPARATION_TOKEN;

if (!connectionString || !token) {
  throw new Error("Set DATABASE_URL and OPENERP_PREPARATION_TOKEN for the preparation runner.");
}

const postgres = PgClient.layer({
  url: Redacted.make(connectionString),
  applicationName: "open-erp-preparation-runner",
  maxConnections: 4,
  connectTimeout: "5 seconds",
});

// Queue SQL consumes Date objects; application SQL lets Drizzle decode strings.
// Separate bounded pools preserve both contracts without global parser changes.
const applicationPostgres = PgClient.layer({
  url: Redacted.make(connectionString),
  applicationName: "open-erp-preparation-application",
  maxConnections: 4,
  connectTimeout: "5 seconds",
  types: applicationPostgresTypes,
});

const services = Layer.mergeAll(
  Layer.effect(Database, PgDrizzle.makeWithDefaults()).pipe(Layer.provide(applicationPostgres)),
  DrizzleJobStore.layer({
    jobs,
    attempts: jobAttempts,
    schedules: jobSchedules,
    queues: jobQueues,
    dedupe: jobDedupe,
    flowChildren: jobFlowChildren,
    flowOutbox: jobFlowOutbox,
  }),
  Layer.succeed(RequestEnvironment, {
    bindings: { OPENERP_PREPARATION_TOKEN: token },
    url: new URL("http://localhost/"),
  }),
).pipe(Layer.provide(postgres));

const worker = PreparationQueue.toLayer(handlePreparation, { concurrency: 2 }).pipe(
  Layer.provideMerge(Worker.layer({ concurrency: 2 })),
  Layer.provideMerge(services),
);

const dispatch = Effect.forever(
  dispatchPendingPreparations().pipe(
    Effect.catch(() =>
      Effect.logWarning("Preparation queue dispatch failed; admission remains durable."),
    ),
    // A defect reaching the poll boundary must not end this fiber: the runner
    // owns no other dispatch, so losing it would strand every ready preparation.
    Effect.catchDefect(() =>
      Effect.logWarning("Preparation queue dispatch defect; admission remains durable."),
    ),
    Effect.andThen(Effect.sleep("30 seconds")),
  ),
);

const main = dispatch.pipe(Effect.provide(worker), Effect.scoped);

runMain(main.pipe(Effect.tapCause(() => Effect.logError("Preparation runner stopped."))), {
  disableErrorReporting: true,
});
