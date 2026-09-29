/** Spawned only by the disposable recovery test, using the actual Effect owners. */
import { readFile } from "node:fs/promises";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Redacted from "effect/Redacted";
import * as A from "@open-erp/contracts/accounting";
import * as Intake from "@open-erp/contracts/source-intake";
import { databaseLayer } from "../../../src/db/connection";
import { RequestEnvironment } from "../../../src/runtime/environment";
import { retainSource, getSourceOccurrence } from "../../../src/application/source-retention";
import { filesystemObjectStore } from "../../../src/adapters/storage/filesystem-objects";

const Input = Schema.Struct({
  mode: Schema.Literals(["retain", "read"]),
  scope: A.Scope,
  store: Schema.String,
  requestKey: Schema.String,
  occurrenceId: Schema.String,
  source: Schema.optional(Intake.RetainSource),
});

const filename = process.argv[2];

if (!filename) throw Error("Input required");

const input = Schema.decodeSync(Schema.fromJsonString(Input))(await readFile(filename, "utf8"));

const db = process.env.DATABASE_URL,
  token = process.env.EXCELLENCE_TOKEN;

if (!db || !token) throw Error("Private fixture credentials required");

const u = new URL(db);

if (u.hostname !== "127.0.0.1" || !/^postgres$|^exc_restore_[a-f0-9]+$/.test(u.pathname.slice(1)))
  throw Error("Non-fixture database refused");

const operation = Effect.gen(function* () {
  if (input.mode === "read")
    return yield* getSourceOccurrence(token, {
      scope: input.scope,
      occurrenceId: input.occurrenceId,
    });

  if (!input.source) throw Error("Retained source required");

  return yield* retainSource(token, {
    scope: input.scope,
    idempotencyKey: input.requestKey,
    input: input.source,
  });
});

const result = await Effect.runPromise(
  operation.pipe(
    Effect.provide(
      databaseLayer({
        connectionString: Redacted.make(db),
        applicationName: "excellence-recovery-host",
        connectTimeoutMs: 5000,
        statementTimeoutMs: 10000,
      }),
    ),
    Effect.provideService(RequestEnvironment, {
      url: new URL("http://127.0.0.1"),
      bindings: { EVIDENCE_STORE: filesystemObjectStore(input.store) },
    }),
    Effect.match({
      onSuccess: (value) => ({ ok: true, value }),
      onFailure: (error) => ({
        ok: false,
        code: error instanceof A.AccountingError ? error.code : "InfrastructureFailure",
      }),
    }),
  ),
);

console.log(JSON.stringify(result));
