import { inspectQueuedDocument } from "../../scripts/document-inspection/inspection";
import * as PgClient from "@effect/sql-pg/PgClient";
import { Worker } from "effect-mq";
import { DrizzleJobStore } from "effect-mq/drizzle-postgres";
import { ExtractionQueue, handleExtraction } from "../../src/runtime/preparation-queue";
import {
  jobs,
  jobAttempts,
  jobDedupe,
  jobFlowChildren,
  jobFlowOutbox,
  jobQueues,
  jobSchedules,
} from "../../src/db/schema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { readFile } from "node:fs/promises";
import * as Accounting from "@open-erp/contracts/accounting";
import { databaseLayer } from "../../src/db/connection";
import { runSupplierExtraction } from "../../src/application/purchases/extraction";
import { RequestEnvironment, type Bindings } from "../../src/runtime/environment";
import { localDocumentReader } from "../../src/adapters/document-reading/local-fixture";
import { filesystemObjectStore } from "../../src/adapters/storage/filesystem-objects";
import api from "../../src/index";

const Input = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("parallel"),
    scope: Accounting.Scope,
    requestIds: Schema.Array(Accounting.Identifier).check(Schema.isBetweenLength(2, 2)),
  }),
  Schema.Struct({
    action: Schema.Literals(["run", "queue"]),
    scope: Accounting.Scope,
    requestId: Accounting.Identifier,
  }),
  Schema.Struct({
    action: Schema.Literal("api"),
    path: Schema.String,
    token: Schema.String,
    method: Schema.String,
    body: Schema.optional(Schema.String),
  }),
]);

const inputPath = process.argv[2];

const connectionString = process.env.DATABASE_URL;

if (!inputPath || !connectionString)
  throw new Error("Fixture path and isolated database required.");

const input = Schema.decodeSync(Schema.fromJsonString(Input))(await readFile(inputPath, "utf8"));

const endpoint = process.env.DOCUMENT_READER_FIXTURE;

if (endpoint && new URL(endpoint).hostname !== "127.0.0.1")
  throw new Error("Fixture must use loopback.");

const bindings: Bindings = {
  DOCUMENT_INSPECTOR: inspectQueuedDocument,
  DATABASE_URL: connectionString,
  OPENERP_PREPARATION_TOKEN: process.env.OPENERP_PREPARATION_TOKEN,
  DOCUMENT_READER: endpoint ? localDocumentReader(endpoint) : undefined,
  EVIDENCE_STORE: process.env.EVIDENCE_STORE_ROOT
    ? filesystemObjectStore(process.env.EVIDENCE_STORE_ROOT)
    : undefined,
};

if (input.action === "api") {
  const response = await api.fetch(
    new Request(`http://localhost${input.path}`, {
      method: input.method,
      body: input.body,
      headers: {
        authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
    }),
    bindings,
  );

  process.stdout.write(JSON.stringify({ status: response.status, body: await response.text() }));
} else {
  const services = Layer.mergeAll(
    databaseLayer({
      connectionString: Redacted.make(connectionString),
      applicationName: "document-reader-e2e",
      connectTimeoutMs: 5000,
      statementTimeoutMs: 15000,
    }),
    Layer.succeed(RequestEnvironment, { bindings, url: new URL("http://localhost/") }),
  );

  if (input.action === "parallel") {
    const result = await Effect.runPromise(
      Effect.all(
        input.requestIds.map((requestId) => runSupplierExtraction(input.scope, requestId)),
        { concurrency: 2 },
      ).pipe(Effect.provide(services)),
    );

    process.stdout.write(JSON.stringify({ result }));
  } else {
    const queueStore = DrizzleJobStore.layer({
      jobs,
      attempts: jobAttempts,
      dedupe: jobDedupe,
      flowChildren: jobFlowChildren,
      flowOutbox: jobFlowOutbox,
      queues: jobQueues,
      schedules: jobSchedules,
    });

    const worker = ExtractionQueue.toLayer(handleExtraction, { concurrency: 1 }).pipe(
      Layer.provideMerge(Worker.layer({ concurrency: 1 })),
      Layer.provideMerge(queueStore),
      Layer.provideMerge(services),
      Layer.provide(PgClient.layer({ url: Redacted.make(connectionString), maxConnections: 3 })),
    );

    const direct = runSupplierExtraction(input.scope, input.requestId).pipe(
      Effect.provide(services),
    );

    const queued = Effect.gen(function* () {
      const jobId = yield* ExtractionQueue.enqueue({
        scope: input.scope,
        requestId: input.requestId,
      });

      return yield* ExtractionQueue.awaitResult(jobId);
    }).pipe(Effect.provide(worker), Effect.scoped);

    const result = await Effect.runPromise(input.action === "queue" ? queued : direct);
    process.stdout.write(JSON.stringify({ result }));
  }
}
