import { inspectQueuedDocument } from "./document-inspection/inspection";
import {
  RecurringDraftQueue,
  handleRecurringDraft,
  runRecurringDraftDispatch,
} from "../src/runtime/recurring-draft-queue";
import { runMain } from "@effect/platform-bun/BunRuntime";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Worker } from "effect-mq";
import { DrizzleJobStore } from "effect-mq/drizzle-postgres";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { nativePostgresTypes, Database } from "../src/db/connection";
import { filesystemObjectStore } from "../src/adapters/storage/filesystem-objects";
import { configuredDecisionModel } from "../src/runtime/decision-model";
import { configuredDocumentReader } from "../src/runtime/document-reader";
import { fileObjectStore } from "./file-object-store";
import {
  jobAttempts,
  jobDedupe,
  jobFlowChildren,
  jobFlowOutbox,
  jobQueues,
  jobs,
  jobSchedules,
} from "../src/db/schema";
import { RequestEnvironment, type Bindings } from "../src/runtime/environment";
import { PayslipQueue, dispatchPayslips, handlePayslip } from "../src/runtime/payslip-queue";
import {
  CreditDocumentQueue,
  dispatchCreditDocuments,
  handleCreditDocument,
} from "../src/runtime/credit-document-queue";
import {
  dispatchPendingExtractions,
  dispatchPendingPeriodWork,
  dispatchPendingPreparations,
  ExtractionQueue,
  handleExtraction,
  handlePeriodWork,
  handlePreparation,
  PeriodWorkQueue,
  PreparationQueue,
} from "../src/runtime/preparation-queue";

import { configuredReminderDelivery } from "../src/adapters/reminder-delivery/local-fixture";
import {
  ReminderQueue,
  dispatchPendingReminders,
  handleReminder,
} from "../src/runtime/reminder-queue";

const connectionString = process.env.DATABASE_URL;

const token = process.env.OPENERP_PREPARATION_TOKEN;

if (!connectionString || !token) {
  throw new Error("Set DATABASE_URL and OPENERP_PREPARATION_TOKEN for the preparation runner.");
}

// An original retained outside PostgreSQL has to be readable by the runner that
// extracts it. Without a root the runner still starts, and an externally
// retained original is then unavailable rather than silently misread: inline
// stored content does not need a store at all.
const evidenceRoot = process.env.EVIDENCE_STORE_ROOT;

const reader = configuredDocumentReader(process.env);

const evidenceStore = process.env.OPENERP_OBJECT_DIRECTORY
  ? await fileObjectStore(process.env.OPENERP_OBJECT_DIRECTORY)
  : evidenceRoot
    ? filesystemObjectStore(evidenceRoot)
    : undefined;

const bindings: Bindings = {
  DOCUMENT_INSPECTOR: inspectQueuedDocument,
  OPENERP_PREPARATION_TOKEN: token,
  REMINDER_DELIVERY: configuredReminderDelivery({
    OPENERP_REMINDER_DELIVERY: process.env.OPENERP_REMINDER_DELIVERY,
    OPENERP_REMINDER_ENDPOINT: process.env.OPENERP_REMINDER_ENDPOINT,
    OPENERP_REMINDER_SECRET: process.env.OPENERP_REMINDER_SECRET,
  }),
  DECISION_MODEL: configuredDecisionModel(process.env),
  DOCUMENT_READER: reader,
  EVIDENCE_STORE: evidenceStore,
};

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
  types: nativePostgresTypes,
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
    bindings,
    url: new URL("http://localhost/"),
  }),
).pipe(Layer.provide(postgres));

const worker = Layer.mergeAll(
  ReminderQueue.toLayer(handleReminder, { concurrency: 2 }),
  PreparationQueue.toLayer(handlePreparation, { concurrency: 2 }),
  ExtractionQueue.toLayer(handleExtraction, { concurrency: 2 }),
  PeriodWorkQueue.toLayer(handlePeriodWork, { concurrency: 2 }),
  CreditDocumentQueue.toLayer(handleCreditDocument, { concurrency: 2 }),
  PayslipQueue.toLayer(handlePayslip, { concurrency: 2 }),
  RecurringDraftQueue.toLayer(handleRecurringDraft, { concurrency: 2 }),
).pipe(Layer.provideMerge(Worker.layer({ concurrency: 2 })), Layer.provideMerge(services));

const dispatchExtractions = Effect.forever(
  dispatchPendingExtractions().pipe(
    Effect.catch(() =>
      Effect.logWarning("Extraction queue dispatch failed; admission remains durable."),
    ),
    // A defect reaching the poll boundary must not end this fiber: the runner owns
    // no other dispatch, so losing it would strand every ready extraction request.
    Effect.catchDefect(() =>
      Effect.logWarning("Extraction queue dispatch defect; admission remains durable."),
    ),
    Effect.andThen(Effect.sleep("30 seconds")),
  ),
);

const dispatchPeriodWork = Effect.forever(
  dispatchPendingPeriodWork().pipe(
    Effect.catch(() =>
      Effect.logWarning("Period work dispatch failed; the run stays open and is retried."),
    ),
    // A defect reaching the poll boundary must not end this fiber: the children
    // stay open and the next poll picks the same manifests up again.
    Effect.catchDefect(() => Effect.logWarning("Period work dispatch defect; the run stays open.")),
    Effect.andThen(Effect.sleep("30 seconds")),
  ),
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

const dispatchPayslipDocuments = Effect.forever(
  dispatchPayslips().pipe(
    Effect.catch(() =>
      Effect.logWarning("Payslip dispatch failed; render intent remains pending."),
    ),
    Effect.catchDefect(() =>
      Effect.logWarning("Payslip dispatch defect; render intent remains pending."),
    ),
    Effect.andThen(Effect.sleep("30 seconds")),
  ),
);

const dispatchCredits = Effect.forever(
  dispatchCreditDocuments().pipe(
    Effect.catch(() =>
      Effect.logWarning("Credit document dispatch failed; outbox intent remains pending."),
    ),
    Effect.catchDefect(() =>
      Effect.logWarning("Credit document dispatch defect; outbox intent remains pending."),
    ),
    Effect.andThen(Effect.sleep("30 seconds")),
  ),
);

const dispatchReminders = Effect.forever(
  dispatchPendingReminders().pipe(
    Effect.catch(() => Effect.logWarning("Reminder dispatch failed; its intent remains durable.")),
    Effect.catchDefect(() =>
      Effect.logWarning("Reminder dispatch defect; its intent remains durable."),
    ),
    Effect.andThen(Effect.sleep("1 second")),
  ),
);

const main = Effect.all(
  [
    dispatch,
    dispatchExtractions,
    dispatchPeriodWork,
    dispatchCredits,
    dispatchPayslipDocuments,
    dispatchReminders,
    runRecurringDraftDispatch(),
  ],
  {
    concurrency: 7,
  },
).pipe(Effect.provide(worker), Effect.scoped);

runMain(main.pipe(Effect.tapCause(() => Effect.logError("Preparation runner stopped."))), {
  disableErrorReporting: true,
});
